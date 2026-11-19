"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
const FIRST = "2026-11/中文 空格 #1.md";
const SECOND = "2026-11/second.md";

function loadPlugin(platform = "win32", modules = {}) {
  const notices = [];
  class FileSystemAdapter {}
  class Plugin {}
  class PluginSettingTab {}
  class Notice {
    constructor(message) { notices.push(message); }
  }
  class Setting {
    constructor(container) { container.rows.push(this); }
    setName(name) { this.name = name; return this; }
    setDesc(description) { this.description = description; return this; }
    addDropdown(configure) {
      const row = this;
      configure({
        addOptions(options) { row.options = options; return this; },
        setValue(value) { row.value = value; return this; },
        onChange(callback) { row.change = callback; return this; },
      });
      return this;
    }
    addButton() { return this; }
  }

  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    process: { platform },
    require: (name) => name === "obsidian"
      ? { FileSystemAdapter, Notice, Plugin, PluginSettingTab, Setting }
      : (modules[name] ?? require(name)),
  }, { filename: "main.js" });
  return { FileSystemAdapter, Plugin: module.exports, notices };
}

async function fixture(t, options = {}) {
  const runtime = loadPlugin(options.platform, options.modules);
  const root = options.root ?? fs.mkdtempSync(path.join(os.tmpdir(), "native-file-drag-"));
  const diskPath = options.modules?.["node:path"] ?? path;
  const files = [FIRST, SECOND];
  if (!options.root) {
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, "2026-11"));
    for (const name of files) fs.writeFileSync(path.join(root, name), "Test note\n");
  }

  const adapter = options.nonFilesystem ? {} : new runtime.FileSystemAdapter();
  adapter.getBasePath = () => root;
  adapter.getFullPath = (file) => diskPath.join(root, file);
  const calls = [];
  const listeners = [];
  const remoteRequests = [];
  const iconDecodes = [];
  const icon = { isEmpty: () => Boolean(options.emptyIcon) };
  function createWindow(config = {}) {
    const mounted = config.mounted ?? config.selected ?? [];
    const explorer = { querySelectorAll: () => mounted.map((file) => ({ getAttribute: () => file })) };
    const dragged = config.dragged ?? FIRST;
    const window = {
      destroyed: Boolean(config.destroyed),
      require(name) {
        if (name === "electron") return { nativeImage: { createFromDataURL: (data) => {
          assert.ok(data.startsWith("data:image/png;base64,"));
          iconDecodes.push(window);
          return icon;
        } } };
        if (config.noBridge) throw new Error("No remote");
        return { getCurrentWebContents: () => {
          remoteRequests.push(window);
          return {
            isDestroyed: () => window.destroyed,
            startDrag(item) {
              assert.equal(event.cancelled, true);
              assert.equal(event.stopped, true);
              if (config.fail) throw new Error("Native failure");
              calls.push(item);
            },
          };
        } };
      },
    };
    const document = {
      defaultView: window,
      addEventListener(type, callback, capture) { listeners.push({ doc: this, type, callback, capture }); },
      removeEventListener(type, callback, capture) {
        const index = listeners.findIndex((listener) => listener.doc === this
          && listener.type === type && listener.callback === callback && listener.capture === capture);
        assert.notEqual(index, -1);
        listeners.splice(index, 1);
      },
    };
    window.document = document;
    const row = {
      getAttribute: () => dragged,
      ownerDocument: document,
      closest: () => config.outsideExplorer ? null : explorer,
      classList: { contains: (cls) => cls === "is-selected"
        ? mounted.includes(dragged)
        : cls === "is-being-renamed" && Boolean(config.renamingRow) },
    };
    const event = {
      target: { closest: () => row, isContentEditable: Boolean(config.editable) },
      ctrlKey: options.platform !== "darwin",
      altKey: options.platform === "darwin",
      preventDefault() { this.cancelled = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    const leaf = {
      containerEl: { ownerDocument: document },
      view: {
        containerEl: explorer,
        tree: config.noTree ? undefined : { selectedDoms: new Set((config.selected ?? []).map((file) => ({
          file: typeof file === "string" ? { path: file } : file,
        }))) },
        fileBeingRenamed: config.renamingFile,
      },
    };
    return { window, document, event, leaf };
  }

  const main = createWindow(options);
  const existing = options.existingWindow ? createWindow(options.existingWindow) : null;
  const leaves = [main.leaf];
  if (existing) leaves.unshift(existing.leaf);
  const events = new Map();
  const cleanup = [];

  const saved = [];
  const plugin = new runtime.Plugin();
  Object.assign(plugin, {
    app: {
      workspace: {
        containerEl: { ownerDocument: main.document },
        on(name, callback) { events.set(name, callback); return name; },
        iterateAllLeaves(callback) { leaves.forEach(callback); },
        getLeavesOfType: () => leaves,
      },
      vault: {
        adapter,
        getFileByPath: (p) => [...files, ...(options.extra ?? [])].includes(p) ? { path: p } : null,
        getFolderByPath: (p) => (options.folders ?? []).includes(p) ? { path: p } : null,
      },
    },
    loadData: async () => options.settings,
    saveData: options.saveData ?? (async (data) => { saved.push(data); }),
    addSettingTab: (tab) => { plugin.tab = tab; },
    register: (callback) => cleanup.push(callback),
    registerEvent: (name) => cleanup.push(() => events.delete(name)),
  });
  await plugin.onload();
  plugin.tab.containerEl = { rows: [], empty() { this.rows = []; } };
  return { root, files, calls, ...main, existing, leaves, events, cleanup, createWindow, remoteRequests, iconDecodes,
    icon, saved, listeners, plugin, notices: runtime.notices };
}

test("starts in English and persists an immediately applied Chinese selection", async (t) => {
  const f = await fixture(t, { settings: { language: "unknown", trigger: { toString: null } } });
  f.plugin.tab.display();
  const container = f.plugin.tab.containerEl;
  assert.equal(container.rows[0].name, "Language");
  assert.equal(container.rows[1].value, "default");
  assert.equal(container.rows[1].options.default, "Default (Ctrl + drag)");
  const saveLanguage = container.rows[0].change("zh-CN");
  assert.equal(container.rows[0].name, "语言");
  assert.equal(container.rows[2].description, "原生拖拽接口可用。");
  await saveLanguage;
  assert.equal(f.saved[0].language, "zh-CN");
  await container.rows[1].change("none");
  assert.equal(f.saved[1].trigger, "none");
  const reloaded = await fixture(t, { settings: f.saved[1] });
  reloaded.plugin.tab.display();
  assert.equal(reloaded.plugin.tab.containerEl.rows[0].value, "zh-CN");
  assert.equal(reloaded.plugin.tab.containerEl.rows[1].value, "none");
  await reloaded.plugin.tab.containerEl.rows[0].change("en");
  assert.equal(reloaded.plugin.tab.containerEl.rows[0].name, "Language");
});

test("registers the managed drag handler only on Windows and macOS", async (t) => {
  for (const platform of ["win32", "darwin"]) {
    const f = await fixture(t, { platform });
    assert.equal(f.listeners.length, 1);
    assert.equal(f.listeners[0].type, "dragstart");
    assert.equal(f.listeners[0].capture, true);
  }
  const linux = await fixture(t, { platform: "linux" });
  assert.equal(linux.listeners.length, 0);
  assert.equal(linux.events.size, 0);
  linux.plugin.tab.display();
  const { rows } = linux.plugin.tab.containerEl;
  assert.deepEqual(rows.filter((row) => row.options).map((row) => row.name), ["Language"]);
  assert.match(rows[1].description, /available on macOS and Windows/);
});

test("Ctrl hands the original file and embedded icon to Electron", async (t) => {
  const f = await fixture(t);
  f.listeners[0].callback(f.event);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].file, path.join(f.root, f.files[0]));
  assert.equal(f.calls[0].icon, f.icon);
  assert.equal(f.calls[0].files, undefined);
  assert.equal(fs.readFileSync(f.calls[0].file, "utf8"), "Test note\n");
});

test("macOS defaults to Option and supports an explicit Command trigger", async (t) => {
  const f = await fixture(t, { platform: "darwin" });
  f.plugin.tab.display();
  assert.equal(f.plugin.tab.containerEl.rows[1].options.default, "Default (Option + drag)");
  const handleDrag = f.listeners[0].callback;
  Object.assign(f.event, { altKey: false, ctrlKey: true });
  handleDrag(f.event);
  assert.equal(f.calls.length, 0);
  Object.assign(f.event, { altKey: true, ctrlKey: false });
  handleDrag(f.event);
  assert.equal(f.calls[0].file, path.join(f.root, f.files[0]));
  assert.equal(f.calls[0].icon, f.icon);
  await f.plugin.saveSettings({ trigger: "command" });
  handleDrag(f.event);
  assert.equal(f.calls.length, 1);
  Object.assign(f.event, { altKey: false, metaKey: true });
  handleDrag(f.event);
  assert.equal(f.calls.length, 2);
});

test("a Command preference uses the Windows default without changing the stored selection", async (t) => {
  const f = await fixture(t, { settings: { trigger: "command" } });
  f.plugin.tab.display();
  assert.equal(f.plugin.tab.containerEl.rows[1].value, "default");
  assert.equal(f.plugin.settings.trigger, "command");
  f.listeners[0].callback(f.event);
  assert.equal(f.calls.length, 1);
});

test("ordinary drags, combined modifiers, and other panes stay with Obsidian", async (t) => {
  const f = await fixture(t);
  for (const keys of [{ ctrlKey: false }, { shiftKey: true }, { altKey: true }, { metaKey: true }]) {
    const drag = { ...f.event, ...keys };
    f.listeners[0].callback(drag);
    assert.equal(drag.cancelled, undefined);
  }
  assert.equal(f.calls.length, 0);
  const outer = await fixture(t, { outsideExplorer: true });
  outer.listeners[0].callback(outer.event);
  assert.equal(outer.event.cancelled, undefined);
});

test("uses the selected group only when the drag starts on a selected file", async (t) => {
  const group = await fixture(t, { selected: [FIRST, SECOND, SECOND], mounted: [FIRST] });
  group.listeners[0].callback(group.event);
  assert.deepEqual([...group.calls[0].files], group.files.map((file) => path.join(group.root, file)));
  const single = await fixture(t, { selected: [SECOND], settings: { trigger: "none" } });
  single.event.ctrlKey = false;
  single.listeners[0].callback(single.event);
  assert.equal(single.calls[0].file, path.join(single.root, FIRST));
  assert.equal(single.calls[0].files, undefined);
});

test("leaves mixed and unverified selections with Obsidian rather than dragging a subset", async (t) => {
  const folder = "2026-11";
  const mixed = await fixture(t, { selected: [FIRST, folder], mounted: [FIRST], folders: [folder] });
  mixed.listeners[0].callback(mixed.event);
  assert.equal(mixed.calls.length, 0);
  assert.equal(mixed.event.cancelled, undefined);
  assert.match(mixed.notices[0], /Deselect folders/);

  for (const options of [{ noTree: true }, { selected: [FIRST, {}] }]) {
    const unknown = await fixture(t, { ...options, mounted: [FIRST] });
    unknown.listeners[0].callback(unknown.event);
    assert.equal(unknown.calls.length, 0);
    assert.equal(unknown.event.cancelled, undefined);
    assert.match(unknown.notices[0], /full file selection/);
  }

  const unselected = await fixture(t, { noTree: true });
  unselected.listeners[0].callback(unselected.event);
  assert.equal(unselected.calls[0].file, path.join(unselected.root, FIRST));
});

test("leaves text dragging and file drags during inline rename with Obsidian", async (t) => {
  for (const state of [{ editable: true }, { renamingRow: true }, { renamingFile: { path: SECOND } }]) {
    const f = await fixture(t, { ...state, settings: { trigger: "none" } });
    f.event.ctrlKey = false;
    f.listeners[0].callback(f.event);
    assert.equal(f.calls.length, 0);
    assert.equal(f.event.cancelled, undefined);
    assert.equal(f.notices.length, 0);
  }
});

test("uses the drag source window and its selection, and removes listeners on close and unload", async (t) => {
  const f = await fixture(t, { existingWindow: { selected: [SECOND] }, selected: [FIRST, SECOND] });
  const handle = (source) => f.listeners.find((listener) => listener.doc === source.document).callback(source.event);
  assert.equal(f.listeners.length, 2);
  handle(f);
  handle(f.existing);
  assert.deepEqual([...f.calls[0].files], [FIRST, SECOND].map((file) => path.join(f.root, file)));
  assert.equal(f.calls[1].files, undefined);

  const opened = f.createWindow({ dragged: SECOND });
  f.leaves.push(opened.leaf);
  f.events.get("window-open")(null, opened.window);
  f.events.get("window-open")(null, opened.window);
  assert.equal(f.listeners.length, 3);
  handle(opened);
  assert.equal(f.calls[2].file, path.join(f.root, SECOND));
  assert.deepEqual(f.remoteRequests, [f.window, f.existing.window, opened.window]);
  f.events.get("window-close")(null, opened.window);
  assert.equal(f.listeners.some(({ doc }) => doc === opened.document), false);
  for (const clean of f.cleanup) clean();
  assert.equal(f.listeners.length, 0);
  assert.equal(f.events.size, 0);
});

test("reuses the native bridge and icon until the source WebContents is destroyed", async (t) => {
  const f = await fixture(t);
  f.plugin.tab.display();
  f.plugin.tab.display();
  const handle = f.listeners[0].callback;
  handle(f.event);
  assert.equal(f.calls.length, 1);
  assert.equal(f.remoteRequests.length, 1);
  assert.equal(f.iconDecodes.length, 1);

  f.window.destroyed = true;
  delete f.event.cancelled;
  handle(f.event);
  assert.equal(f.calls.length, 1);
  assert.equal(f.event.cancelled, undefined);
  assert.match(f.notices[0], /does not expose/);
});

test("reports a failed write and resumes saving later settings in order", async (t) => {
  const writes = [];
  let rejectFirstWrite;
  const f = await fixture(t, { saveData: (settings) => {
    writes.push(settings);
    if (writes.length === 1) return new Promise((_, reject) => { rejectFirstWrite = reject; });
  } });
  const first = f.plugin.saveSettings({ language: "zh-CN" });
  const later = f.plugin.saveSettings({ trigger: "shift" });
  await Promise.resolve();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].trigger, "default");
  rejectFirstWrite(new Error("Write failed"));
  await Promise.all([first, later]);
  assert.deepEqual(f.notices, ["无法保存 Native File Drag 的设置。"]);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].language, "zh-CN");
  assert.equal(writes[1].trigger, "shift");
});

test("keeps Windows drive paths and Chinese filenames intact and rejects other drives", async (t) => {
  const root = "C:\\Users\\Writer\\My Vault";
  const fsMock = { realpathSync: (value) => value, statSync: () => ({ isFile: () => true }) };
  const modules = { "node:fs": fsMock, "node:path": path.win32 };
  const f = await fixture(t, { root, modules });
  f.listeners[0].callback(f.event);
  assert.equal(f.calls[0].file, `${root}\\2026-11\\中文 空格 #1.md`);
  const otherDrive = await fixture(t, { root, modules: {
    ...modules, "node:fs": { ...fsMock, realpathSync: (p) => p === root ? p : "D:\\outside.md" },
  } });
  otherDrive.listeners[0].callback(otherDrive.event);
  assert.equal(otherDrive.calls.length, 0);
  assert.equal(otherDrive.event.cancelled, undefined);
});

test("rejects a junction or symlink that points outside the vault", async (t) => {
  const f = await fixture(t, { dragged: "linked/outside.md", extra: ["linked/outside.md"] });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-vault-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, "outside.md"), "Outside\n");
  fs.symlinkSync(outside, path.join(f.root, "linked"), process.platform === "win32" ? "junction" : "dir");
  f.listeners[0].callback(f.event);
  assert.equal(f.calls.length, 0);
  assert.equal(f.event.cancelled, undefined);
  assert.match(f.notices[0], /outside this vault/);
});

test("preserves regular Obsidian handling if the source file or native bridge is unavailable", async (t) => {
  const missing = await fixture(t);
  fs.unlinkSync(path.join(missing.root, missing.files[0]));
  missing.listeners[0].callback(missing.event);
  assert.equal(missing.event.cancelled, undefined);
  assert.match(missing.notices[0], /missing/);
  const noBridge = await fixture(t, { noBridge: true, settings: { language: "zh-CN" } });
  noBridge.listeners[0].callback(noBridge.event);
  assert.equal(noBridge.event.cancelled, undefined);
  assert.match(noBridge.notices[0], /未提供原生拖拽接口/);
});

test("rejects a non-filesystem vault or a path that now points to a directory", async (t) => {
  const remoteVault = await fixture(t, { nonFilesystem: true });
  const changed = await fixture(t);
  const filePath = path.join(changed.root, FIRST);
  fs.unlinkSync(filePath);
  fs.mkdirSync(filePath);

  for (const f of [remoteVault, changed]) {
    f.listeners[0].callback(f.event);
    assert.equal(f.calls.length, 0);
    assert.equal(f.event.cancelled, undefined);
    assert.match(f.notices[0], /unavailable/);
  }
});

test("an empty drag icon keeps macOS on the normal drag path", async (t) => {
  const f = await fixture(t, { platform: "darwin", emptyIcon: true });
  f.listeners[0].callback(f.event);
  assert.equal(f.calls.length, 0);
  assert.equal(f.event.cancelled, undefined);
  assert.match(f.notices[0], /does not expose the native drag interface/);
});

test("reports a native failure in the selected language", async (t) => {
  const f = await fixture(t, { fail: true, settings: { language: "zh-CN", trigger: "alt" } });
  Object.assign(f.event, { ctrlKey: false, altKey: true });
  f.listeners[0].callback(f.event);
  assert.equal(f.event.cancelled, true);
  assert.match(f.notices[0], /无法发起原生文件拖拽/);
  assert.equal(fs.readFileSync(path.join(f.root, f.files[0]), "utf8"), "Test note\n");
});
