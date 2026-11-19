# Native File Drag

Drag Markdown notes and attachments from Obsidian's file explorer to Finder, File Explorer, and other apps that accept files. Hold **Option** on macOS or **Ctrl** on Windows before you drag. To drag several files, select them first and drag one of the selected files.

[简体中文说明](README.zh-CN.md)

## Install the preview

1. Download the [manual install ZIP](../../releases/latest) and extract the `native-file-drag` folder into `<vault>/.obsidian/plugins/`. The folder contains `main.js` and `manifest.json`.
2. In Obsidian desktop 1.15.1 or later, open **Settings → Community plugins**, refresh the installed plugins list, and enable **Native File Drag**.
3. If you installed the Windows File Drag or local macOS preview, disable it before enabling Native File Drag. Reapply any custom drag trigger in the new plugin's settings.

## Settings

- **Language** defaults to English. Select **简体中文** to switch the settings and notices to Simplified Chinese.
- **Drag trigger** defaults to Option on macOS and Ctrl on Windows. Choose a different modifier or enable **Any drag**, which also replaces regular Obsidian file drags. On macOS, Control-click can open the context menu; use Option if it interferes.
- **Check native drag support** shows whether Obsidian exposes the interface the plugin needs. The receiving app controls what it does with the file.

## Compatibility and data access

Selected files can be dragged together even when some have scrolled out of view. If the selection includes a folder or the plugin cannot read the full selection, the plugin shows a notice and leaves the drag to Obsidian. Deselect folders or clear the selection to try again. The plugin also leaves inline rename gestures to Obsidian.

This preview uses Obsidian's file explorer internals and an Electron bridge provided by the desktop host. Both may change in an Obsidian update. The [automated tests](https://github.com/crisxuan/native-file-drag/actions) exercise both platforms using a simulated Electron interface.

The plugin checks that each selected file resolves within the vault before passing its path to the operating system. It stores the language and trigger in the vault's plugin configuration. All processing happens locally. Native File Drag has no telemetry or account requirement.

## Development

Run `npm test` with Node.js 22 or later. There are no npm dependencies. The root `main.js` is the readable source and the exact release file. It includes the drag icon.

Native File Drag is an independent project distributed under the [MIT license](LICENSE). See the [Electron native drag documentation](https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop/) for the platform API.
