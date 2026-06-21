import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const APP_URL = process.env.J3MARKDOWN_E2E_URL ?? "http://127.0.0.1:1420";
const REPO_ROOT = new URL("..", import.meta.url);
const CHROME_PORT = Number(process.env.J3MARKDOWN_E2E_CHROME_PORT ?? 9338);

const TAURI_TEST_MOCK = String.raw`
var __UNSAVED_TEST_PARAMS__ = new URLSearchParams(window.location.search);
var __UNSAVED_TEST_DELAY_LAUNCH_PATHS__ =
  __UNSAVED_TEST_PARAMS__.get('delayLaunchPaths') === '1';

function isCloseRequestedListener(cmd, args = {}) {
  const eventName = typeof args.event === 'string' ? args.event : '';
  const targetKind = args.target?.kind;

  return (
    cmd === 'plugin:event|listen' &&
    eventName.includes('close-requested') &&
    (targetKind === undefined || targetKind === 'Window')
  );
}

window.__UNSAVED_TEST__ = {
  invocations: [],
  callbacks: {},
  callbackSeq: 1,
  delayedStartupCommands: [],
  delayedStartupResolvers: [],
  saveMode: 'success',
  saveAsMode: 'success',
  closeListenerMode: __UNSAVED_TEST_PARAMS__.get('closeListenerMode') || 'success',
  closeCallCount: 0,
  destroyCallCount: 0,
  openFile: {
    path: 'C:\\Notes\\Saved.md',
    title: 'Saved.md',
    content: '# Saved'
  },
  saveAsResult: {
    path: 'C:\\Notes\\UntitledSaved.md',
    title: 'UntitledSaved.md'
  },
  isCloseRequestedListener
};

window.__UNSAVED_TEST__.releaseDelayedStartupCommands = () => {
  const resolvers = window.__UNSAVED_TEST__.delayedStartupResolvers.splice(0);
  for (const resolve of resolvers) {
    resolve();
  }
};

function delayStartupCommand(command) {
  if (!__UNSAVED_TEST_DELAY_LAUNCH_PATHS__ || command !== 'get_launch_paths') {
    return Promise.resolve();
  }

  window.__UNSAVED_TEST__.delayedStartupCommands.push(command);
  return new Promise((resolve) => {
    window.__UNSAVED_TEST__.delayedStartupResolvers.push(resolve);
  });
}

window.__TAURI_INTERNALS__ = {
  metadata: {
    currentWindow: { label: 'main' },
    currentWebview: { label: 'main' }
  },
  invoke: async (cmd, args = {}) => {
    window.__UNSAVED_TEST__.invocations.push({ cmd, args });

    if (cmd === 'get_launch_paths') {
      await delayStartupCommand(cmd);
      return [];
    }

    if (cmd === 'get_about_info') {
      return {
        version: '0.1.0-test',
        githubUrl: 'https://github.com/edgarp9'
      };
    }

    if (cmd === 'get_about_text') {
      return [
        'j3Markdown',
        '',
        'Version: 0.1.0-test',
        'Source code for this release:',
        'https://github.com/edgarp9',
        '',
        'THIRD_PARTY_NOTICES.txt'
      ].join('\n');
    }

    if (cmd === 'open_about_link') {
      return null;
    }

    if (cmd === 'open_markdown_file') {
      return window.__UNSAVED_TEST__.openFile;
    }

    if (cmd === 'open_markdown_file_at_path') {
      return {
        path: args.path,
        title: args.path.split(/[\\/]/).pop() || 'Opened.md',
        content: '# Opened'
      };
    }

    if (cmd === 'save_markdown_file') {
      if (window.__UNSAVED_TEST__.saveMode === 'fail') {
        throw 'forced save failure';
      }

      return {
        path: args.path,
        title: args.path.split(/[\\/]/).pop() || 'Saved.md'
      };
    }

    if (cmd === 'select_markdown_save_path') {
      if (window.__UNSAVED_TEST__.saveAsMode === 'fail') {
        throw 'forced save-as failure';
      }

      if (window.__UNSAVED_TEST__.saveAsMode === 'cancel') {
        return null;
      }

      return window.__UNSAVED_TEST__.saveAsResult.path;
    }

    if (cmd === 'save_markdown_file_as') {
      if (window.__UNSAVED_TEST__.saveAsMode === 'fail') {
        throw 'forced save-as failure';
      }

      if (window.__UNSAVED_TEST__.saveAsMode === 'cancel') {
        return null;
      }

      return window.__UNSAVED_TEST__.saveAsResult;
    }

    if (cmd === 'plugin:event|listen') {
      if (
        window.__UNSAVED_TEST__.isCloseRequestedListener(cmd, args) &&
        window.__UNSAVED_TEST__.closeListenerMode === 'fail'
      ) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        throw 'forced close listener failure';
      }

      return Object.keys(window.__UNSAVED_TEST__.callbacks).length + 1;
    }

    if (cmd === 'plugin:event|unlisten') {
      return null;
    }

    if (cmd === 'plugin:window|close') {
      window.__UNSAVED_TEST__.closeCallCount += 1;
      throw new Error('window close must not be used after confirmed close protection');
    }

    if (cmd === 'plugin:window|destroy') {
      window.__UNSAVED_TEST__.destroyCallCount += 1;
      return null;
    }

    return null;
  },
  transformCallback: (callback) => {
    const id = window.__UNSAVED_TEST__.callbackSeq;
    window.__UNSAVED_TEST__.callbackSeq += 1;
    window.__UNSAVED_TEST__.callbacks[id] = callback;
    return id;
  }
};
`;

async function run() {
  const devServer = await ensureDevServer();
  const chrome = await launchChrome();

  try {
  const cdp = await ChromeCdp.connect(CHROME_PORT);
  const sessionId = await cdp.createPageSession();

  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send(
    "Page.addScriptToEvaluateOnNewDocument",
    { source: TAURI_TEST_MOCK },
    sessionId,
  );

  const page = new AppPage(cdp, sessionId);
  const results = [];

  await page.load("window-close-listener-failure", {
    closeListenerMode: "fail",
    waitForEditor: false,
  });
  await page.waitFor(
    "document.querySelector('dialog[open] h2')?.textContent === 'Close Confirmation Error'",
    "window close guard failure modal",
  );
  let info = await page.modalInfo();
  assert.equal(info.ariaModal, "true");
  assert.equal(info.activeText, "OK");
  assert.equal(
    info.text.includes(
      "Close confirmation could not be registered, so temporary close protection is active.",
    ),
    true,
  );
  assert.equal(info.text.includes("forced close listener failure"), true);
  await page.choose("ok");
  await page.waitForNoDialog("window close guard failure modal close");
  results.push("window close listener registration failure is shown as a modal error");

  await page.loadShellBeforeLaunchPaths("startup-shell-before-launch-paths");
  info = await page.modalInfo();
  assert.equal(info.tabTitles[0], "Untitled.md");
  assert.equal(info.invocations.some(isShowCommand), true);
  await page.evaluate("window.__UNSAVED_TEST__.releaseDelayedStartupCommands()");
  await page.waitForActiveEditor();
  results.push("startup renders the editor shell before launch path IPC completes");

  await page.load("clean-opened-list-close");
  await page.openSavedFile("C:\\Notes\\List.md", "List.md", "# Heading\n\n- one\n- two");
  await delay(1200);
  info = await page.modalInfo();
  assert.deepEqual(info.tabTitles, ["List.md"]);
  await page.clickActiveTabClose();
  await page.waitForNoDialog("clean opened list close");
  info = await page.modalInfo();
  assert.deepEqual(info.tabTitles, ["Untitled-2.md"]);
  assert.equal(info.invocations.some(isSaveCommand), false);
  results.push("opened list documents stay clean after Milkdown initialization");

  await page.load("clean-opened-nested-list-window-close");
  await page.openSavedFile(
    "C:\\Notes\\PromptLike.md",
    "PromptLike.md",
    createNestedListNormalizationMarkdown(),
  );
  await delay(2500);
  info = await page.modalInfo();
  assert.deepEqual(info.tabTitles, ["PromptLike.md"]);
  await page.triggerWindowClose();
  await page.waitForNoDialog("clean nested-list prompt window close");
  info = await page.modalInfo();
  assert.equal(info.destroyCallCount, 1);
  assert.equal(info.invocations.some(isSaveCommand), false);
  results.push("opened nested-list documents stay clean after delayed Milkdown normalization");

  await page.load("clean-opened-large-close");
  await page.openSavedFile(
    "C:\\Notes\\Large.md",
    "Large.md",
    createLargeMarkdown("large opened clean close"),
  );
  await delay(1600);
  info = await page.modalInfo();
  assert.deepEqual(info.tabTitles, ["Large.md"]);
  await page.clickActiveTabClose();
  await page.waitForNoDialog("clean opened large close");
  info = await page.modalInfo();
  assert.deepEqual(info.tabTitles, ["Untitled-2.md"]);
  assert.equal(info.invocations.some(isSaveCommand), false);
  results.push("large opened documents stay clean after pending editor transactions");

  await page.load("clean-opened-large-window-close");
  await page.openSavedFile(
    "C:\\Notes\\LargeWindowClose.md",
    "LargeWindowClose.md",
    createLargeMarkdown("large opened clean window close"),
  );
  await page.triggerWindowClose();
  await page.waitForNoDialog("clean large window close");
  info = await page.modalInfo();
  assert.equal(info.destroyCallCount, 1);
  assert.equal(info.invocations.some(isSaveCommand), false);
  results.push("large clean opened documents do not show unsaved dialog on window close");

  await page.load("large-undo-clean-close");
  await page.openSavedFile(
    "C:\\Notes\\LargeUndo.md",
    "LargeUndo.md",
    createVeryLargeMarkdown("large undo clean close"),
  );
  await page.edit("temporary dirty edit");
  await page.pressCtrlShortcut("z");
  await page.waitFor(
    "!document.querySelector('.ProseMirror')?.textContent?.includes('temporary dirty edit')",
    "large document undo restored editor text",
  );
  await page.clickActiveTabClose();
  await page.waitForNoDialog("large undo clean close");
  info = await page.modalInfo();
  assert.deepEqual(info.tabTitles, ["Untitled-2.md"]);
  assert.equal(info.invocations.some(isSaveCommand), false);
  results.push("large documents restored to saved content close without unsaved dialog");

  await page.load("clean-opened-crlf-close");
  await page.openSavedFile(
    "C:\\Notes\\Crlf.md",
    "Crlf.md",
    "# CRLF\r\n\r\nThis file uses Windows line endings.\r\n",
  );
  await delay(1200);
  info = await page.modalInfo();
  assert.deepEqual(info.tabTitles, ["Crlf.md"]);
  await page.clickActiveTabClose();
  await page.waitForNoDialog("clean opened CRLF close");
  info = await page.modalInfo();
  assert.deepEqual(info.tabTitles, ["Untitled-2.md"]);
  assert.equal(info.invocations.some(isSaveCommand), false);
  results.push("opened CRLF documents stay clean after Milkdown serialization");

  await page.load("clean-opened-whitespace-close");
  await page.openSavedFile(
    "C:\\Notes\\Whitespace.md",
    "Whitespace.md",
    "\r\n\r\n  \t\r\n",
  );
  await delay(1200);
  info = await page.modalInfo();
  assert.deepEqual(info.tabTitles, ["Whitespace.md"]);
  await page.clickActiveTabClose();
  await page.waitForNoDialog("clean opened whitespace-only close");
  info = await page.modalInfo();
  assert.deepEqual(info.tabTitles, ["Untitled-2.md"]);
  assert.equal(info.invocations.some(isSaveCommand), false);
  results.push("opened whitespace-only documents stay clean after Milkdown normalization");

  await page.load("cancel-click");
  await page.edit("cancel flow");
  await page.closeActiveTab();
  info = await page.modalInfo();
  assert.equal(info.open, true);
  assert.equal(info.ariaModal, "true");
  assert.equal(info.hasDescription, true);
  assert.equal(info.activeValue, "cancel");
  await page.choose("cancel");
  await page.waitForNoDialog("cancel dialog close");
  info = await page.modalInfo();
  assert.equal(info.tabTitles.length, 1);
  assert.equal(info.tabTitles[0].startsWith("* "), true);
  results.push("dirty tab close cancel keeps the dirty tab open");

  await page.load("escape");
  await page.edit("escape flow");
  await page.closeActiveTab();
  await cdp.send(
    "Input.dispatchKeyEvent",
    {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    },
    sessionId,
  );
  await page.waitForNoDialog("Escape closes modal");
  info = await page.modalInfo();
  assert.equal(info.tabTitles.length, 1);
  assert.equal(info.tabTitles[0].startsWith("* "), true);
  results.push("Escape cancels the modal and preserves the dirty tab");

  await page.load("shortcut-save");
  await page.openSavedFile("C:\\Notes\\ShortcutSave.md", "ShortcutSave.md", "# Shortcut Save");
  await page.edit(" saved by shortcut");
  await page.pressCtrlShortcut("s");
  await page.waitFor(
    "!document.querySelector('.tab-bar__tab[aria-selected=\"true\"]')?.textContent?.startsWith('* ')",
    "Ctrl+S clears dirty state",
  );
  info = await page.modalInfo();
  assert.equal(
    info.invocations.some(
      (call) =>
        call.cmd === "save_markdown_file" && call.args.path === "C:\\Notes\\ShortcutSave.md",
    ),
    true,
  );
  results.push("Ctrl+S saves a path-backed dirty tab");

  await page.load("shortcut-save-untitled");
  await page.edit("untitled saved by shortcut");
  await page.pressCtrlShortcut("s");
  await page.waitFor(
    "document.querySelector('.tab-bar__tab[aria-selected=\"true\"]')?.textContent === 'UntitledSaved.md'",
    "Ctrl+S Save As updates untitled tab",
  );
  info = await page.modalInfo();
  assert.equal(
    info.invocations.some(
      (call) => call.cmd === "select_markdown_save_path" && call.args.suggestedPath === null,
    ),
    true,
  );
  results.push("Ctrl+S uses Save As for an untitled dirty tab");

  await page.load("shortcut-clean-close");
  await page.openSavedFile("C:\\Notes\\ShortcutClean.md", "ShortcutClean.md", "# Shortcut Clean");
  await page.pressCtrlShortcut("w");
  await page.waitForNoDialog("Ctrl+W clean close");
  await page.waitFor(
    "document.querySelector('.tab-bar__tab[aria-selected=\"true\"]')?.textContent === 'Untitled-2.md'",
    "Ctrl+W replaces clean final tab",
  );
  info = await page.modalInfo();
  assert.equal(info.invocations.some(isSaveCommand), false);
  results.push("Ctrl+W closes a clean active tab without saving");

  await page.load("shortcut-dirty-close");
  await page.edit("dirty close by shortcut");
  await page.pressCtrlShortcut("w");
  await page.waitForDialog("Ctrl+W dirty close dialog");
  info = await page.modalInfo();
  assert.equal(info.open, true);
  assert.equal(info.ariaModal, "true");
  assert.equal(info.text.includes("Save"), true);
  await page.choose("cancel");
  await page.waitForNoDialog("Ctrl+W dirty close cancel");
  info = await page.modalInfo();
  assert.equal(info.tabTitles.length, 1);
  assert.equal(info.tabTitles[0].startsWith("* "), true);
  results.push("Ctrl+W protects a dirty active tab with the unsaved modal");

  await page.load("discard");
  await page.edit("discard flow");
  await page.closeActiveTab();
  await page.choose("discard");
  await page.waitForNoDialog("discard dialog close");
  info = await page.modalInfo();
  assert.equal(info.tabTitles.length, 1);
  assert.equal(info.tabTitles[0].startsWith("* "), false);
  assert.equal(info.invocations.some(isSaveCommand), false);
  results.push("discard closes the dirty tab without saving");

  await page.load("saved-save");
  await page.openSavedFile("C:\\Notes\\SaveClose.md", "SaveClose.md", "# Saved");
  await page.edit(" edited");
  await page.closeActiveTab();
  await page.choose("save");
  await page.waitForNoDialog("save dialog close");
  info = await page.modalInfo();
  assert.equal(info.tabTitles.length, 1);
  assert.equal(info.tabTitles[0].startsWith("* "), false);
  assert.equal(
    info.invocations.some(
      (call) =>
        call.cmd === "save_markdown_file" && call.args.path === "C:\\Notes\\SaveClose.md",
    ),
    true,
  );
  results.push("save choice saves a path-backed dirty tab before closing");

  await page.load("untitled-save");
  await page.edit("untitled save flow");
  await page.closeActiveTab();
  await page.choose("save");
  await page.waitForNoDialog("save-as success dialog close");
  info = await page.modalInfo();
  assert.equal(info.tabTitles.length, 1);
  assert.equal(info.tabTitles[0].startsWith("* "), false);
  assert.equal(
    info.invocations.some(
      (call) => call.cmd === "select_markdown_save_path" && call.args.suggestedPath === null,
    ),
    true,
  );
  results.push("save choice on an untitled tab uses Save As before closing");

  await page.load("untitled-save-cancel");
  await page.edit("untitled save cancel flow");
  await page.evaluate("window.__UNSAVED_TEST__.saveAsMode = 'cancel'");
  await page.closeActiveTab();
  await page.choose("save");
  await page.waitForNoDialog("save-as cancel closes prompt");
  info = await page.modalInfo();
  assert.equal(info.tabTitles.length, 1);
  assert.equal(info.tabTitles[0].startsWith("* "), true);
  assert.equal(info.closeCallCount, 0);
  assert.equal(info.destroyCallCount, 0);
  results.push("Save As cancel keeps an untitled dirty tab open");

  await page.load("save-fail");
  await page.openSavedFile("C:\\Notes\\Failure.md", "Failure.md", "# Failure");
  await page.edit(" failing edit");
  await page.evaluate("window.__UNSAVED_TEST__.saveMode = 'fail'");
  await page.closeActiveTab();
  await page.choose("save");
  await page.waitFor(
    "document.querySelector('dialog[open] h2')?.textContent === 'Save Failed'",
    "save failure error modal",
  );
  info = await page.modalInfo();
  assert.equal(info.open, true);
  assert.equal(info.ariaModal, "true");
  assert.equal(info.activeText, "OK");
  assert.equal(info.tabTitles.includes("* Failure.md"), true);
  assert.equal(info.closeCallCount, 0);
  assert.equal(info.destroyCallCount, 0);
  await page.choose("ok");
  await page.waitForNoDialog("error modal close");
  info = await page.modalInfo();
  assert.equal(info.tabTitles.includes("* Failure.md"), true);
  results.push("save failure shows a modal error and keeps the dirty tab open");

  await page.load("multi-close-cancel");
  await page.openSavedFile("C:\\Notes\\One.md", "One.md", "# One");
  await page.edit(" one dirty");
  await page.clickToolbar("new");
  await page.waitFor("document.querySelectorAll('.tab-bar__tab').length === 2", "second tab");
  await page.edit("two dirty");
  await page.triggerWindowClose();
  await page.waitForDialog("first window close dialog");
  info = await page.modalInfo();
  assert.equal(info.text.includes("before closing the app"), true);
  await page.choose("discard");
  await page.waitForDialog("second window close dialog");
  await page.choose("cancel");
  await page.waitForNoDialog("window close cancel stops");
  info = await page.modalInfo();
  assert.equal(info.closeCallCount, 0);
  assert.equal(info.destroyCallCount, 0);
  assert.equal(info.tabTitles.some((title) => title.startsWith("* ")), true);
  results.push("window close resolves multiple dirty tabs one at a time and cancel stops close");

  await page.load("close-other-tabs-cancel");
  await page.openSavedFile("C:\\Notes\\Keep.md", "Keep.md", "# Keep");
  await page.clickToolbar("new");
  await page.waitFor("document.querySelectorAll('.tab-bar__tab').length === 2", "other tab");
  await page.edit("dirty other tab");
  await page.closeOtherTabs("Keep.md");
  await page.waitForDialog("close other tabs dirty prompt");
  info = await page.modalInfo();
  assert.equal(info.text.includes("Save"), true);
  await page.choose("cancel");
  await page.waitForNoDialog("close other tabs cancel");
  info = await page.modalInfo();
  assert.equal(info.tabTitles.length, 2);
  assert.equal(info.tabTitles.includes("Keep.md"), true);
  assert.equal(info.tabTitles.some((title) => title.startsWith("* ")), true);
  results.push("close other tabs uses dirty-tab protection and cancel stops the batch");

  await page.load("window-close-save-fail");
  await page.openSavedFile("C:\\Notes\\FailExit.md", "FailExit.md", "# FailExit");
  await page.edit(" dirty");
  await page.evaluate("window.__UNSAVED_TEST__.saveMode = 'fail'");
  await page.triggerWindowClose();
  await page.waitForDialog("window save failure choice dialog");
  await page.choose("save");
  await page.waitFor(
    "document.querySelector('dialog[open] h2')?.textContent === 'Save Failed'",
    "window save failure error",
  );
  info = await page.modalInfo();
  assert.equal(info.closeCallCount, 0);
  assert.equal(info.destroyCallCount, 0);
  assert.equal(info.tabTitles.includes("* FailExit.md"), true);
  results.push("window close save failure does not close the app and leaves the tab dirty");

  await page.load("window-close-success");
  await page.openSavedFile("C:\\Notes\\First.md", "First.md", "# First");
  await page.edit(" first dirty");
  await page.clickToolbar("new");
  await page.waitFor("document.querySelectorAll('.tab-bar__tab').length === 2", "new tab");
  await page.edit("second dirty");
  await page.triggerWindowClose();
  await page.waitForDialog("window close first success dialog");
  await page.choose("save");
  await page.waitForDialog("window close second success dialog");
  await page.choose("discard");
  await page.waitFor("window.__UNSAVED_TEST__.destroyCallCount === 1", "mock window destroy called");
  info = await page.modalInfo();
  assert.equal(info.closeCallCount, 0);
  assert.equal(info.destroyCallCount, 1);
  assert.equal(
    info.invocations.some(
      (call) => call.cmd === "save_markdown_file" && call.args.path === "C:\\Notes\\First.md",
    ),
    true,
  );
  results.push("window close succeeds only after every dirty tab is saved or discarded");

  const importantLogs = cdp.logs.filter((log) => log.type !== "debug");
  assert.deepEqual(importantLogs, []);

  console.log(`Unsaved protection e2e passed (${results.length} checks).`);
  for (const result of results) {
    console.log(`- ${result}`);
  }
  } finally {
    chrome.kill();
    devServer.kill();
  }
}

function isSaveCommand(call) {
  return call.cmd === "save_markdown_file" || call.cmd === "save_markdown_file_as";
}

function isShowCommand(call) {
  return call.cmd === "plugin:window|show";
}

function createLargeMarkdown(label) {
  return Array.from({ length: 900 }, (_, index) => {
    return `${label} line ${String(index).padStart(4, "0")} keeps this opened document over the pending-change threshold.`;
  }).join("\n");
}

function createVeryLargeMarkdown(label) {
  return Array.from({ length: 2400 }, (_, index) => {
    return `${label} line ${String(index).padStart(4, "0")} keeps this opened document over the saved-comparison threshold.`;
  }).join("\n");
}

function createNestedListNormalizationMarkdown() {
  return [
    "작업 지침:",
    "",
    "1. 저장소 구조를 먼저 확인하세요.",
    "   - package.json, pnpm-lock.yaml, Cargo.toml, THIRD_PARTY_NOTICES.txt 파일을 검색하세요.",
    "   - 이미 존재하는 LICENSE, NOTICE, THIRD_PARTY_NOTICES.txt를 확인하세요.",
    "",
    "2. 사용 중인 직접/간접 라이브러리를 조사하세요.",
    "   - dev-only 의존성과 런타임/배포 의존성을 구분하세요.",
    "   - 라이선스가 불명확한 항목은 “검토 필요”로 표시하세요.",
  ].join("\n");
}

async function ensureDevServer() {
  if (await isHttpAvailable(APP_URL)) {
    return {
      kill() {},
    };
  }

  const pnpmCommand = getPnpmSpawnCommand();
  const proc = spawn(pnpmCommand.command, [...pnpmCommand.args, "dev"], {
    cwd: fileURLToPath(REPO_ROOT),
    env: process.env,
    shell: pnpmCommand.shell,
    stdio: "pipe",
  });
  let output = "";

  proc.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  proc.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    await waitUntil(async () => isHttpAvailable(APP_URL), "Vite dev server", 120);
  } catch (error) {
    killProcessTree(proc);
    throw new Error(`${error.message}\n${output}`);
  }

  return {
    kill() {
      killProcessTree(proc);
    },
  };
}

function getPnpmSpawnCommand() {
  if (process.platform !== "win32") {
    return { command: "pnpm", args: [], shell: false };
  }

  return { command: "corepack", args: ["pnpm"], shell: true };
}

function killProcessTree(proc) {
  if (!proc.pid) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }

  proc.kill();
}

async function isHttpAvailable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function launchChrome() {
  const chromePath = findChromeExecutable();
  const userDataDir = `${process.env.TEMP ?? "."}\\j3markdown-unsaved-e2e-${Date.now()}`;
  const proc = spawn(
    chromePath,
    [
      `--remote-debugging-port=${CHROME_PORT}`,
      `--user-data-dir=${userDataDir}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  await waitUntil(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`);
      return response.ok;
    } catch {
      return false;
    }
  }, "headless Chrome");

  return proc;
}

function findChromeExecutable() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const candidates =
    process.platform === "win32"
      ? [
          `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ];

  const chromePath = candidates.find((candidate) => candidate && existsSync(candidate));

  if (!chromePath) {
    throw new Error("Chrome or Edge executable was not found. Set CHROME_PATH to run e2e tests.");
  }

  return chromePath;
}

async function waitUntil(predicate, label, attempts = 500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) {
      return;
    }

    await delay(100);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

class ChromeCdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.logs = [];

    socket.addEventListener("message", (event) => {
      this.handleMessage(JSON.parse(event.data));
    });
  }

  static async connect(port) {
    const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
    return new ChromeCdp(socket);
  }

  async createPageSession() {
    const target = await this.send("Target.createTarget", { url: "about:blank" });
    await this.send("Target.activateTarget", { targetId: target.targetId });
    const attached = await this.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    return attached.sessionId;
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId;
    this.nextId += 1;
    this.socket.send(JSON.stringify({ id, method, params, sessionId }));

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  handleMessage(message) {
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);

      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
        return;
      }

      resolve(message.result);
      return;
    }

    if (message.method === "Runtime.consoleAPICalled") {
      this.logs.push({
        type: message.params.type,
        args: message.params.args.map((arg) => arg.value ?? arg.description),
      });
    }

    if (message.method === "Runtime.exceptionThrown") {
      this.logs.push({
        type: "exception",
        args: [
          message.params.exceptionDetails.text,
          message.params.exceptionDetails.exception?.description,
        ],
      });
    }
  }

  kill() {
    this.socket.close();
  }
}

class AppPage {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
  }

  async load(name, options = {}) {
    const loadToken = `${name}-${Date.now()}`;
    const params = new URLSearchParams({
      unsaved: loadToken,
    });
    if (options.closeListenerMode) {
      params.set("closeListenerMode", options.closeListenerMode);
    }

    await this.cdp.send(
      "Page.navigate",
      { url: `${APP_URL}/?${params}` },
      this.sessionId,
    );
    await this.waitFor(
      `new URLSearchParams(location.search).get("unsaved") === ${JSON.stringify(loadToken)}`,
      "page navigation",
    );
    if (options.waitForEditor !== false) {
      await this.waitFor("Boolean(document.querySelector('.ProseMirror'))", "editor mount");
    } else {
      await this.waitFor("Boolean(document.querySelector('.app-shell'))", "app shell");
    }
    await delay(200);
  }

  async loadShellBeforeLaunchPaths(name) {
    const loadToken = `${name}-${Date.now()}`;
    const params = new URLSearchParams({
      unsaved: loadToken,
      delayLaunchPaths: "1",
    });

    await this.cdp.send(
      "Page.navigate",
      { url: `${APP_URL}/?${params}` },
      this.sessionId,
    );
    await this.waitFor(
      `new URLSearchParams(location.search).get("unsaved") === ${JSON.stringify(loadToken)}`,
      "page navigation",
    );
    await this.waitFor(
      "Boolean(document.querySelector('.app-shell')) && window.__UNSAVED_TEST__.delayedStartupCommands.includes('get_launch_paths')",
      "startup shell before launch path IPC resolves",
    );
  }

  async edit(text) {
    await this.waitForActiveEditor();
    await this.evaluate("document.querySelector('.ProseMirror').focus()");
    await this.cdp.send("Input.insertText", { text }, this.sessionId);
    await this.waitFor(
      "document.querySelector('.tab-bar__tab[aria-selected=\"true\"]')?.textContent?.startsWith('* ')",
      "active dirty tab",
    );
  }

  async openSavedFile(path, title, content) {
    await this.evaluate(
      `window.__UNSAVED_TEST__.openFile = {
        path: ${JSON.stringify(path)},
        title: ${JSON.stringify(title)},
        content: ${JSON.stringify(content)}
      }`,
    );
    await this.clickToolbar("open");
    await this.waitFor(
      `document.querySelector('.tab-bar__tab[aria-selected="true"]')?.textContent?.includes(${JSON.stringify(title)})`,
      `open ${title}`,
    );
    await this.waitForActiveEditor();
  }

  async clickToolbar(action) {
    await this.evaluate(`document.querySelector('[data-action="${action}"]').click()`);
  }

  async closeActiveTab() {
    await this.clickActiveTabClose();
    await this.waitForDialog("unsaved dialog");
  }

  async clickActiveTabClose() {
    await this.evaluate(`
      document
        .querySelector('.tab-bar__tab[aria-selected="true"]')
        .parentElement
        .querySelector('.tab-bar__close')
        .click()
    `);
  }

  async closeOtherTabs(title) {
    await this.evaluate(
      `(() => {
        const tab = Array.from(document.querySelectorAll('.tab-bar__tab')).find((candidate) => {
          return candidate.textContent?.includes(${JSON.stringify(title)});
        });
        if (!tab) {
          throw new Error(${JSON.stringify(`tab not found: ${title}`)});
        }

        const rect = tab.getBoundingClientRect();
        tab.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          buttons: 2,
          clientX: rect.left + 8,
          clientY: rect.top + 8
        }));
      })()`,
    );
    await this.waitFor(
      "Boolean(document.querySelector('.tab-context-menu .editor-context-menu__item[data-context-action=\"close-other-tabs\"]'))",
      "close other tabs menu",
    );
    await this.evaluate(
      `document.querySelector('.tab-context-menu .editor-context-menu__item[data-context-action="close-other-tabs"]').click()`,
    );
  }

  async choose(value) {
    await this.evaluate(`document.querySelector('dialog[open] button[value="${value}"]').click()`);
    await delay(350);
  }

  async pressCtrlShortcut(key) {
    const normalizedKey = key.toLowerCase();
    const upperKey = normalizedKey.toUpperCase();
    const keyCode = upperKey.charCodeAt(0);
    const eventBase = {
      key: normalizedKey,
      code: `Key${upperKey}`,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      modifiers: 2,
    };

    await this.cdp.send(
      "Input.dispatchKeyEvent",
      {
        ...eventBase,
        type: "keyDown",
      },
      this.sessionId,
    );
    await this.cdp.send(
      "Input.dispatchKeyEvent",
      {
        ...eventBase,
        type: "keyUp",
      },
      this.sessionId,
    );
  }

  async triggerWindowClose() {
    await this.evaluate(
      `(() => {
        const closeListen = window.__UNSAVED_TEST__.invocations.find((call) => {
          return window.__UNSAVED_TEST__.isCloseRequestedListener(call.cmd, call.args);
        });
        if (!closeListen) {
          throw new Error('close-requested listener was not registered');
        }
        const callback = window.__UNSAVED_TEST__.callbacks[closeListen.args.handler];
        const eventName = closeListen.args.event || 'tauri://close-requested';
        return Promise.resolve(callback({
          event: eventName,
          payload: null,
          id: 100
        })).then(() => true);
      })()`,
      { awaitPromise: true },
    );
  }

  async modalInfo() {
    return await this.evaluate(`(() => {
      const dialog = document.querySelector('dialog[open]');
      const descriptionId = dialog?.getAttribute('aria-describedby');

      return {
        open: Boolean(dialog),
        heading: dialog?.querySelector('h2')?.textContent || '',
        text: dialog?.innerText || '',
        ariaModal: dialog?.getAttribute('aria-modal') || null,
        hasDescription: Boolean(descriptionId && document.getElementById(descriptionId)),
        activeText: document.activeElement?.textContent || '',
        activeValue: document.activeElement?.value || '',
        tabTitles: Array.from(document.querySelectorAll('.tab-bar__tab')).map((tab) => {
          return tab.textContent;
        }),
        invocations: window.__UNSAVED_TEST__.invocations,
        closeCallCount: window.__UNSAVED_TEST__.closeCallCount,
        destroyCallCount: window.__UNSAVED_TEST__.destroyCallCount
      };
    })()`);
  }

  async waitForDialog(label) {
    await this.waitFor("Boolean(document.querySelector('dialog[open]'))", label);
  }

  async waitForNoDialog(label) {
    await this.waitFor("!document.querySelector('dialog[open]')", label);
  }

  async waitForActiveEditor() {
    await this.waitFor(
      "document.querySelector('.markdown-editor')?.dataset.editorTabId === document.querySelector('.tab-bar__tab[aria-selected=\"true\"]')?.dataset.tabId && Boolean(document.querySelector('.ProseMirror'))",
      "active editor",
    );
  }

  async waitFor(conditionExpression, label) {
    await waitUntil(async () => Boolean(await this.evaluate(conditionExpression)), label);
  }

  async evaluate(expression, options = {}) {
    const result = await this.cdp.send(
      "Runtime.evaluate",
      {
        expression,
        awaitPromise: options.awaitPromise ?? false,
        returnByValue: true,
      },
      this.sessionId,
    );

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text,
      );
    }

    return result.result.value;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed: ${url}`);
  }

  return await response.json();
}

function fileURLToPath(url) {
  return decodeURIComponent(url.pathname.replace(/^\/([A-Za-z]:)/u, "$1"));
}

await run();
