"use strict";

const { FileSystemAdapter, Notice, Plugin, PluginSettingTab, Setting } = require("obsidian");
const fs = require("node:fs");
const path = require("node:path");

// Embed the drag icon because community installs only fetch standard release assets.
const DRAG_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAoCAYAAACfKfiZAAAAU0lEQVR4nGNgGAVowD008z+tMNEO+Pj1J9XxqANGHTDqgFEHjDpg1AFkO0C/fg3ZeHiEwKgDRh0wmgtGHTDqgNFcMOqAUQeMOmBAHDCgQzQjDgAA7TlrOdBtGoIAAAAASUVORK5CYII=";
const EXPLORER = '.workspace-leaf-content[data-type="file-explorer"]';
const FILE_ROW = ".nav-file-title[data-path]";
const TRIGGERS = { ctrl: "ctrlKey", alt: "altKey", shift: "shiftKey" };
const TEXT = {
  en: {
    language: "Language",
    trigger: "Drag trigger",
    triggerDescription: "Hold the selected key before dragging a file from the file explorer. Regular drags keep Obsidian's default behavior.",
    ctrl: "Ctrl + drag",
    alt: "Alt + drag",
    shift: "Shift + drag",
    none: "Any drag (replaces regular file drags)",
    check: "Check native drag support",
    ready: "The native drag interface is available.",
    windowsOnly: "Native file drag is available on Windows only.",
    bridgeUnavailable: "This Obsidian installation does not expose the native drag interface.",
    fileUnavailable: "A selected file is missing, unavailable, or outside this vault.",
    dragFailed: "Windows file drag could not start. Try a regular drag or use Show in system explorer.",
    saveFailed: "Could not save Windows File Drag settings.",
  },
  "zh-CN": {
    language: "语言",
    trigger: "拖出方式",
    triggerDescription: "从文件列表拖拽前，先按住指定按键。普通拖拽保留 Obsidian 的默认行为。",
    ctrl: "Ctrl + 拖拽",
    alt: "Alt + 拖拽",
    shift: "Shift + 拖拽",
    none: "直接拖出（接管普通文件拖拽）",
    check: "检查原生拖拽支持",
    ready: "原生拖拽接口可用。",
    windowsOnly: "原生文件拖出仅支持 Windows。",
    bridgeUnavailable: "当前 Obsidian 安装未提供原生拖拽接口。",
    fileUnavailable: "选中的文件不存在、不可用或位于当前库之外。",
    dragFailed: "无法发起 Windows 文件拖拽。请尝试普通拖拽，或在系统资源管理器中显示文件。",
    saveFailed: "无法保存 Windows 文件拖出设置。",
  },
};

function loadSettings(data) {
  const trigger = data?.trigger;
  const validTrigger = typeof trigger === "string" && (trigger === "none" || Object.hasOwn(TRIGGERS, trigger));
  return {
    language: data?.language === "zh-CN" ? "zh-CN" : "en",
    trigger: validTrigger ? trigger : "ctrl",
  };
}

function matchesTrigger(event, trigger) {
  if (trigger === "none") return true;
  return Object.keys(TRIGGERS).every((key) => Boolean(event[TRIGGERS[key]]) === (key === trigger))
    && !event.metaKey;
}

// Reject junctions and symlinks that would drag a file from outside the vault.
function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".."
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolveFiles(vault, draggedPath, selectedPaths) {
  const adapter = vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  const paths = selectedPaths.includes(draggedPath) ? selectedPaths : [draggedPath];

  try {
    const root = path.resolve(adapter.getBasePath());
    const realRoot = fs.realpathSync(root);
    const files = [];
    for (const relative of new Set(paths)) {
      if (!relative || path.isAbsolute(relative)) return null;
      const entry = vault.getFileByPath(relative);
      if (!entry) return null;
      const absolute = path.resolve(adapter.getFullPath(entry.path));
      if (!isInside(root, absolute)) return null;
      const realFile = fs.realpathSync(absolute);
      if (!isInside(realRoot, realFile) || !fs.statSync(realFile).isFile()) return null;
      files.push(absolute);
    }
    return files;
  } catch {
    return null;
  }
}

function getNativeDrag(window) {
  try {
    // Use the bridge already enabled by the host and get the source window's webContents.
    const electron = window.require("electron");
    const remote = window.require("@electron/remote");
    const contents = remote.getCurrentWebContents();
    if (typeof contents?.startDrag !== "function" || contents.isDestroyed()) return null;
    const icon = electron.nativeImage.createFromDataURL(DRAG_ICON);
    if (icon.isEmpty()) return null;
    return { contents, icon };
  } catch {
    return null;
  }
}

class DragSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl, plugin } = this;
    const strings = plugin.strings;
    containerEl.empty();

    new Setting(containerEl)
      .setName(strings.language)
      .addDropdown((dropdown) => dropdown
        .addOptions({ en: "English", "zh-CN": "简体中文" })
        .setValue(plugin.settings.language)
        .onChange((language) => {
          plugin.saveSettings({ language });
          this.display();
        }));

    new Setting(containerEl)
      .setName(strings.trigger)
      .setDesc(strings.triggerDescription)
      .addDropdown((dropdown) => dropdown
        .addOptions({ ctrl: strings.ctrl, alt: strings.alt, shift: strings.shift, none: strings.none })
        .setValue(plugin.settings.trigger)
        .onChange((trigger) => plugin.saveSettings({ trigger })));

    new Setting(containerEl)
      .setName(strings.check)
      .setDesc(plugin.getSupportMessage())
      .addButton((button) => button.setButtonText(strings.check).onClick(() => {
        new Notice(plugin.getSupportMessage());
      }));
  }
}

module.exports = class WindowsFileDrag extends Plugin {
  async onload() {
    this.settings = loadSettings(await this.loadData());
    this.pendingSave = Promise.resolve();
    this.addSettingTab(new DragSettings(this.app, this));

    if (process.platform === "win32") {
      const document = this.app.workspace.containerEl.ownerDocument;
      this.registerDomEvent(document, "dragstart", (event) => this.onDragStart(event), { capture: true });
    }
  }

  get strings() {
    return TEXT[this.settings.language];
  }

  saveSettings(change) {
    this.settings = loadSettings({ ...this.settings, ...change });
    const snapshot = this.settings;
    this.pendingSave = this.pendingSave
      .then(() => this.saveData(snapshot))
      .catch(() => { new Notice(this.strings.saveFailed); });
    return this.pendingSave;
  }

  getSupportMessage() {
    if (process.platform !== "win32") return this.strings.windowsOnly;
    const window = this.app.workspace.containerEl.ownerDocument.defaultView;
    return getNativeDrag(window) ? this.strings.ready : this.strings.bridgeUnavailable;
  }

  onDragStart(event) {
    if (!matchesTrigger(event, this.settings.trigger)) return;
    const row = event.target?.closest?.(FILE_ROW);
    const explorer = row?.closest(EXPLORER);
    if (!explorer) return;

    const selected = [...explorer.querySelectorAll(`${FILE_ROW}.is-selected`)]
      .map((node) => node.getAttribute("data-path"));
    const files = resolveFiles(this.app.vault, row.getAttribute("data-path"), selected);
    if (!files?.length) {
      new Notice(this.strings.fileUnavailable);
      return;
    }

    const nativeDrag = getNativeDrag(row.ownerDocument.defaultView);
    if (!nativeDrag) {
      new Notice(this.strings.bridgeUnavailable);
      return;
    }

    // Cancel the HTML drag before starting the Windows drag so both don't run together.
    event.preventDefault();
    event.stopImmediatePropagation();
    const { contents, icon } = nativeDrag;
    try {
      const item = { file: files[0], icon };
      if (files.length > 1) item.files = files;
      contents.startDrag(item);
    } catch {
      new Notice(this.strings.dragFailed);
    }
  }
};
