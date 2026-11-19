# Native File Drag 0.2.1

- Include selected files that have scrolled out of view. If the full selection is unavailable or includes a folder, show a notice and leave the drag to Obsidian.
- Listen for file drags in popout windows, including windows open when the plugin is enabled, and leave inline rename gestures to Obsidian.
- Clarify the macOS Control-click conflict and the behavior of Any drag. Hide unavailable drag controls on Linux and keep the language selector.

## 0.2.0

One preview build for Obsidian desktop 1.15.1 or later on macOS and Windows.

- Hold Option on macOS or Ctrl on Windows to drag an original file from the file explorer. Multiple selected files can be dragged together.
- Set a different modifier or enable drag without a modifier in the plugin settings.
- Use English by default or switch to Simplified Chinese.
- The combined build uses the plugin ID `native-file-drag`. Disable the previous Windows-only or local macOS preview before you enable this build, then reapply any custom settings.

The automated tests exercise both operating systems and simulate Electron drag calls. Native drop behavior depends on the desktop host and receiving application.
