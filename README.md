# 屏幕获取 1.1.0

节点：**屏幕获取 · 本机 / 跨电脑 / 浏览器**，分类 `屏幕获取 / Screen Capture`。输出 `IMAGE`、`MASK`、捕获状态文本。

1.1.0 修复节点纵向拉伸后的空白区域：预览框随节点高度伸缩，上方参数和按钮维持自然高度。双击节点预览打开覆盖浏览器可用区域的大预览裁剪浮窗，可拖拽框选并同步写回节点的 X/Y/宽/高。点击右上角 ×、浮窗外围或按 Esc 都会关闭并保留裁剪结果，再次打开仍显示原裁剪。浏览器共享时大预览继续实时更新；队列输出预览已被裁剪时，双击会先读取完整源画面，避免在裁剪结果上重复计算坐标。

## 安装

同时把 `ComfyUI-DesktopBridge` 和此目录放入 `custom_nodes`。使用 **ComfyUI 自己的 Python** 执行：

```powershell
python -m pip install -r custom_nodes/ComfyUI-ScreenCapture/requirements.txt
```

便携版应将上面的 `python` 替换成整合包内 Python 完整路径。重启 ComfyUI，Ctrl+F5。跨电脑 Python 捕获还需在对应电脑运行 DesktopBridge-Client，配对时启用屏幕权限。

## 三种来源

| 来源 | 捕获哪台电脑 | 使用方式 |
|---|---|---|
| server | 运行 ComfyUI Python 的电脑 | 后端 mss 捕获，无浏览器授权弹窗 |
| computer | 选中的已配对电脑 | 点击“连接我的电脑”，对方保持桥接程序运行 |
| browser | 打开当前 ComfyUI 页面的电脑 | 点击“浏览器共享”，手动选择显示器、窗口或标签页并授权 |

跨电脑不要求同一局域网，但 ComfyUI 地址必须从对方电脑可达。外网使用受保护的 HTTPS；插件不自动提供公网穿透。浏览器共享要求 HTTPS 或 localhost；局域网 HTTP 可选择 Python 桥接。授权只在当前页面和当前共享会话有效，刷新或停止共享后需要重新授权。

## 屏幕、窗口和区域

- `target=monitor`：刷新列表，选择显示器；编号 0 表示所有显示器组成的虚拟桌面。多屏不同 DPI 时使用物理像素坐标。
- `target=window`：Windows 可刷新和选择应用窗口，抓客户区，不含系统标题栏/边框。PrintWindow 后台捕获不会把遮挡窗口叠入截图；应用需支持 WM_PRINT，部分硬件加速/受保护应用可能返回黑图，此时改用浏览器窗口共享。窗口关闭/最小化返回错误或空图。窗口调用在有超时的独立子进程内执行。
- X/Y 相对**选定来源**的左上角，不能是负数；宽/高为 0 代表从起点到边缘。可以直接输入数值写进工作流。
- 点击“预览一帧”后在画面拖拽框选，自动填写 X/Y/宽/高；Shift+单击画面拾取 XY。“清除裁剪”恢复全画面。
- 浏览器来源的具体屏幕/窗口在浏览器授权弹窗选择，不使用 Python 窗口下拉列表。

## 自动队列、预览和输出

每次节点执行都重新抓取，禁用 ComfyUI 对此节点的缓存，适用于 AutoQueue。帧数 1–64；实际间隔取“帧间隔”和 `1/FPS` 中较大的值。连续帧输出标准 `[B,H,W,3]` RGB float32 IMAGE，范围 0–1，可直连 VHS 等节点；不同帧尺寸统一到第一帧。输出宽/高为 0 保持尺寸；只指定一个时按比例缩放，两个都指定则精确缩放。

ComfyUI 中断队列会停止本节点等待和后续取帧；远程客户端/浏览器大约每秒检查请求是否取消，已在执行的单次系统窗口调用最多等待其 6 秒超时。

MASK 是 `[B,H,W]`、1 表示透明区域。常规桌面捕获不含透明通道，因此 MASK 为 0；关闭捕获或错误返回的空图为黑色、MASK 为 1。窗口捕获默认排除标题栏，不提供自动抠掉应用背景的语义蒙版。

实时预览默认关闭，Python 预览最多每秒一帧；浏览器授权共享预览每秒五帧，页面后台时暂停预览绘制。工作流执行仍按设置取帧。关闭启用开关后停止预览/浏览器共享，节点返回空图；Python 截图只在预览或队列请求时进行，没有常驻截图循环。

异常处理 `blank`：返回一张空图和状态文字，工作流继续；`error`：给出受控节点错误，方便自动化发现故障。不会因窗口崩溃退出 ComfyUI。

限制：单次源画面最多 4000 万像素、批次最多 6400 万像素、输出边长最多 8192；编码后的远程数据不超过 160 MB。浏览器按完整源画面传帧再裁剪，批量高分辨率建议改用 Python 区域捕获。主机与远程 Python 显示器捕获使用轻量 mss/Pillow，Linux/macOS 是否可后台取屏取决于桌面会话及系统权限；无桌面服务器请选择配对电脑或浏览器。

参考： [MSS 官方用法](https://python-mss.readthedocs.io/stable/examples.html)、[浏览器共享授权要求](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)、[Windows PrintWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow)。
