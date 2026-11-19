# Native File Drag

将 Obsidian「文件」面板中的 Markdown 笔记和附件拖到 Finder、Windows 文件资源管理器或支持收取文件的应用。macOS 默认按住 **Option** 拖拽，Windows 默认按住 **Ctrl** 拖拽。多选后，拖动其中一个已选文件即可拖出整组选中的文件。

## 安装试用版

1. 下载[安装包](../../releases/latest)，解压后把 `native-file-drag` 文件夹放进 `<笔记库>/.obsidian/plugins/`。确认里面有 `main.js` 和 `manifest.json`。
2. 在 Obsidian 桌面端 1.15.1 或更新版本中，打开 **设置 → 社区插件**，刷新列表并启用 **Native File Drag**。
3. 如果装过 Windows File Drag 或本地 macOS 试用版，先停用旧插件。自定义按键可以在合并版里重新设置。

## 使用与设置

- 界面默认英文。在 **Settings → Native File Drag → Language** 选择 **简体中文**，设置和提示会立即切换。
- 可更换拖拽按键，也可设为「直接拖出」，此时也会接管 Obsidian 的普通文件拖拽。在 macOS 上，按住 Control 点按可能会打开右键菜单；如果影响拖拽，可改用 Option。
- 「检查原生拖拽支持」用于查看宿主接口是否可用。接收应用按自身规则处理拖入的文件。

多选时，已经滚出视区的文件也会一起拖出。如果选中了文件夹，或插件无法读取完整选集，会提示并保留 Obsidian 的默认拖拽。可以取消选中文件夹，或清除选中状态后拖出单个文件。内联重命名时，拖拽由 Obsidian 处理。

插件使用 Obsidian 的文件列表内部接口和 Electron 桥接，两者都可能随 Obsidian 更新而变化。拖拽时会检查文件路径是否位于当前库内，再把路径交给操作系统。所有处理都在本地进行，无需账号。

[English README](README.md)
