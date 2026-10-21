// Both views write the same source-pixel coordinates into the node widgets.
export function cropInteraction(canvas, source, commit, repaint) {
    let origin, selection, pointer;
    const coordinate = (event, inside = false) => {
        const value = source();
        if (!value?.editable || !value.width || !value.height) return null;
        const rect = canvas.getBoundingClientRect(), scale = Math.min(rect.width / value.width, rect.height / value.height);
        const x = (event.clientX - rect.left - (rect.width - value.width * scale) / 2) / scale;
        const y = (event.clientY - rect.top - (rect.height - value.height * scale) / 2) / scale;
        if (inside && (x < 0 || y < 0 || x >= value.width || y >= value.height)) return null;
        return { x: Math.max(0, Math.min(value.width - 1, Math.floor(x))), y: Math.max(0, Math.min(value.height - 1, Math.floor(y))) };
    };
    const finish = () => {
        if (origin && selection) commit(selection);
        origin = selection = null;
        if (pointer != null && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
        pointer = null; repaint();
    };
    const down = event => {
        if (event.button !== 0 || event.detail > 1) return;
        const start = coordinate(event, true); if (!start) return;
        event.preventDefault(); event.stopPropagation();
        if (event.shiftKey) { commit(start); repaint(); return; }
        origin = start; pointer = event.pointerId; canvas.setPointerCapture(pointer);
        // A click/double-click must not replace the existing crop with a single pixel.
        selection = null;
    };
    const move = event => {
        if (!origin || event.pointerId !== pointer) return;
        const end = coordinate(event); if (!end) return;
        selection = { x: Math.min(origin.x, end.x), y: Math.min(origin.y, end.y), width: Math.abs(origin.x - end.x) + 1, height: Math.abs(origin.y - end.y) + 1 };
        repaint();
    };
    const up = event => { if (event.pointerId === pointer) finish(); };
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    return { get selection() { return selection; }, finish,
        dispose() { finish(); canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up); } };
}

export function drawCapture(canvas, source, crop, selection, large = false) {
    if (!source?.image || !source.width || !source.height) { canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); return; }
    const scale = Math.min((large ? 4096 : 1400) / source.width, (large ? 2400 : 1000) / source.height, 1);
    const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d"); context.drawImage(source.image, 0, 0, width, height);
    if (!source.editable) return;
    const box = selection || { x: Number(crop.x) || 0, y: Number(crop.y) || 0, width: Number(crop.width) || source.width - Number(crop.x || 0), height: Number(crop.height) || source.height - Number(crop.y || 0) };
    const rect = canvas.getBoundingClientRect(), displayScale = Math.max(.01, Math.min(rect.width / width, rect.height / height));
    context.save(); context.strokeStyle = "#73e9bb"; context.lineWidth = 2 / displayScale; context.setLineDash([8 / displayScale, 5 / displayScale]);
    context.strokeRect(box.x * scale, box.y * scale, box.width * scale, box.height * scale); context.restore();
}

export function createCropViewer({ source, crop, commit, changed }) {
    let dialog, canvas, info, interaction;
    const render = () => {
        if (!dialog?.open) return;
        const value = source(), box = interaction.selection || crop();
        drawCapture(canvas, value, crop(), interaction.selection, true);
        info.textContent = value?.editable ? `${value.width} × ${value.height} · X ${box.x || 0} / Y ${box.y || 0} / 宽 ${box.width || "剩余"} / 高 ${box.height || "剩余"}` : "正在获取可裁剪的源画面；请先开启捕获或浏览器共享。";
    };
    const close = () => { if (dialog?.open) { interaction.finish(); dialog.close(); } };
    const open = () => {
        if (dialog?.open) { render(); return; }
        dialog = document.createElement("dialog"); dialog.className = "sc-crop-dialog"; dialog.setAttribute("aria-label", "屏幕预览与裁剪");
        const head = document.createElement("div"); head.className = "sc-crop-head";
        const title = document.createElement("strong"); title.textContent = "屏幕预览 · 拖拽裁剪";
        const reset = document.createElement("button"); reset.textContent = "清除裁剪"; reset.type = "button"; reset.onclick = () => { interaction.finish(); commit({ x: 0, y: 0, width: 0, height: 0 }); changed(); render(); };
        const exit = document.createElement("button"); exit.textContent = "×"; exit.type = "button"; exit.className = "sc-crop-close"; exit.setAttribute("aria-label", "关闭裁剪预览"); exit.onclick = close;
        head.append(title, reset, exit);
        canvas = document.createElement("canvas"); canvas.className = "sc-crop-canvas"; canvas.width = 640; canvas.height = 360;
        canvas.setAttribute("aria-label", "全屏预览裁剪区域");
        info = document.createElement("div"); info.className = "sc-crop-info";
        const hint = document.createElement("div"); hint.className = "sc-crop-hint"; hint.textContent = "拖拽框选 · Shift + 单击拾取 XY · 点击右上角 ×、外围或按 Esc 关闭，自动保留裁剪结果";
        dialog.append(head, canvas, info, hint); document.body.append(dialog);
        interaction = cropInteraction(canvas, source, value => { commit(value); changed(); }, render);
        dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
        dialog.addEventListener("click", event => { if (event.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); });
        for (const name of ["pointerdown", "keydown", "wheel", "dblclick"]) dialog.addEventListener(name, event => event.stopPropagation());
        dialog.addEventListener("close", () => { interaction.dispose(); dialog.remove(); dialog = canvas = info = interaction = null; changed(); }, { once: true });
        dialog.showModal(); render();
    };
    return { open, close, render, get isOpen() { return !!dialog?.open; }, destroy() { close(); } };
}
