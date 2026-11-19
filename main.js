"use strict";

const { FileSystemAdapter, Notice, Plugin, PluginSettingTab, Setting } = require("obsidian");
const fs = require("node:fs");
const path = require("node:path");

// Embed the drag icon because community installs only fetch standard release assets.
const DRAG_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAoCAYAAACfKfiZAAAAU0lEQVR4nGNgGAVowD008z+tMNEO+Pj1J9XxqANGHTDqgFEHjDpg1AFkO0C/fg3ZeHiEwKgDRh0wmgtGHTDqgNFcMOqAUQeMOmBAHDCgQzQjDgAA7TlrOdBtGoIAAAAASUVORK5CYII=";
const EXPLORER = '.workspace-leaf-content[data-type="file-explorer"]';
const FILE_ROW = ".nav-file-title[data-path]";
const nativeDragByWindow = new WeakMap();
const TRIGGERS = { alt: "altKey", ctrl: "ctrlKey", shift: "shiftKey", command: "metaKey" };
const IS_MAC = process.platform === "darwin";
const IS_SUPPORTED = IS_MAC || process.platform === "win32";
const DEFAULT_TRIGGER = IS_MAC ? "alt" : "ctrl";
const TEXT = {
  en: {
    language: "Language",
    trigger: "Drag trigger",
    triggerDescription: "With a modifier selected, hold that key before dragging. Any drag also replaces regular Obsidian file drags.",
    controlHint: "On macOS, Control-click can open the context menu; try Option if it interferes.",
    default: "Default",
    ctrl: IS_MAC ? "Control + drag" : "Ctrl + drag",
    alt: IS_MAC ? "Option + drag" : "Alt + drag",
    shift: "Shift + drag",
    command: "Command + drag",
    none: "Any drag (replaces regular file drags)",
    check: "Check native drag support",
    ready: "The native drag interface is available.",
    unsupportedPlatform: "Native file drag is available on macOS and Windows.",
    bridgeUnavailable: "This Obsidian installation does not expose the native drag interface.",
    selectionUnavailable: "The full file selection is unavailable for native drag. Clear the selection to drag one file.",
    foldersUnsupported: "Native drag supports files only. Deselect folders and try again.",
    fileUnavailable: "A selected file is missing, unavailable, or outside this vault.",
    dragFailed: "Native file drag could not start. Try a regular drag or use Show in system explorer.",
    saveFailed: "Could not save Native File Drag settings.",
  },
  "zh-CN": {
    language: "语言",
    trigger: "拖出方式",
    triggerDescription: "选择修饰键后，拖拽前先按住该键。选择「直接拖出」也会接管 Obsidian 的普通文件拖拽。",
    controlHint: "在 macOS 上，按住 Control 点按可能会打开右键菜单；如果影响拖拽，可改用 Option。",
    default: "默认",
    ctrl: IS_MAC ? "Control + 拖拽" : "Ctrl + 拖拽",
    alt: IS_MAC ? "Option + 拖拽" : "Alt + 拖拽",
    shift: "Shift + 拖拽",
    command: "Command + 拖拽",
    none: "直接拖出（接管普通文件拖拽）",
    check: "检查原生拖拽支持",
    ready: "原生拖拽接口可用。",
    unsupportedPlatform: "原生文件拖出支持 macOS 和 Windows。",
    bridgeUnavailable: "当前 Obsidian 安装未提供原生拖拽接口。",
    selectionUnavailable: "无法读取完整选集。清除选中状态后可以拖出单个文件。",
    foldersUnsupported: "原生拖拽仅支持文件。请取消选中文件夹后再试。",
    fileUnavailable: "选中的文件不存在、不可用或位于当前库之外。",
    dragFailed: "无法发起原生文件拖拽。请尝试普通拖拽，或在系统文件管理器中显示文件。",
    saveFailed: "无法保存 Native File Drag 的设置。",
  },
};

function loadSettings(data) {
  const trigger = data?.trigger;
  const validTrigger = typeof trigger === "string" && (trigger === "none" || Object.hasOwn(TRIGGERS, trigger));
  return {
    language: data?.language === "zh-CN" ? "zh-CN" : "en",
    trigger: validTrigger ? trigger : "default",
  };
}

function matchesTrigger(event, trigger) {
  if (trigger === "none") return true;
  const activeKey = trigger === "default" || (trigger === "command" && !IS_MAC)
    ? DEFAULT_TRIGGER
    : trigger;
  return Object.entries(TRIGGERS).every(([key, property]) => Boolean(event[property]) === (key === activeKey));
}

// Reject junctions and symlinks that would drag a file from outside the vault.
function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".."
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function getDragPaths(row, view) {
  const draggedPath = row.getAttribute("data-path");
  // Obsidian keeps selected rows in the tree even when virtual scrolling detaches them.
  const selection = view?.tree?.selectedDoms;
  if (typeof selection?.[Symbol.iterator] === "function") {
    const paths = Array.from(selection, (item) => item?.file?.path);
    if (paths.includes(draggedPath)) {
      return paths.every((file) => typeof file === "string" && file.length > 0) ? paths : null;
    }
  }
  // Mounted rows alone cannot tell us whether the selection is complete.
  return row.classList.contains("is-selected") ? null : [draggedPath];
}

function resolveFiles(vault, paths) {
  const adapter = vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;

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
  if (!window) return null;
  try {
    const cached = nativeDragByWindow.get(window);
    if (cached) {
      if (!cached.contents.isDestroyed()) return cached;
      nativeDragByWindow.delete(window);
      return null;
    }
    // Use the bridge already enabled by the host and get the source window's webContents.
    const electron = window.require("electron");
    const remote = window.require("@electron/remote");
    const contents = remote.getCurrentWebContents();
    if (typeof contents?.startDrag !== "function" || contents.isDestroyed()) return null;
    const icon = electron.nativeImage.createFromDataURL(DRAG_ICON);
    if (icon.isEmpty()) return null;
    const nativeDrag = { contents, icon };
    nativeDragByWindow.set(window, nativeDrag);
    return nativeDrag;
  } catch {
    nativeDragByWindow.delete(window);
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
    const triggerOptions = {
      default: `${strings.default} (${strings[DEFAULT_TRIGGER]})`,
      alt: strings.alt,
      ctrl: strings.ctrl,
      shift: strings.shift,
    };
    if (IS_MAC) triggerOptions.command = strings.command;
    triggerOptions.none = strings.none;
    containerEl.empty();

    new Setting(containerEl)
      .setName(strings.language)
      .addDropdown((dropdown) => dropdown
        .addOptions({ en: "English", "zh-CN": "简体中文" })
        .setValue(plugin.settings.language)
        .onChange((language) => {
          const saved = plugin.saveSettings({ language });
          this.display();
          return saved;
        }));

    if (!IS_SUPPORTED) {
      new Setting(containerEl).setDesc(strings.unsupportedPlatform);
      return;
    }

    new Setting(containerEl)
      .setName(strings.trigger)
      .setDesc(IS_MAC ? `${strings.triggerDescription} ${strings.controlHint}` : strings.triggerDescription)
      .addDropdown((dropdown) => dropdown
        .addOptions(triggerOptions)
        .setValue(Object.hasOwn(triggerOptions, plugin.settings.trigger) ? plugin.settings.trigger : "default")
        .onChange((trigger) => plugin.saveSettings({ trigger })));

    new Setting(containerEl)
      .setName(strings.check)
      .setDesc(plugin.getSupportMessage())
      .addButton((button) => button.setButtonText(strings.check).onClick(() => {
        new Notice(plugin.getSupportMessage());
      }));
  }
}

module.exports = class NativeFileDrag extends Plugin {
  async onload() {
    this.settings = loadSettings(await this.loadData());
    this.pendingSave = Promise.resolve();
    this.addSettingTab(new DragSettings(this.app, this));

    if (!IS_SUPPORTED) return;
    const { workspace } = this.app;
    this.dragDocuments = new Map();
    this.handleDragStart = (event) => this.onDragStart(event);
    this.register(() => {
      for (const window of this.dragDocuments.keys()) this.unregisterDragWindow(window);
    });
    this.registerEvent(workspace.on("window-open", (_workspaceWindow, window) => this.registerDragDocument(window.document)));
    this.registerEvent(workspace.on("window-close", (_workspaceWindow, window) => this.unregisterDragWindow(window)));
    this.registerDragDocument(workspace.containerEl.ownerDocument);
    workspace.iterateAllLeaves((leaf) => this.registerDragDocument(leaf.containerEl.ownerDocument));
  }

  registerDragDocument(document) {
    const window = document.defaultView;
    if (!window || this.dragDocuments.has(window)) return;
    document.addEventListener("dragstart", this.handleDragStart, true);
    this.dragDocuments.set(window, document);
  }

  unregisterDragWindow(window) {
    const document = this.dragDocuments.get(window);
    if (!document) return;
    document.removeEventListener("dragstart", this.handleDragStart, true);
    this.dragDocuments.delete(window);
    nativeDragByWindow.delete(window);
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
    if (!IS_SUPPORTED) return this.strings.unsupportedPlatform;
    const window = this.app.workspace.containerEl.ownerDocument.defaultView;
    return getNativeDrag(window) ? this.strings.ready : this.strings.bridgeUnavailable;
  }

  onDragStart(event) {
    if (!matchesTrigger(event, this.settings.trigger)) return;
    const target = event.target;
    if (target?.isContentEditable) return;
    const row = target?.closest?.(FILE_ROW);
    const explorer = row?.closest(EXPLORER);
    if (!explorer || row.classList.contains("is-being-renamed")) return;

    const view = this.app.workspace.getLeavesOfType("file-explorer")
      .find((leaf) => leaf.view.containerEl === explorer)?.view;
    if (view?.fileBeingRenamed) return;

    const paths = getDragPaths(row, view);
    if (!paths) {
      new Notice(this.strings.selectionUnavailable);
      return;
    }
    const { vault } = this.app;
    if (paths.some((file) => file && vault.getFolderByPath(file))) {
      new Notice(this.strings.foldersUnsupported);
      return;
    }
    const files = resolveFiles(vault, paths);
    if (!files?.length) {
      new Notice(this.strings.fileUnavailable);
      return;
    }

    const window = row.ownerDocument.defaultView;
    const nativeDrag = getNativeDrag(window);
    if (!nativeDrag) {
      new Notice(this.strings.bridgeUnavailable);
      return;
    }

    // Cancel the HTML drag before starting the native drag so both don't run together.
    event.preventDefault();
    event.stopImmediatePropagation();
    const { contents, icon } = nativeDrag;
    try {
      const item = { file: files[0], icon };
      if (files.length > 1) item.files = files;
      contents.startDrag(item);
    } catch {
      nativeDragByWindow.delete(window);
      new Notice(this.strings.dragFailed);
    }
  }
};
