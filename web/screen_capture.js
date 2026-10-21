import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { createCapturePanel } from "./screen_ui.js";
import { responsiveCapture } from "./layout.js";

async function request(path, data, headers = {}) {
    const response = await api.fetchApi(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data || {}) });
    if (!response.ok) { let error; try { error = await response.json(); } catch { /* short generic error below */ } throw Error(error?.error || "屏幕捕获连接失败，请检查电脑桥接插件和用户设置。"); }
    return response.json();
}
const labels = { enabled: "启用捕获", source: "捕获来源", device: "已配对设备 ID", target: "捕获目标", monitor: "显示器编号（0=全部）", window: "窗口句柄", x: "裁剪 X", y: "裁剪 Y", width: "裁剪宽（0=剩余）", height: "裁剪高（0=剩余）", resize_width: "输出宽（0=原尺寸）", resize_height: "输出高（0=原尺寸）", frames: "连续帧数", interval: "帧间隔（秒）", fps: "最高 FPS", on_error: "异常处理" };
app.registerExtension({ name: "DesktopBridge.ScreenCapture", beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "DesktopScreenCapture") return;
    const created = nodeType.prototype.onNodeCreated, removed = nodeType.prototype.onRemoved, executed = nodeType.prototype.onExecuted, configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onNodeCreated = function () {
        created?.apply(this, arguments);
        const node = this;
        const widgets = () => Object.fromEntries((node.widgets || []).filter(w => w.name !== "screen_capture_panel").map(w => [w.name, w]));
        const get = () => Object.fromEntries(Object.entries(widgets()).map(([name, widget]) => [name, widget.value]));
        const set = (name, value) => { const widget = widgets()[name]; if (!widget) return; widget.value = value; node.graph?.setDirtyCanvas(true, true); };
        for (const widget of Object.values(widgets())) {
            widget.label = labels[widget.name] || widget.name;
            if (widget.name === "bridge_auth") { widget.type = "hidden"; widget.hidden = true; widget.draw = () => {}; widget.computeSize = () => [0, -4]; widget.serializeValue = () => ""; }
            const callback = widget.callback;
            widget.callback = function () { const result = callback?.apply(this, arguments); node.screenCapturePanel?.update(); return result; };
        }
        const panel = createCapturePanel({ get, set, changed: () => { node.graph?.change?.(); node.setDirtyCanvas?.(true, true); },
            request: (action, data) => request("/screen_capture/" + action, data),
            agent: (action, data, identity) => request("/desktop_bridge/agent/" + action, data, { "X-Desktop-Device": identity.id, Authorization: "Bearer " + identity.secret }),
            createBrowser: () => request("/desktop_bridge/browser", {}), forgetBrowser: id => request("/desktop_bridge/forget", { id }),
            chooseComputer: select => { if (!globalThis.DesktopBridgeUI) throw Error("请安装 ComfyUI-DesktopBridge 并重启。"); return globalThis.DesktopBridgeUI.open({ capability: "capture", select }); },
            imageURL: descriptor => api.apiURL("/view?" + new URLSearchParams(descriptor)) });
        node.screenCapturePanel = panel;
        node.screenCaptureLayout = responsiveCapture(node, panel.root);
        node.addDOMWidget("screen_capture_panel", "screen_capture_panel", panel.root, node.screenCaptureLayout.options);
        node.setSize([Math.max(540, node.size[0]), Math.max(node.size[1], node.computeSize()[1])]);
    };
    nodeType.prototype.onExecuted = function (result) { executed?.apply(this, arguments); this.screenCapturePanel?.show(result); };
    nodeType.prototype.onConfigure = function () { configured?.apply(this, arguments); this.screenCapturePanel?.update(); this.screenCaptureLayout?.refresh(); };
    nodeType.prototype.onRemoved = function () { this.screenCaptureLayout?.dispose(); this.screenCapturePanel?.destroy(); removed?.apply(this, arguments); };
} });
