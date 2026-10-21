import { createCropViewer, cropInteraction, drawCapture } from "./crop_viewer.js";

const make = (tag, className, text) => { const element = document.createElement(tag); element.className = className || ""; if (text) element.textContent = text; return element; };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createCapturePanel({ get, set, request, agent, imageURL, changed, chooseComputer, createBrowser, forgetBrowser }) {
    if (!document.getElementById("screen-capture-style")) {
        const style = make("style"); style.id = "screen-capture-style";
        style.textContent = `.sc-panel{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden;padding:10px;color:#e2eaf2;background:#202a34;border:1px solid #4d6478;border-radius:8px;font:12px/1.5 system-ui}.sc-panel *{box-sizing:border-box}.sc-panel>:not(.sc-canvas){flex-shrink:0}.sc-toolbar{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:7px}.sc-panel button,.sc-panel select{font:inherit;color:inherit;border:1px solid #526b80;background:#303e4d;border-radius:5px;padding:4px 7px;cursor:pointer;min-width:0}.sc-panel select{width:100%;margin-bottom:7px}.sc-panel button[aria-pressed=true]{background:#22684f;border-color:#70cda7}.sc-canvas{display:block;flex:1 1 0;width:100%;height:0;min-height:180px;object-fit:contain;background:#131b24;cursor:crosshair;touch-action:none}.sc-status{overflow-wrap:anywhere;color:#b7cada;margin-top:6px}.sc-hint{color:#99adbf;font-size:11px;margin:5px 0}.sc-panel [hidden]{display:none!important}
.sc-crop-dialog{box-sizing:border-box;position:fixed;inset:0;width:calc(100vw - 48px);height:calc(100dvh - 48px);max-width:none;max-height:none;margin:auto;padding:14px;background:#1c2631;color:#e2eaf2;border:1px solid #5a7387;border-radius:12px;font:14px/1.5 system-ui;overflow:hidden}.sc-crop-dialog[open]{display:flex;flex-direction:column;gap:8px}.sc-crop-dialog::backdrop{background:#000a}.sc-crop-dialog *{box-sizing:border-box}.sc-crop-head{display:flex;align-items:center;gap:12px;flex-shrink:0}.sc-crop-head strong{margin-right:auto}.sc-crop-head button{font:inherit;color:inherit;background:#303e4d;border:1px solid #526b80;border-radius:6px;padding:4px 10px;cursor:pointer}.sc-crop-head .sc-crop-close{font-size:25px;line-height:1;padding:2px 9px}.sc-crop-canvas{display:block;width:100%;height:0;min-height:0;flex:1 1 0;object-fit:contain;background:#10171f;touch-action:none;cursor:crosshair}.sc-crop-info,.sc-crop-hint{flex-shrink:0;overflow-wrap:anywhere}.sc-crop-hint{font-size:12px;color:#adbdca}`;
        document.head.append(style);
    }
    const previewHint = "双击预览放大裁剪；坐标相对所选屏幕/窗口。Shift + 单击拾取 XY。";
    const root = make("div", "sc-panel"), toolbar = make("div", "sc-toolbar"), canvas = make("canvas", "sc-canvas"), select = make("select"), status = make("div", "sc-status", "选择来源后刷新列表。拖拽预览可框选区域。"), hint = make("div", "sc-hint", previewHint);
    canvas.width = 640; canvas.height = 360;
    select.setAttribute("aria-label", "选择屏幕或窗口");
    let disposed = false, streaming = false, stream, video, identity, live = false, busy = false, timer, drawTimer;
    let sourceImage, sourceWidth = 0, sourceHeight = 0, canSelect = false, sourceList = { monitors: [], windows: [] };
    const report = async operation => { try { await operation(); } catch (error) { if (!disposed) status.textContent = error.message; } };
    const button = (text, action) => { const result = make("button", "", text); result.type = "button"; result.onclick = () => report(action); toolbar.append(result); return result; };
    const source = () => ({ image: sourceImage, width: sourceWidth, height: sourceHeight, editable: canSelect });
    const commit = values => { for (const [name, value] of Object.entries(values)) set(name, value); changed?.(); };
    const viewer = createCropViewer({ source, crop: get, commit, changed: () => { draw(); } });
    const inlineCrop = cropInteraction(canvas, source, commit, draw);
    canvas.title = "双击放大预览并裁剪";
    canvas.addEventListener("dblclick", event => { event.preventDefault(); event.stopPropagation(); inlineCrop.finish(); viewer.open(); if (!canSelect && get().enabled) report(preview); });
    function draw() {
        if (disposed) return;
        if (viewer.isOpen) viewer.render();
        else drawCapture(canvas, source(), get(), inlineCrop.selection);
    }
    async function preview() {
        if (busy || disposed || !get().enabled) return;
        if (get().source === "browser" && video) { sourceImage = video; sourceWidth = video.videoWidth; sourceHeight = video.videoHeight; canSelect = true; hint.textContent = previewHint; draw(); return; }
        busy = true;
        try {
            const data = await request("preview", get());
            const image = new Image(); image.src = "data:image/png;base64," + data.image; await image.decode();
            if (disposed) return;
            sourceImage = image; sourceWidth = data.width; sourceHeight = data.height; canSelect = true; hint.textContent = previewHint; draw(); status.textContent = `预览 ${sourceWidth} × ${sourceHeight} · 每次运行重新捕获`;
        } finally { busy = false; }
    }
    function list() {
        const value = get(); select.replaceChildren();
        const items = value.target === "window" ? sourceList.windows.map(w => ({ id: w.id, name: `${w.title}${w.minimized ? "（最小化）" : ""}` })) : sourceList.monitors.map(m => ({ id: String(m.id), name: `${m.id === 0 ? "所有显示器" : "显示器 " + m.id} · ${m.width} × ${m.height} · (${m.left}, ${m.top})` }));
        for (const item of items) { const option = make("option", "", item.name); option.value = item.id; select.append(option); }
        select.value = String(value[value.target === "window" ? "window" : "monitor"]);
        if (!items.length) { const option = make("option", "", value.source === "browser" ? "浏览器共享时在授权弹窗选择屏幕或窗口" : "无可用来源，请刷新列表"); select.append(option); }
    }
    async function refresh() {
        if (get().source === "browser") { list(); status.textContent = "点击浏览器共享，在浏览器弹窗选择显示器或应用窗口。"; return; }
        sourceList = await request("sources", get()); list(); status.textContent = `读取到 ${sourceList.monitors.length - 1} 块屏幕、${sourceList.windows.length} 个窗口`;
    }
    async function stopSharing() {
        streaming = false; clearTimeout(drawTimer);
        if (!disposed && video && sourceImage === video && video.readyState >= 2) {
            const still = document.createElement("canvas"); still.width = video.videoWidth; still.height = video.videoHeight;
            still.getContext("2d").drawImage(video, 0, 0); sourceImage = still;
        }
        stream?.getTracks().forEach(track => track.stop()); stream = null;
        if (video) { video.pause(); video.srcObject = null; video = null; }
        const previous = identity; identity = null;
        if (previous) { if (get().device === previous.id) set("device", ""); try { await forgetBrowser(previous.id); } catch { /* offline server expires the session */ } }
        shareButton.setAttribute("aria-pressed", "false");
    }
    async function respond(job, connection, sharedVideo) {
        const config = job.payload || {}, count = Number(config.frames || 1), delay = Math.max(Number(config.interval ?? .1), 1 / Number(config.fps || 10));
        if (!Number.isInteger(count) || count < 1 || count > 64 || delay < 1 / 60 || delay > 10) throw Error("捕获批次数量或间隔无效");
        if (job.op === "capture.sources") return { monitors: [], windows: [], cursor: null };
        if (job.op !== "capture.frames") throw Error("不支持的浏览器捕获请求");
        const output = document.createElement("canvas"), frames = []; let encodedSize = 0, lastCheck = 0;
        const check = async () => {
            if (disposed || !streaming || identity !== connection || !get().enabled) throw Error("浏览器屏幕共享已停止。");
            if (performance.now() - lastCheck > 1000) { lastCheck = performance.now(); if (!(await agent("active", { id: job.id }, connection)).active) throw Error("截图请求已取消。"); }
        };
        for (let index = 0; index < count; index++) {
            const started = performance.now();
            await check();
            if (disposed || !streaming || identity !== connection || !get().enabled || sharedVideo.readyState < 2) throw Error("浏览器屏幕共享已停止。");
            output.width = sharedVideo.videoWidth; output.height = sharedVideo.videoHeight;
            if (!output.width || !output.height || output.width * output.height * count > 64_000_000) throw Error("截图总像素过大，请减少帧数或改用 Python 区域捕获。");
            output.getContext("2d").drawImage(sharedVideo, 0, 0);
            const blob = await new Promise(resolve => output.toBlob(resolve, "image/png"));
            if (!blob) throw Error("浏览器无法编码截图");
            const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
            encodedSize += encoded.length;
            if (encodedSize > 160 * 1024 * 1024) throw Error("截图数据过大，请减少帧数或改用 Python 区域捕获。");
            frames.push(encoded);
            if (index + 1 < count) { let remaining; while ((remaining = delay * 1000 - (performance.now() - started)) > 0) { await wait(Math.min(200, remaining)); await check(); } }
        }
        return { frames };
    }
    async function poll(connection, sharedVideo) {
        while (!disposed && streaming && identity === connection) {
            try {
                const job = await agent("poll", {}, connection);
                if (!job.id) continue;
                let result = { id: job.id, ok: false };
                try { result.data = await respond(job, connection, sharedVideo); result.ok = true; } catch (error) { result.error = error.message; }
                await agent("result", result, connection);
            } catch (error) { if (!disposed && streaming) { status.textContent = "共享连接重试中：" + error.message; await wait(2000); } }
        }
    }
    button("连接我的电脑", async () => { await stopSharing(); await chooseComputer(device => { set("source", "computer"); set("device", device.id); status.textContent = "已选择：" + device.name; report(refresh); }); });
    const shareButton = button("浏览器共享 / 停止", async () => {
        if (streaming) { await stopSharing(); status.textContent = "屏幕共享已停止。"; return; }
        if (!navigator.mediaDevices?.getDisplayMedia) throw Error("浏览器屏幕共享需要 HTTPS 或 localhost；局域网 HTTP 可改用电脑桥接。");
        // Must execute immediately inside this user click; do not await network requests before authorization.
        const media = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        try {
            const playback = document.createElement("video"); playback.muted = true; playback.playsInline = true; playback.srcObject = media; await playback.play();
            const connection = await createBrowser();
            if (disposed) { media.getTracks().forEach(track => track.stop()); await forgetBrowser(connection.id); return; }
            stream = media; video = playback; identity = connection; streaming = true;
            set("source", "browser"); set("device", identity.id); set("enabled", true); shareButton.setAttribute("aria-pressed", "true");
            media.getVideoTracks()[0].addEventListener("ended", () => { stopSharing(); status.textContent = "浏览器已结束共享，请重新授权。"; }, { once: true });
            sourceWidth = video.videoWidth; sourceHeight = video.videoHeight; sourceImage = video; canSelect = true; hint.textContent = previewHint;
            const repaint = () => { if (streaming && !disposed) { if (!document.hidden) draw(); drawTimer = setTimeout(repaint, 200); } }; repaint();
            poll(connection, playback); status.textContent = "共享已授权 · 每次队列请求时捕获最新画面";
        } catch (error) { media.getTracks().forEach(track => track.stop()); throw error; }
    });
    button("刷新屏幕 / 窗口列表", refresh);
    button("预览一帧", preview);
    const liveButton = button("实时预览", async () => { live = !live; liveButton.setAttribute("aria-pressed", String(live)); clearTimeout(timer); if (live) loop(); });
    async function loop() { if (!live || disposed) return; if (!document.hidden) await report(preview); timer = setTimeout(loop, 1000); }
    button("清除裁剪", async () => { for (const name of ["x", "y", "width", "height"]) set(name, 0); draw(); });
    select.onchange = () => { set(get().target === "window" ? "window" : "monitor", get().target === "window" ? select.value : Number(select.value)); for (const key of ["x", "y", "width", "height"]) set(key, 0); report(preview); };
    root.append(toolbar, select, canvas, hint, status);
    const observer = new ResizeObserver(draw); observer.observe(canvas);
    for (const name of ["pointerdown", "wheel", "keydown", "dblclick"]) root.addEventListener(name, event => event.stopPropagation());
    return { root, refresh, preview, async update() { list(); if (!get().enabled || streaming && get().source !== "browser") await stopSharing(); if (!get().enabled) { live = false; clearTimeout(timer); liveButton.setAttribute("aria-pressed", "false"); } draw(); },
        show(result) { if (result.capture_status) status.textContent = result.capture_status.join("\n"); const last = result.screen_preview?.at(-1); if (last && !streaming && !live) { const image = new Image(); image.onload = () => { sourceImage = image; sourceWidth = image.naturalWidth; sourceHeight = image.naturalHeight; canSelect = false; draw(); hint.textContent = "当前为本次输出画面。双击或点击预览一帧，读取源画面后裁剪。"; }; image.src = imageURL(last); } },
        destroy() { disposed = true; live = false; clearTimeout(timer); clearTimeout(drawTimer); observer.disconnect(); inlineCrop.dispose(); viewer.destroy(); stopSharing(); root.remove(); } };
}

