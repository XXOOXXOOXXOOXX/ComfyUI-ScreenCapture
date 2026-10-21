export function responsiveCapture(node, root) {
    const canvas = root.querySelector(".sc-canvas");
    let minimum = 320, frame = 0, disposed = false;
    const number = value => parseFloat(value) || 0;
    const measure = () => {
        frame = 0;
        if (disposed || !root.isConnected || !root.clientWidth) return;
        const style = getComputedStyle(root);
        let next = number(style.paddingTop) + number(style.paddingBottom) + number(style.borderTopWidth) + number(style.borderBottomWidth);
        for (const child of root.children) {
            const css = getComputedStyle(child);
            if (css.display !== "none") next += (child === canvas ? 180 : child.offsetHeight) + number(css.marginTop) + number(css.marginBottom);
        }
        next = Math.ceil(next);
        const overflow = Math.max(0, root.scrollHeight - root.clientHeight);
        if (next === minimum && overflow <= 1) return;
        minimum = next;
        // Native DOM widget margins can consume a few pixels at the minimum;
        // grow only by actual overflow so controls and the minimum preview fit.
        const required = Math.max(node.computeSize?.()[1] ?? minimum + 440, overflow > 1 ? node.size[1] + overflow : 0);
        if (node.size[1] < required) node.setSize([node.size[0], required]);
        node.setDirtyCanvas?.(true, true);
    };
    const refresh = () => { if (!disposed && !frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(refresh);
    observer.observe(root);
    for (const child of root.children) if (child !== canvas) observer.observe(child);
    refresh();
    return { options: { serialize: false, hideOnZoom: false, getMinHeight: () => minimum, getHeight: () => "100%", afterResize: refresh }, refresh,
        dispose() { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); } };
}
