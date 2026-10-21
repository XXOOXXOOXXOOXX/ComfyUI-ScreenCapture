import asyncio
import base64
import io
import json
from pathlib import Path
import sys
import uuid
import numpy as np
import torch
from PIL import Image


def bridge():
    module = sys.modules.get("_comfy_desktop_bridge")
    if module is None:
        raise ValueError("请安装 ComfyUI-DesktopBridge 并重启 ComfyUI。")
    return module


def helpers():
    from importlib import import_module
    return import_module(bridge().__package__ + ".capture")


def fetch(config, auth=""):
    source = config.get("source", "server")
    if source == "server":
        return helpers().capture(config, bridge().interrupt)
    if source not in {"computer", "browser"}:
        raise ValueError("未知捕获来源")
    if not config.get("device"):
        raise ValueError("请先连接电脑或启动浏览器屏幕共享。")
    duration = int(config.get("frames", 1)) * max(float(config.get("interval", .1)), 1 / max(.2, float(config.get("fps", 10))))
    return bridge().call(config["device"], "capture.frames", config, auth, timeout=min(750, max(45, duration + 40)))


def decode_frames(data, config):
    frames = data.get("frames")
    if not isinstance(frames, list) or not 1 <= len(frames) <= 64:
        raise ValueError("没有收到有效截图")
    images, masks, size = [], [], None
    total = 0
    for encoded in frames:
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 128 * 1024 * 1024:
            raise ValueError("单帧文件过大")
        with Image.open(io.BytesIO(raw)) as opened:
            if opened.width * opened.height > 40_000_000:
                raise ValueError("截图分辨率过大")
            image = opened.convert("RGBA")
        if config.get("source") == "browser":
            image = helpers().crop(image, config)
        width, height = int(config.get("resize_width", 0)), int(config.get("resize_height", 0))
        if width or height:
            width = width or max(1, round(image.width * height / image.height))
            height = height or max(1, round(image.height * width / image.width))
            if max(width, height) > 8192 or width * height > 40_000_000:
                raise ValueError("输出分辨率过大")
            image = image.resize((width, height), Image.Resampling.LANCZOS)
        size = size or image.size
        if image.size != size:
            image = image.resize(size, Image.Resampling.LANCZOS)
        total += image.width * image.height
        if total > 64_000_000:
            raise ValueError("批量输出超过 6400 万像素，请减少帧数或输出尺寸。")
        pixels = np.asarray(image, dtype=np.float32) / 255.0
        images.append(torch.from_numpy(pixels[..., :3].copy()))
        masks.append(torch.from_numpy((1 - pixels[..., 3]).copy()))
    return torch.stack(images), torch.stack(masks)


class DesktopScreenCapture:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "enabled": ("BOOLEAN", {"default": True}),
            "source": (["server", "computer", "browser"],),
            "device": ("STRING", {"default": ""}),
            "target": (["monitor", "window"],),
            "monitor": ("INT", {"default": 1, "min": 0, "max": 64}),
            "window": ("STRING", {"default": ""}),
            "x": ("INT", {"default": 0, "min": 0, "max": 65536}),
            "y": ("INT", {"default": 0, "min": 0, "max": 65536}),
            "width": ("INT", {"default": 0, "min": 0, "max": 16384}),
            "height": ("INT", {"default": 0, "min": 0, "max": 16384}),
            "resize_width": ("INT", {"default": 0, "min": 0, "max": 8192}),
            "resize_height": ("INT", {"default": 0, "min": 0, "max": 8192}),
            "frames": ("INT", {"default": 1, "min": 1, "max": 64}),
            "interval": ("FLOAT", {"default": .1, "min": 0, "max": 10, "step": .01}),
            "fps": ("FLOAT", {"default": 10, "min": .2, "max": 60, "step": .1}),
            "on_error": (["blank", "error"],),
        }, "optional": {"bridge_auth": ("STRING", {"default": "", "advanced": True, "hidden": True})}}

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("IMAGE", "MASK", "捕获信息")
    FUNCTION = "capture"
    CATEGORY = "屏幕获取 / Screen Capture"
    DESCRIPTION = "每次执行取最新画面。server=ComfyUI 电脑，computer=配对电脑，browser=浏览器授权共享。坐标相对选定屏幕/窗口；宽高 0 表示剩余区域。"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def capture(self, bridge_auth="", **config):
        status = "捕获已关闭"
        images = masks = None
        if config.get("enabled"):
            try:
                images, masks = decode_frames(fetch(config, bridge_auth), config)
                status = f"捕获 {len(images)} 帧 · {images.shape[2]} × {images.shape[1]} · RGB"
            except Exception as exc:
                # ComfyUI cancellation must propagate even with the blank-image error policy.
                if type(exc).__name__ == "InterruptProcessingException":
                    raise
                if config.get("on_error") == "error":
                    raise ValueError(str(exc) if isinstance(exc, ValueError) else "屏幕捕获失败，请检查窗口及捕获依赖。") from None
                status = "返回空图：" + (str(exc)[:300] if isinstance(exc, ValueError) else "窗口不可用、捕获超时或缺少依赖")
        if images is None:
            width = max(1, min(8192, int(config.get("resize_width", 0)) or 512))
            height = max(1, min(8192, int(config.get("resize_height", 0)) or 512))
            if width * height > 16_000_000:
                width = height = 512
            images, masks = torch.zeros((1, height, width, 3)), torch.ones((1, height, width))
        import folder_paths
        path = Path(folder_paths.get_temp_directory()) / ("screen_capture_" + uuid.uuid4().hex + ".png")
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray((images[-1].numpy() * 255).round().astype(np.uint8)).save(path)
        return {"ui": {"screen_preview": [{"filename": path.name, "subfolder": "", "type": "temp"}], "capture_status": [status]}, "result": (images, masks, status)}


def register_routes():
    from aiohttp import web
    from server import PromptServer
    routes = PromptServer.instance.routes

    @routes.post("/screen_capture/sources")
    async def sources(request):
        try:
            data = await request.json()
            if data.get("source", "server") == "server":
                result = await asyncio.to_thread(helpers().sources)
            else:
                result = await asyncio.to_thread(bridge().call, data.get("device", ""), "capture.sources", {})
            return web.json_response({"ok": True, **result})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)[:300] if isinstance(exc, ValueError) else "无法读取屏幕列表，请安装 mss 并检查桥接程序。"}, status=400)

    @routes.post("/screen_capture/preview")
    async def preview(request):
        try:
            data = await request.json()
            # Interactive preview is a single uncropped frame, used by drag selection.
            data.update(frames=1, x=0, y=0, width=0, height=0, preview=True)
            result = await asyncio.to_thread(fetch, data)
            with Image.open(io.BytesIO(base64.b64decode(result["frames"][0], validate=True))) as source:
                width, height = result.get("width", source.width), result.get("height", source.height)
                image = source.convert("RGB")
                image.thumbnail((1280, 800))
                encoded = helpers().encode(image)
            return web.json_response({"ok": True, "image": encoded, "width": width, "height": height})
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)[:300] if isinstance(exc, ValueError) else "预览捕获失败，请检查依赖和窗口状态。"}, status=400)


NODE_CLASS_MAPPINGS = {"DesktopScreenCapture": DesktopScreenCapture}
NODE_DISPLAY_NAME_MAPPINGS = {"DesktopScreenCapture": "屏幕获取 · 本机 / 跨电脑 / 浏览器"}
WEB_DIRECTORY = "./web"
register_routes()
