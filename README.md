# Windows File Drag

Drag a Markdown note or attachment from Obsidian's Files pane into a Windows app. Hold **Ctrl** before dragging to give the receiving app the file on disk. You can also drag several selected files together.

[简体中文说明](README.zh-CN.md)

**Preview:** Native drag and drop into a Windows desktop app still needs an end-to-end check. See the [release](https://github.com/crisxuan/windows-file-drag/releases/tag/0.1.0) for the install package.

## Install the trial build

1. In Obsidian on Windows, open the vault you want to use. This build targets Obsidian desktop 1.15.1 or later.
2. Place `main.js` and `manifest.json` in `<vault>/.obsidian/plugins/windows-file-drag/`. The manual install ZIP already contains this `windows-file-drag` folder.
3. In **Settings → Community plugins**, refresh the installed plugins list and enable **Windows File Drag**.

## Use

- Hold **Ctrl** and start dragging a file from the Files pane. Drop it in File Explorer or in an application that accepts files. For multiple files, select them first, then Ctrl-drag one of the selected items.
- Use **Settings → Windows File Drag → Language** to switch between **English** and **简体中文**. English is the default. Settings and notifications follow the selection immediately. The Community directory and the installed plugin name use the English manifest.
- **Drag trigger** can be changed to Alt, Shift, or any drag. The Windows drop target controls what it does with the file. Use **Check native drag support** to check whether the host can start a drag.

## Compatibility and data access

The plugin uses an Electron bridge already provided by some Obsidian desktop installations and the file row markup in the Files pane. A host update may change either interface. The current trial has passed simulated Windows path and drag tests. A Windows desktop session is still needed to confirm the receiving application gets the file.

For a drag, the plugin checks the selected paths and resolves filesystem links to keep the operation within the vault. It hands paths to Windows only when the configured gesture is used. The plugin stores the language and trigger in the vault's plugin configuration. It has no telemetry, accounts, or network requests of its own.

## Development

Run `npm test` with Node.js 22 or later. There are no npm dependencies. The root `main.js` is the readable source and the exact file used in the release. The drag icon is embedded in `main.js`.

Windows File Drag is an independent project distributed under the [MIT license](LICENSE). See the [Electron native drag documentation](https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop) for the platform API.
