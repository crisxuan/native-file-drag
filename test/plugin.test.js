"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");

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
  const files = ["2026-11/中文 空格 #1.md", "2026-11/second.md"];
  if (!options.root) {
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, "2026-11"));
    for (const name of files) fs.writeFileSync(path.join(root, name), "Test note\n");
  }

  const adapter = new runtime.FileSystemAdapter();
  adapter.getBasePath = () => root;
  adapter.getFullPath = (file) => diskPath.join(root, file);
  const calls = [];
  const icon = { isEmpty: () => Boolean(options.emptyIcon) };
  const window = {
    require(name) {
      if (name === "electron") return { nativeImage: { createFromDataURL: (data) => {
        assert.ok(data.startsWith("data:image/png;base64,"));
        return icon;
      } } };
      if (options.noBridge) throw new Error("No remote");
      return { getCurrentWebContents: () => ({
        isDestroyed: () => false,
        startDrag(item) {
          assert.equal(event.cancelled, true);
          assert.equal(event.stopped, true);
          if (options.fail) throw new Error("Native failure");
          calls.push(item);
        },
      }) };
    },
  };
  const document = { defaultView: window };
  const explorer = { querySelectorAll: () => (options.selected ?? []).map((name) => ({ getAttribute: () => name })) };
  const row = {
    getAttribute: () => options.dragged ?? files[0],
    ownerDocument: document,
    closest: () => options.outsideExplorer ? null : explorer,
  };
  const event = {
    target: { closest: () => row },
    ctrlKey: options.platform !== "darwin",
    altKey: options.platform === "darwin",
    preventDefault() { this.cancelled = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };

  const saved = [];
  const listeners = [];
  const plugin = new runtime.Plugin();
  Object.assign(plugin, {
    app: {
      workspace: { containerEl: { ownerDocument: document } },
      vault: { adapter, getFileByPath: (p) => [...files, ...(options.extra ?? [])].includes(p) ? { path: p } : null },
    },
    loadData: async () => options.settings,
    saveData: async (data) => { saved.push(data); },
    addSettingTab: (tab) => { plugin.tab = tab; },
    registerDomEvent: (doc, type, callback, flags) => { listeners.push({ doc, type, callback, flags }); },
  });
  await plugin.onload();
  plugin.tab.containerEl = { rows: [], empty() { this.rows = []; } };
  return { root, files, calls, event, icon, saved, listeners, plugin, notices: runtime.notices };
}

test("starts in English and persists an immediately applied Chinese selection", async (t) => {
  const f = await fixture(t, { settings: { language: "unknown", trigger: { toString: null } } });
  f.plugin.tab.display();
  const container = f.plugin.tab.containerEl;
  assert.equal(container.rows[0].name, "Language");
  assert.equal(container.rows[1].value, "default");
  assert.equal(container.rows[1].options.default, "Default (Ctrl + drag)");
  container.rows[0].change("zh-CN");
  assert.equal(container.rows[0].name, "语言");
  assert.equal(container.rows[2].description, "原生拖拽接口可用。");
  await container.rows[1].change("none");
  assert.equal(f.saved[0].language, "zh-CN");
  assert.equal(f.saved[1].trigger, "none");
  const reloaded = await fixture(t, { settings: f.saved[1] });
  reloaded.plugin.tab.display();
  assert.equal(reloaded.plugin.tab.containerEl.rows[0].value, "zh-CN");
  assert.equal(reloaded.plugin.tab.containerEl.rows[1].value, "none");
  reloaded.plugin.tab.containerEl.rows[0].change("en");
  await reloaded.plugin.pendingSave;
  assert.equal(reloaded.plugin.tab.containerEl.rows[0].name, "Language");
});

test("registers the managed drag handler only on Windows and macOS", async (t) => {
  for (const platform of ["win32", "darwin"]) {
    const f = await fixture(t, { platform });
    assert.equal(f.listeners.length, 1);
    assert.equal(f.listeners[0].type, "dragstart");
    assert.equal(f.listeners[0].flags.capture, true);
  }
  const linux = await fixture(t, { platform: "linux" });
  assert.equal(linux.listeners.length, 0);
  assert.match(linux.plugin.getSupportMessage(), /available on macOS and Windows/);
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
  const first = "2026-11/中文 空格 #1.md";
  const second = "2026-11/second.md";
  const group = await fixture(t, { selected: [first, second, second] });
  group.listeners[0].callback(group.event);
  assert.deepEqual([...group.calls[0].files], group.files.map((file) => path.join(group.root, file)));
  const single = await fixture(t, { selected: [second], settings: { trigger: "none" } });
  single.event.ctrlKey = false;
  single.listeners[0].callback(single.event);
  assert.equal(single.calls[0].file, path.join(single.root, first));
  assert.equal(single.calls[0].files, undefined);
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
