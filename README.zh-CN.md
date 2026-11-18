# Windows File Drag

从 Obsidian 的「文件」面板拖出实际的 Markdown 文件或附件。默认先按住 **Ctrl** 再拖拽。如果要拖出多份文件，先多选，再按住 Ctrl 拖动已选中的任意一个文件。

1. 在 Windows 上打开 Obsidian 和目标库。此试用版面向 Obsidian 桌面端 1.15.1 或更高版本。
2. 将安装包内的 `windows-file-drag` 文件夹放入 `<笔记库>/.obsidian/plugins/`，确认该文件夹内有 `main.js` 和 `manifest.json`。
3. 在 **设置 → 社区插件** 刷新插件列表并启用 **Windows File Drag**。

进入 **Settings → Windows File Drag → Language** 选择 **简体中文**。切换立即生效并保存，设置和提示会随之切换。社区目录中的插件名固定为英文。拖拽按键可改为 Alt、Shift，或设置为直接拖出。

插件使用 Obsidian 桌面端提供的 Electron 桥接。设置里的「检查原生拖拽支持」可以检查接口。已通过 Windows 路径和拖拽逻辑测试，实际跨应用收件仍需在 Windows 桌面验证。插件会检查文件路径是否位于当前库内，并在拖拽时把路径交给 Windows。插件自身不发起网络请求。

[English README](README.md)
