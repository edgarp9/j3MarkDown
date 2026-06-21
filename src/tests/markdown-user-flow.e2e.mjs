import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const APP_URL = process.env.J3MARKDOWN_E2E_URL ?? "http://127.0.0.1:1420";
const REPO_ROOT = new URL("..", import.meta.url);
const SCREENSHOT_DIR = fileURLToPath(new URL("../.test-output/markdown-user-flow", import.meta.url));
const APPROVED_FILE_DROP_EVENT = "j3markdown://approved-file-drop";
const E2E_SCENARIO = process.env.J3MARKDOWN_E2E_SCENARIO ?? "full";

const FIXTURES = {
  single: String.raw`C:\j3markdown-flow\very-long-folder-name-with-client-project-context\another-very-long-folder-name-for-tab-tooltip-wrapping\single.md`,
  first: String.raw`C:\j3markdown-flow\multi-one.md`,
  second: String.raw`C:\j3markdown-flow\multi-two.markdown`,
  largeFirst: String.raw`C:\j3markdown-flow\large-cache-one.md`,
  largeSecond: String.raw`C:\j3markdown-flow\large-cache-two.md`,
  unsupported: String.raw`C:\j3markdown-flow\unsupported.txt`,
  saveAs: String.raw`C:\j3markdown-flow\saved-as.md`,
};

const LONG_FIRST_CONTENT = [
  "# First Heading",
  "",
  "First tab content",
  "",
  ...Array.from({ length: 120 }, (_, index) => {
    return `Paragraph ${index + 1}: scroll restoration regression content.`;
  }),
].join("\n\n");

const INITIAL_FILES = {
  [FIXTURES.single]: "# Single Heading\n\nSingle initial content",
  [FIXTURES.first]: LONG_FIRST_CONTENT,
  [FIXTURES.second]: "# Second Heading\n\nSecond tab content",
  ...(E2E_SCENARIO === "large-editor-cache"
    ? {
        [FIXTURES.largeFirst]: createLargeEditorCacheContent("Large Cache One"),
        [FIXTURES.largeSecond]: createLargeEditorCacheContent("Large Cache Two"),
      }
    : {}),
  [FIXTURES.unsupported]: "not markdown",
};

if (E2E_SCENARIO === "large-editor-cache") {
  assert.ok(INITIAL_FILES[FIXTURES.largeFirst].length > 128 * 1024);
  assert.ok(INITIAL_FILES[FIXTURES.largeSecond].length > 128 * 1024);
}

const TAURI_FLOW_TEST_MOCK = String.raw`
(() => {
  const storageKey = "__j3markdown_flow_files__";
  const editorThemeStorageKey = "__j3markdown_flow_editor_theme__";
  const uiLanguageStorageKey = "__j3markdown_flow_ui_language__";
  const initialFiles = __INITIAL_FILES__;
  const defaultEditorTheme = "classic";
  const defaultUiLanguage = "en";
  const supportedEditorThemes = [
    "classic",
    "classic-dark",
    "nord-dark",
    "lagoon",
    "lagoon-dark",
    "berry",
    "berry-dark",
  ];
  const supportedUiLanguages = ["en", "ko"];
  const detachedWindowHandoffChannelName = "j3markdown-detached-window-handoff";
  const detachedWindowHandoffRequestMessage = "detached-window-document-request";
  const detachedWindowHandoffResponseMessage = "detached-window-document-response";
  const detachedWindowHandoffConsumedMessage = "detached-window-document-consumed";

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readFiles() {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      return JSON.parse(stored);
    }

    const files = clone(initialFiles);
    window.localStorage.setItem(storageKey, JSON.stringify(files));
    return files;
  }

  function writeFiles(files) {
    window.localStorage.setItem(storageKey, JSON.stringify(files));
  }

  function readEditorThemeSetting() {
    return window.localStorage.getItem(editorThemeStorageKey) ?? defaultEditorTheme;
  }

  function saveEditorThemeSetting(themeId) {
    if (!supportedEditorThemes.includes(themeId)) {
      throw "unsupported editor theme setting: " + themeId;
    }

    window.localStorage.setItem(editorThemeStorageKey, themeId);
  }

  function readUiLanguageSetting() {
    return window.localStorage.getItem(uiLanguageStorageKey) ?? defaultUiLanguage;
  }

  function saveUiLanguageSetting(languageId) {
    if (!supportedUiLanguages.includes(languageId)) {
      throw "unsupported UI language setting: " + languageId;
    }

    window.localStorage.setItem(uiLanguageStorageKey, languageId);
  }

  function titleFromPath(filePath) {
    return filePath.split(/[\\/]/).pop() || "Untitled.md";
  }

  function isSupportedMarkdownPath(filePath) {
    return /\.(md|markdown)$/i.test(filePath);
  }

  function fileFingerprint(content) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < content.length; index += 1) {
      hash ^= content.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return "test:" + content.length + ":" + hash.toString(16).padStart(8, "0");
  }

  function readMarkdownFile(filePath) {
    if (!isSupportedMarkdownPath(filePath)) {
      throw ".md 또는 .markdown 파일만 열 수 있습니다.";
    }

    const files = readFiles();
    if (!Object.prototype.hasOwnProperty.call(files, filePath)) {
      throw "파일이 없습니다: " + filePath;
    }

    return {
      path: filePath,
      title: titleFromPath(filePath),
      content: files[filePath],
      fileFingerprint: fileFingerprint(files[filePath]),
    };
  }

  function consumeDetachedWindowDocument(token) {
    if (!token || typeof BroadcastChannel === "undefined") {
      return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
      const channel = new BroadcastChannel(detachedWindowHandoffChannelName);
      const timeout = window.setTimeout(() => {
        cleanup();
        reject("새 창 문서 전달 테스트 더블이 문서를 받지 못했습니다.");
      }, 2000);

      function cleanup() {
        window.clearTimeout(timeout);
        channel.removeEventListener("message", handleMessage);
        channel.close();
      }

      function handleMessage(event) {
        const message = event.data;
        if (
          !message ||
          message.type !== detachedWindowHandoffResponseMessage ||
          message.token !== token
        ) {
          return;
        }

        window.__FLOW_TEST__.detachedDocuments.push({
          token,
          document: message.document,
        });
        channel.postMessage({
          type: detachedWindowHandoffConsumedMessage,
          token,
        });
        cleanup();
        resolve(message.document);
      }

      channel.addEventListener("message", handleMessage);
      channel.postMessage({
        type: detachedWindowHandoffRequestMessage,
        token,
      });
    });
  }

  window.__FLOW_TEST__ = {
    invocations: [],
    detachedDocuments: [],
    openedAboutLinks: 0,
    callbacks: {},
    callbackSeq: 1,
    saveAsPath: __SAVE_AS_PATH__,
    errors: [],
    readFiles,
  };

  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    invoke: async (cmd, args = {}) => {
      window.__FLOW_TEST__.invocations.push({ cmd, args });

      if (cmd === "get_launch_paths") {
        return [];
      }

      if (cmd === "get_about_info") {
        return {
          version: "0.1.0-test",
          githubUrl: "https://github.com/edgarp9",
        };
      }

      if (cmd === "get_about_text") {
        return [
          "j3Markdown",
          "",
          "Version: 0.1.0-test",
          "Source code for this release:",
          "https://github.com/edgarp9",
          "",
          "THIRD_PARTY_NOTICES.txt",
        ].join("\n");
      }

      if (cmd === "open_about_link") {
        window.__FLOW_TEST__.openedAboutLinks += 1;
        return null;
      }

      if (cmd === "read_editor_theme_setting") {
        return readEditorThemeSetting();
      }

      if (cmd === "save_editor_theme_setting") {
        saveEditorThemeSetting(args.themeId);
        return null;
      }

      if (cmd === "read_ui_language_setting") {
        return readUiLanguageSetting();
      }

      if (cmd === "save_ui_language_setting") {
        saveUiLanguageSetting(args.languageId);
        return null;
      }

      if (cmd === "open_markdown_file") {
        return readMarkdownFile(__SINGLE_PATH__);
      }

      if (cmd === "open_markdown_file_at_path") {
        return readMarkdownFile(args.path);
      }

      if (cmd === "open_markdown_files_at_paths") {
        return args.paths.map((path) => {
          try {
            return {
              path,
              file: readMarkdownFile(path),
              error: null,
            };
          } catch (error) {
            return {
              path,
              file: null,
              error: String(error),
            };
          }
        });
      }

      if (cmd === "open_markdown_document_in_new_window") {
        await consumeDetachedWindowDocument(args.document.handoffToken);
        return null;
      }

      if (cmd === "complete_detached_window_broadcast_handoff") {
        return null;
      }

      if (cmd === "take_detached_window_document") {
        return null;
      }

      if (cmd === "save_markdown_file") {
        if (!isSupportedMarkdownPath(args.path)) {
          throw ".md 또는 .markdown 파일만 열 수 있습니다.";
        }

        const files = readFiles();
        const hasExistingFile = Object.prototype.hasOwnProperty.call(files, args.path);
        if (!args.allowExternalOverwrite && args.expectedFileFingerprint) {
          if (!hasExistingFile) {
            return {
              status: "conflict",
              file: null,
              conflict: {
                path: args.path,
                reason: "deleted",
              },
            };
          }

          if (fileFingerprint(files[args.path]) !== args.expectedFileFingerprint) {
            return {
              status: "conflict",
              file: null,
              conflict: {
                path: args.path,
                reason: "modified",
              },
            };
          }
        }

        files[args.path] = args.content;
        writeFiles(files);
        return {
          status: "saved",
          file: {
            path: args.path,
            title: titleFromPath(args.path),
            fileFingerprint: fileFingerprint(args.content),
          },
          conflict: null,
        };
      }

      if (cmd === "select_markdown_save_path") {
        return window.__FLOW_TEST__.saveAsPath;
      }

      if (cmd === "save_markdown_file_as") {
        const filePath = window.__FLOW_TEST__.saveAsPath;
        if (!isSupportedMarkdownPath(filePath)) {
          throw ".md 또는 .markdown 파일만 열 수 있습니다.";
        }

        const files = readFiles();
        files[filePath] = args.content;
        writeFiles(files);
        return {
          status: "saved",
          file: {
            path: filePath,
            title: titleFromPath(filePath),
            fileFingerprint: fileFingerprint(args.content),
          },
          conflict: null,
        };
      }

      if (cmd === "plugin:event|listen") {
        return Object.keys(window.__FLOW_TEST__.callbacks).length + 1;
      }

      if (cmd === "plugin:event|unlisten") {
        return null;
      }

      if (cmd === "plugin:window|close") {
        return null;
      }

      return null;
    },
    transformCallback: (callback) => {
      const id = window.__FLOW_TEST__.callbackSeq;
      window.__FLOW_TEST__.callbackSeq += 1;
      window.__FLOW_TEST__.callbacks[id] = callback;
      return id;
    },
  };
})();
`
  .replace("__INITIAL_FILES__", JSON.stringify(INITIAL_FILES))
  .replace("__SAVE_AS_PATH__", JSON.stringify(FIXTURES.saveAs))
  .replace("__SINGLE_PATH__", JSON.stringify(FIXTURES.single));

async function run() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const devServer = await ensureDevServer();
  const browser = await chromium.launch({
    executablePath: findChromeExecutable(),
    headless: true,
  });

  const consoleMessages = [];
  const pageErrors = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 820 },
    });
    await context.addInitScript({ content: TAURI_FLOW_TEST_MOCK });

    const page = await context.newPage();
    page.on("console", (message) => {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
      });
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    if (E2E_SCENARIO === "large-editor-cache") {
      await loadApp(page, "large-editor-cache");
      await expectLargeMarkdownEditorCacheReuse(page);
      assert.deepEqual(pageErrors, []);
      console.log("Large editor cache e2e passed.");
      return;
    }

    await loadApp(page, "initial");
    await expectAboutDialog(page);
    await expectEditorContextMenu(page);
    await expectEditorContextMenuCommand(page);
    await loadApp(page, "post-context-command");
    await expectThemeOptions(page);
    await expectLanguageOptions(page, "en");
    await selectUiLanguage(page, "ko");
    await expectUiLanguage(page, "ko");
    await loadApp(page, "language-persist");
    await expectUiLanguage(page, "ko");
    await selectUiLanguage(page, "en");
    await expectUiLanguage(page, "en");
    await selectEditorTheme(page, "nord-dark");
    await expectEditorTheme(page, "nord-dark", true);
    await loadApp(page, "theme-persist");
    await expectEditorTheme(page, "nord-dark", true);
    await selectEditorTheme(page, "berry-dark");
    await expectEditorTheme(page, "berry-dark", false);
    await expectEditorThemeVariable(page, "--crepe-color-primary", "#e0718b");
    await selectEditorTheme(page, "classic");
    await expectEditorTheme(page, "classic", false);

    const openCallsBeforeUnapprovedDrop = await countOpenPathInvocations(page);
    await dropNativePathsWithoutApproval(page, [FIXTURES.single]);
    await delay(50);
    assert.equal(await countOpenPathInvocations(page), openCallsBeforeUnapprovedDrop);

    await dropPaths(page, [FIXTURES.single]);
    await expectActiveTab(page, "single.md");
    await expectActiveTabTooltip(page, FIXTURES.single);
    await expectWrappedActiveTabTooltip(page, FIXTURES.single);
    await expectEditorText(page, "Single Heading");
    await expectTabCount(page, 1);
    await expectTabContextMenuOpenInNewWindowDisabled(page);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "01-drop-single.png"), fullPage: true });

    const openPathCallsBeforeDuplicateDrop = await countOpenPathInvocations(page);
    await dropPaths(page, [FIXTURES.single]);
    await expectActiveTab(page, "single.md");
    await expectEditorText(page, "Single initial content");
    await expectTabCount(page, 1);
    assert.equal(await countOpenPathInvocations(page), openPathCallsBeforeDuplicateDrop);

    await dropPaths(page, [FIXTURES.first, FIXTURES.second]);
    await expectTabCount(page, 3);
    await expectActiveTab(page, "multi-two.markdown");
    await expectEditorText(page, "Second Heading");

    const openFileCallsBeforeDuplicateOpen = await countOpenFileInvocations(page);
    await clickToolbar(page, "open");
    await expectActiveTab(page, "single.md");
    await expectEditorText(page, "Single initial content");
    await expectTabCount(page, 3);
    assert.equal(await countOpenFileInvocations(page), openFileCallsBeforeDuplicateOpen + 1);
    await selectTab(page, "multi-two.markdown");

    await expectTabContextMenuOpenInNewWindow(page, {
      tabTitle: "multi-two.markdown",
      title: "multi-two.markdown",
      filePath: FIXTURES.second,
      dirty: false,
      lastSavedMarkdownMatchesMarkdown: true,
      markdownIncludes: "Second tab content",
      expectedTabCount: 2,
      expectedActiveTab: "multi-one.md",
    });

    await selectTab(page, "multi-one.md");
    await expectEditorText(page, "First Heading");
    const firstTabScrollTop = await scrollActiveEditor(page, 900);
    assert.ok(firstTabScrollTop > 200);
    await selectTab(page, "single.md");
    await expectEditorText(page, "Single initial content");
    await selectTab(page, "multi-one.md");
    await expectActiveEditorScrollTop(page, firstTabScrollTop);
    await selectTab(page, "single.md");
    await expectEditorText(page, "Single initial content");

    await appendEditorText(page, "\n\nSaved through the full-flow regression.");
    await expectActiveTabDirty(page, true);
    await clickToolbar(page, "save");
    await expectActiveTabDirty(page, false);
    await expectStoredFileContains(page, FIXTURES.single, "Saved through the full-flow regression.");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "02-after-save.png"), fullPage: true });

    await setStoredFile(page, FIXTURES.single, "# External\n\nchanged outside the app");
    await appendEditorText(page, "\n\nLocal edit after an external change.");
    await clickToolbar(page, "save");
    let conflictInfo = await getDialogInfo(page);
    assert.equal(conflictInfo.open, true);
    assert.equal(conflictInfo.ariaModal, "true");
    assert.match(conflictInfo.text, /File Conflict/u);
    assert.deepEqual(conflictInfo.buttonValues, ["reload", "save-as", "overwrite", "cancel"]);
    await chooseDialog(page, "cancel");
    await waitForNoDialog(page);
    await expectActiveTabDirty(page, true);
    await expectStoredFileContains(page, FIXTURES.single, "changed outside the app");

    await clickToolbar(page, "save");
    conflictInfo = await getDialogInfo(page);
    assert.deepEqual(conflictInfo.buttonValues, ["reload", "save-as", "overwrite", "cancel"]);
    await chooseDialog(page, "overwrite");
    await waitForNoDialog(page);
    await expectActiveTabDirty(page, false);
    await expectStoredFileContains(page, FIXTURES.single, "Local edit after an external change.");

    await appendEditorText(page, "\n\nSaved as a separate Markdown file.");
    await clickToolbar(page, "save-as");
    await expectActiveTab(page, "saved-as.md");
    await expectActiveTabTooltip(page, FIXTURES.saveAs);
    await expectActiveTabDirty(page, false);
    await expectStoredFileContains(page, FIXTURES.saveAs, "Saved as a separate Markdown file.");

    await appendEditorText(page, "\n\nDirty close should be protected.");
    await closeActiveTab(page);
    const dialogInfo = await getDialogInfo(page);
    assert.equal(dialogInfo.open, true);
    assert.equal(dialogInfo.ariaModal, "true");
    assert.deepEqual(dialogInfo.buttonValues, ["save", "discard", "cancel"]);
    await chooseDialog(page, "cancel");
    await waitForNoDialog(page);
    await expectActiveTabDirty(page, true);

    await dropPaths(page, [FIXTURES.unsupported]);
    await page.waitForSelector("dialog[open]");
    const errorInfo = await getDialogInfo(page);
    assert.equal(errorInfo.open, true);
    assert.equal(errorInfo.ariaModal, "true");
    assert.match(errorInfo.text, /\.md 또는 \.markdown 파일만 열 수 있습니다/u);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "03-unsupported-drop-modal.png"),
      fullPage: true,
    });
    await chooseDialog(page, "ok");
    await waitForNoDialog(page);

    const preRelaunchSummary = await page.evaluate(() => {
      return {
        invocations: window.__FLOW_TEST__.invocations,
        files: window.__FLOW_TEST__.readFiles(),
      };
    });

    assert.equal(
      preRelaunchSummary.invocations.some((call) => call.cmd === "save_markdown_file"),
      true,
    );
    assert.equal(
      preRelaunchSummary.invocations.some((call) => call.cmd === "select_markdown_save_path"),
      true,
    );

    await loadApp(page, "relaunch");
    await dropPaths(page, [FIXTURES.saveAs]);
    await expectActiveTab(page, "saved-as.md");
    await expectEditorText(page, "Saved as a separate Markdown file.");
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "04-relaunch-open-saved-as.png"),
      fullPage: true,
    });

    await loadApp(page, "close-other-tabs");
    await dropPaths(page, [FIXTURES.single, FIXTURES.first, FIXTURES.second]);
    await expectTabCount(page, 3);
    await expectTabContextMenuCloseOtherTabs(page, "multi-one.md");
    await expectEditorText(page, "First Heading");

    const importantConsoleMessages = consoleMessages.filter((message) => {
      return message.type === "error" || message.type === "warning";
    });

    assert.deepEqual(pageErrors, []);
    assert.deepEqual(importantConsoleMessages, []);

    const flowSummary = await page.evaluate(() => {
      return {
        invocations: window.__FLOW_TEST__.invocations,
        files: window.__FLOW_TEST__.readFiles(),
      };
    });

    assert.equal(
      flowSummary.files[FIXTURES.saveAs].includes("Saved as a separate Markdown file."),
      true,
    );

    console.log("Markdown user-flow e2e passed.");
    console.log(`- Screenshots: ${SCREENSHOT_DIR}`);
    console.log(`- Console messages captured: ${consoleMessages.length}`);
    console.log(`- Saved file content length: ${flowSummary.files[FIXTURES.saveAs].length}`);
  } finally {
    await browser.close().catch(() => {});
    devServer.kill();
  }
}

async function loadApp(page, name) {
  await page.goto(`${APP_URL}/?flow=${encodeURIComponent(name)}-${Date.now()}`);
  await page.waitForSelector(".ProseMirror");
  await waitForActiveEditor(page);
}

async function dropPaths(page, paths) {
  await dropNativePathsWithoutApproval(page, paths);
  await emitTauriEvent(page, APPROVED_FILE_DROP_EVENT, paths);
}

async function dropNativePathsWithoutApproval(page, paths) {
  await emitTauriEvent(page, "tauri://drag-drop", {
    type: "drop",
    paths,
    position: { x: 400, y: 320 },
  });
}

async function emitTauriEvent(page, eventName, payload) {
  await page.evaluate(
    async ({ eventName: targetEventName, payload: targetPayload }) => {
      const eventListen = window.__FLOW_TEST__.invocations.find((call) => {
        return call.cmd === "plugin:event|listen" && call.args.event === targetEventName;
      });

      if (!eventListen) {
        throw new Error(`${targetEventName} listener was not registered`);
      }

      const callback = window.__FLOW_TEST__.callbacks[eventListen.args.handler];
      await callback({
        event: targetEventName,
        payload: targetPayload,
        id: Date.now(),
      });
    },
    { eventName, payload },
  );
}

async function countOpenPathInvocations(page) {
  return await page.evaluate(() => {
    return window.__FLOW_TEST__.invocations.filter((call) => {
      return call.cmd === "open_markdown_files_at_paths";
    }).length;
  });
}

async function countOpenFileInvocations(page) {
  return await page.evaluate(() => {
    return window.__FLOW_TEST__.invocations.filter((call) => {
      return call.cmd === "open_markdown_file";
    }).length;
  });
}

async function clickToolbar(page, action) {
  await page.locator(`[data-action="${action}"]`).click();
}

async function selectTab(page, title) {
  await page.locator(".tab-bar__tab", { hasText: title }).click();
  await waitForActiveEditor(page);
}

async function closeActiveTab(page) {
  await page
    .locator('.tab-bar__tab[aria-selected="true"]')
    .locator("xpath=..")
    .locator(".tab-bar__close")
    .click();
}

async function appendEditorText(page, text) {
  await waitForActiveEditor(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(text);
  await expectEditorText(page, text.trim());
  await delay(250);
  await expectActiveTabDirty(page, true);
}

async function selectEditorTheme(page, themeId) {
  await page.locator("[data-editor-theme-selector='true']").selectOption(themeId);
  await page.waitForFunction(
    (expectedThemeId) => {
      return (
        document.querySelector(".markdown-editor")?.dataset.editorThemeId === expectedThemeId &&
        Boolean(document.querySelector(".ProseMirror"))
      );
    },
    themeId,
  );
}

async function chooseDialog(page, value) {
  await page.locator(`dialog[open] button[value="${value}"]`).click();
}

async function expectAboutDialog(page) {
  await expectAboutButtonAtToolbarRight(page);
  await page.locator('.toolbar__button[data-action="about"]').click();
  const dialogInfo = await getDialogInfo(page);
  assert.equal(dialogInfo.open, true);
  assert.equal(dialogInfo.ariaModal, "true");
  assert.match(dialogInfo.text, /About j3Markdown/u);
  assert.match(dialogInfo.text, /Version 0\.1\.0-test/u);
  assert.match(dialogInfo.text, /Source code for this release:/u);
  assert.match(dialogInfo.text, /THIRD_PARTY_NOTICES\.txt/u);
  assert.match(dialogInfo.text, /https:\/\/github\.com\/edgarp9/u);
  assert.equal(await page.locator("dialog[open] summary").count(), 0);
  assert.equal(await page.locator("dialog[open] .modal-dialog__license-text").count(), 0);
  assert.equal(dialogInfo.text.includes("Open Source Licenses"), false);
  assert.equal(
    await page.evaluate(() =>
      window.__FLOW_TEST__.invocations.some(
        (invocation) => invocation.cmd === "get_third_party_notices_text",
      ),
    ),
    false,
  );

  await page.locator('dialog[open] a[href="https://github.com/edgarp9"]').click();
  await page.waitForFunction(() => window.__FLOW_TEST__.openedAboutLinks === 1);
  await chooseDialog(page, "ok");
  await waitForNoDialog(page);
}

async function expectAboutButtonAtToolbarRight(page) {
  const aboutIsRightmostControl = await page.evaluate(() => {
    const toolbar = document.querySelector(".toolbar");
    const aboutButton = toolbar?.querySelector('.toolbar__button[data-action="about"]');

    if (!toolbar || !aboutButton) {
      return false;
    }

    const aboutRight = aboutButton.getBoundingClientRect().right;
    const controlRights = Array.from(toolbar.querySelectorAll("button, select")).map((control) => {
      return control.getBoundingClientRect().right;
    });

    return aboutRight === Math.max(...controlRights);
  });

  assert.equal(aboutIsRightmostControl, true);
}

async function getDialogInfo(page) {
  return await page.evaluate(() => {
    const dialog = document.querySelector("dialog[open]");
    return {
      open: Boolean(dialog),
      ariaModal: dialog?.getAttribute("aria-modal") ?? null,
      text: dialog?.innerText ?? "",
      buttonValues: Array.from(dialog?.querySelectorAll("button") ?? []).map((button) => {
        return button.value;
      }),
    };
  });
}

async function expectTabCount(page, count) {
  await page.waitForFunction((expectedCount) => {
    return document.querySelectorAll(".tab-bar__tab").length === expectedCount;
  }, count);
}

async function expectActiveTab(page, title) {
  await page.waitForFunction((expectedTitle) => {
    return document
      .querySelector('.tab-bar__tab[aria-selected="true"]')
      ?.textContent?.includes(expectedTitle);
  }, title);
}

async function expectActiveTabDirty(page, dirty) {
  await page.waitForFunction((expectedDirty) => {
    const title = document.querySelector('.tab-bar__tab[aria-selected="true"]')?.textContent ?? "";
    return title.startsWith("* ") === expectedDirty;
  }, dirty);
}

async function expectActiveTabTooltip(page, tooltip) {
  await page.waitForFunction((expectedTooltip) => {
    const tab = document.querySelector('.tab-bar__tab[aria-selected="true"]');
    return tab?.getAttribute("data-tooltip-text") === expectedTooltip && !tab.hasAttribute("title");
  }, tooltip);
}

async function expectWrappedActiveTabTooltip(page, tooltip) {
  await page.locator('.tab-bar__tab[aria-selected="true"]').hover();
  await page.waitForSelector(".tab-bar__tooltip");

  const tooltipInfo = await page.locator(".tab-bar__tooltip").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      text: element.textContent,
      width: rect.width,
      height: rect.height,
      lineHeight: Number.parseFloat(style.lineHeight),
      overflowWrap: style.overflowWrap,
      whiteSpace: style.whiteSpace,
    };
  });

  assert.equal(tooltipInfo.text, tooltip);
  assert.ok(tooltipInfo.width <= 540, `tooltip width should be constrained: ${tooltipInfo.width}`);
  assert.ok(
    tooltipInfo.height > tooltipInfo.lineHeight * 1.5,
    `tooltip should wrap to multiple lines: ${JSON.stringify(tooltipInfo)}`,
  );
  assert.equal(tooltipInfo.overflowWrap, "anywhere");
  assert.equal(tooltipInfo.whiteSpace, "normal");

  await page.mouse.move(5, 5);
  await page.waitForSelector(".tab-bar__tooltip", { state: "detached" });
}

async function expectEditorText(page, text) {
  await page.waitForFunction((expectedText) => {
    return document.querySelector(".ProseMirror")?.innerText.includes(expectedText);
  }, text);
}

async function scrollActiveEditor(page, top) {
  return await page.evaluate(async (scrollTop) => {
    const editor = document.querySelector(".markdown-editor");

    if (!(editor instanceof HTMLElement)) {
      throw new Error("Active editor scroll container was not found.");
    }

    editor.scrollTop = scrollTop;
    await new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    return editor.scrollTop;
  }, top);
}

async function expectActiveEditorScrollTop(page, scrollTop) {
  await page.waitForFunction((expectedScrollTop) => {
    const editor = document.querySelector(".markdown-editor");

    return (
      editor instanceof HTMLElement &&
      Math.abs(editor.scrollTop - expectedScrollTop) <= 2
    );
  }, scrollTop);
}

async function expectStoredFileContains(page, filePath, text) {
  try {
    await page.waitForFunction(
      ({ expectedFilePath, expectedText }) => {
        return window.__FLOW_TEST__.readFiles()[expectedFilePath]?.includes(expectedText);
      },
      { expectedFilePath: filePath, expectedText: text },
    );
  } catch (error) {
    const summary = await page.evaluate((expectedFilePath) => {
      return {
        activeTab: document.querySelector('.tab-bar__tab[aria-selected="true"]')?.textContent,
        invocations: window.__FLOW_TEST__.invocations,
        fileContent: window.__FLOW_TEST__.readFiles()[expectedFilePath] ?? null,
      };
    }, filePath);

    throw new Error(`${error.message}\n${JSON.stringify(summary, null, 2)}`);
  }
}

async function setStoredFile(page, filePath, content) {
  await page.evaluate(
    ({ targetPath, targetContent }) => {
      const files = window.__FLOW_TEST__.readFiles();
      files[targetPath] = targetContent;
      window.localStorage.setItem("__j3markdown_flow_files__", JSON.stringify(files));
    },
    { targetPath: filePath, targetContent: content },
  );
}

async function expectLargeMarkdownEditorCacheReuse(page) {
  await dropPaths(page, [FIXTURES.largeFirst, FIXTURES.largeSecond]);
  await expectTabCount(page, 2);
  await expectActiveTab(page, "large-cache-two.md");
  await expectEditorText(page, "Large Cache Two");

  await selectTab(page, "large-cache-one.md");
  await expectEditorText(page, "Large Cache One");
  await page.evaluate(() => {
    window.__FLOW_TEST__.largeCacheEditorElement = document.querySelector("[data-region='editor']");
  });

  await selectTab(page, "large-cache-two.md");
  await expectEditorText(page, "Large Cache Two");
  await selectTab(page, "large-cache-one.md");
  await expectEditorText(page, "Large Cache One");

  const reusedEditorElement = await page.evaluate(() => {
    return (
      document.querySelector("[data-region='editor']") ===
      window.__FLOW_TEST__.largeCacheEditorElement
    );
  });

  assert.equal(reusedEditorElement, true);
}

async function expectThemeOptions(page) {
  const options = await page.locator("[data-editor-theme-selector='true'] option").evaluateAll(
    (optionElements) => {
      return optionElements.map((option) => {
        return {
          value: option.value,
          label: option.textContent,
        };
      });
    },
  );

  assert.deepEqual(options, [
    { value: "classic", label: "Classic" },
    { value: "classic-dark", label: "Classic Dark" },
    { value: "nord-dark", label: "Nord Dark" },
    { value: "lagoon", label: "Lagoon" },
    { value: "lagoon-dark", label: "Lagoon Dark" },
    { value: "berry", label: "Berry" },
    { value: "berry-dark", label: "Berry Dark" },
  ]);
}

async function expectLanguageOptions(page, selectedLanguage) {
  const options = await page.locator("[data-ui-language-selector='true'] option").evaluateAll(
    (optionElements) => {
      return optionElements.map((option) => {
        return {
          value: option.value,
          label: option.textContent,
          selected: option.selected,
        };
      });
    },
  );

  assert.deepEqual(options, [
    { value: "en", label: "English", selected: selectedLanguage === "en" },
    { value: "ko", label: "한국어", selected: selectedLanguage === "ko" },
  ]);
}

async function selectUiLanguage(page, languageId) {
  await page.locator("[data-ui-language-selector='true']").selectOption(languageId);
  await expectUiLanguage(page, languageId);
}

async function expectUiLanguage(page, languageId) {
  const expectedNewLabel = languageId === "ko" ? "새 글" : "New";
  const expectedSaveLabel = languageId === "ko" ? "저장" : "Save";
  const expectedStatusSaved = languageId === "ko" ? "저장됨" : "Saved";

  await page.waitForFunction(
    ({ expectedLanguageId, expectedNewLabel, expectedSaveLabel, expectedStatusSaved }) => {
      return (
        document.querySelector("[data-ui-language-selector='true']")?.value ===
          expectedLanguageId &&
        document.querySelector('.toolbar__button[data-action="new"]')?.textContent ===
          expectedNewLabel &&
        document.querySelector('.toolbar__button[data-action="save"]')?.textContent ===
          expectedSaveLabel &&
        Array.from(document.querySelectorAll(".status-bar__item")).some((item) => {
          return item.textContent === expectedStatusSaved;
        })
      );
    },
    {
      expectedLanguageId: languageId,
      expectedNewLabel,
      expectedSaveLabel,
      expectedStatusSaved,
    },
  );
}

async function expectEditorContextMenu(page) {
  await waitForActiveEditor(page);

  const editorBox = await page.locator(".ProseMirror").boundingBox();
  assert.ok(editorBox, "editor bounds should be available for context-menu check");

  await page.mouse.click(editorBox.x + 120, editorBox.y + 36, { button: "right" });
  await page.waitForSelector(".editor-context-menu");

  const entries = await page.locator(".editor-context-menu__item").evaluateAll((items) => {
    return items.map((item) => {
      return {
        action: item.dataset.contextAction,
        label: item.querySelector(".editor-context-menu__label")?.textContent,
        disabled: item.disabled,
      };
    });
  });

  assert.deepEqual(
    entries.map((entry) => entry.action),
    [
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "select-all",
      "bold",
      "italic",
      "inline-code",
    ],
  );
  assert.equal(entries.find((entry) => entry.action === "cut")?.disabled, true);
  assert.equal(entries.find((entry) => entry.action === "copy")?.disabled, true);

  const menuText = await page.locator(".editor-context-menu").innerText();
  assert.doesNotMatch(
    menuText,
    /Back|Forward|Reload|Print|Inspect|View Source|Save Page|뒤로|앞으로|새로고침|인쇄|검사|소스|페이지 저장/u,
  );

  await page.keyboard.press("Escape");
  await page.waitForSelector(".editor-context-menu", { state: "detached" });

  await page.locator(".toolbar").click({ button: "right" });
  await page.waitForTimeout(50);
  assert.equal(await page.locator(".editor-context-menu").count(), 0);
}

async function expectEditorContextMenuCommand(page) {
  await waitForActiveEditor(page);

  const editorBox = await page.locator(".ProseMirror").boundingBox();
  assert.ok(editorBox, "editor bounds should be available for context-menu command check");

  await page.mouse.click(editorBox.x + 120, editorBox.y + 36, { button: "right" });
  await page.waitForSelector('.editor-context-menu__item[data-context-action="bold"]');
  await page.locator('.editor-context-menu__item[data-context-action="bold"]').click();
  await page.waitForFunction(() => {
    return document.querySelector(".ProseMirror")?.innerText.includes("bold");
  });
  await expectActiveTabDirty(page, true);
  assert.equal(await page.locator(".editor-context-menu").count(), 0);
}

async function expectTabContextMenuOpenInNewWindow(page, expected) {
  const openWindowCallsBefore = await countOpenWindowInvocations(page);

  await page
    .locator(".tab-bar__tab", { hasText: expected.tabTitle ?? expected.title })
    .click({ button: "right" });
  const menuItemSelector =
    '.tab-context-menu .editor-context-menu__item[data-context-action="open-in-new-window"]';
  await page.waitForSelector(menuItemSelector);

  const menuItem = page.locator(menuItemSelector);
  const menuLabel = await menuItem.innerText();
  assert.match(menuLabel, /Open in New Window/u);

  await menuItem.click();
  await page.waitForSelector(".tab-context-menu", { state: "detached" });

  const openWindowCall = await page.waitForFunction((previousCount) => {
    const calls = window.__FLOW_TEST__.invocations.filter((call) => {
      return call.cmd === "open_markdown_document_in_new_window";
    });
    if (calls.length <= previousCount) {
      return null;
    }

    return calls[calls.length - 1];
  }, openWindowCallsBefore);
  const call = await openWindowCall.jsonValue();
  const document = call.args.document;

  assert.equal(document.title, expected.title);
  assert.equal(document.filePath, expected.filePath);
  assert.equal(document.dirty, expected.dirty);
  assert.equal(document.lastSavedMarkdown, undefined);
  assert.equal(document.markdown, "");
  assert.equal(typeof document.handoffToken, "string");
  assert.ok(document.handoffToken.length > 0);
  assert.equal(document.broadcastHandoffOnly, true);
  assert.equal(document.saveTargetDetached, false);

  const detachedDocumentHandle = await page.waitForFunction((token) => {
    const entry = window.__FLOW_TEST__.detachedDocuments.find((candidate) => {
      return candidate.token === token;
    });

    return entry?.document ?? null;
  }, document.handoffToken);
  const detachedDocument = await detachedDocumentHandle.jsonValue();

  assert.equal(detachedDocument.title, expected.title);
  assert.equal(detachedDocument.filePath, expected.filePath);
  assert.equal(detachedDocument.dirty, expected.dirty);
  if (expected.lastSavedMarkdownMatchesMarkdown) {
    assert.equal(detachedDocument.lastSavedMarkdown, undefined);
    assert.equal(detachedDocument.lastSavedMarkdownMatchesMarkdown, true);
  } else {
    assert.equal(
      detachedDocument.lastSavedMarkdown,
      expected.lastSavedMarkdown ?? INITIAL_FILES[expected.filePath],
    );
  }
  assert.equal(detachedDocument.saveTargetDetached, false);
  assert.match(
    detachedDocument.markdown,
    new RegExp(escapeRegExp(expected.markdownIncludes), "u"),
  );

  if (expected.expectedTabCount !== undefined) {
    await expectTabCount(page, expected.expectedTabCount);
  }

  if (expected.expectedActiveTab) {
    await expectActiveTab(page, expected.expectedActiveTab);
  }
}

async function expectTabContextMenuOpenInNewWindowDisabled(page) {
  const openWindowCallsBefore = await countOpenWindowInvocations(page);

  await page.locator('.tab-bar__tab[aria-selected="true"]').click({ button: "right" });
  const openInNewWindowSelector =
    '.tab-context-menu .editor-context-menu__item[data-context-action="open-in-new-window"]';
  const closeOtherTabsSelector =
    '.tab-context-menu .editor-context-menu__item[data-context-action="close-other-tabs"]';
  await page.waitForSelector(openInNewWindowSelector);
  await page.waitForSelector(closeOtherTabsSelector);

  const openInNewWindowItem = page.locator(openInNewWindowSelector);
  assert.equal(await openInNewWindowItem.isDisabled(), true);

  const closeOtherTabsItem = page.locator(closeOtherTabsSelector);
  assert.match(await closeOtherTabsItem.innerText(), /Close Other Tabs/u);
  assert.equal(await closeOtherTabsItem.isDisabled(), true);

  await page.keyboard.press("Escape");
  await page.waitForSelector(".tab-context-menu", { state: "detached" });
  assert.equal(await countOpenWindowInvocations(page), openWindowCallsBefore);
}

async function expectTabContextMenuCloseOtherTabs(page, tabTitle) {
  await page.locator(".tab-bar__tab", { hasText: tabTitle }).click({ button: "right" });
  const menuItemSelector =
    '.tab-context-menu .editor-context-menu__item[data-context-action="close-other-tabs"]';
  await page.waitForSelector(menuItemSelector);

  const menuItem = page.locator(menuItemSelector);
  assert.match(await menuItem.innerText(), /Close Other Tabs/u);
  assert.equal(await menuItem.isDisabled(), false);

  await menuItem.click();
  await page.waitForSelector(".tab-context-menu", { state: "detached" });
  await discardDirtyTabCloseDialogsUntilTabCount(page, 1);
  await expectTabCount(page, 1);
  await expectActiveTab(page, tabTitle);
  await waitForActiveEditor(page);
}

async function discardDirtyTabCloseDialogsUntilTabCount(page, count) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if ((await page.locator(".tab-bar__tab").count()) === count) {
      return;
    }

    const discardButton = page.locator('dialog[open] button[value="discard"]');
    if ((await discardButton.count()) > 0) {
      await discardButton.click();
      await waitForNoDialog(page);
      continue;
    }

    await delay(100);
  }
}

async function countOpenWindowInvocations(page) {
  return await page.evaluate(() => {
    return window.__FLOW_TEST__.invocations.filter((call) => {
      return call.cmd === "open_markdown_document_in_new_window";
    }).length;
  });
}

async function expectEditorTheme(page, themeId, usesMilkdownNord) {
  await page.waitForFunction(
    ({ expectedThemeId, expectedUsesMilkdownNord }) => {
      const editorMount = document.querySelector(".markdown-editor");
      const proseMirror = document.querySelector(".ProseMirror");

      return (
        document.querySelector(".app-shell")?.dataset.editorThemeId === expectedThemeId &&
        editorMount?.dataset.editorThemeId === expectedThemeId &&
        document.querySelector("[data-editor-theme-selector='true']")?.value === expectedThemeId &&
        Boolean(proseMirror) &&
        proseMirror.classList.contains("milkdown-theme-nord") === expectedUsesMilkdownNord
      );
    },
    {
      expectedThemeId: themeId,
      expectedUsesMilkdownNord: usesMilkdownNord,
    },
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function createLargeEditorCacheContent(label) {
  return [
    `# ${label}`,
    "",
    ...Array.from({ length: 1700 }, (_, index) => {
      return `${label} line ${String(index).padStart(4, "0")} keeps editor cache coverage above the large markdown threshold during tab switching.`;
    }),
  ].join("\n");
}

async function expectEditorThemeVariable(page, variableName, value) {
  await page.waitForFunction(
    ({ expectedVariableName, expectedValue }) => {
      const editorMount = document.querySelector(".markdown-editor");

      if (!editorMount) {
        return false;
      }

      const actualValue = getComputedStyle(editorMount)
        .getPropertyValue(expectedVariableName)
        .trim();

      return actualValue.toLowerCase() === expectedValue.toLowerCase();
    },
    {
      expectedVariableName: variableName,
      expectedValue: value,
    },
  );
}

async function waitForNoDialog(page) {
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
}

async function waitForActiveEditor(page) {
  await page.waitForFunction(() => {
    return (
      document.querySelector(".markdown-editor")?.dataset.editorTabId ===
        document.querySelector('.tab-bar__tab[aria-selected="true"]')?.dataset.tabId &&
      Boolean(document.querySelector(".ProseMirror"))
    );
  });
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

async function waitUntil(predicate, label, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) {
      return;
    }

    await delay(100);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

function fileURLToPath(url) {
  return decodeURIComponent(url.pathname.replace(/^\/([A-Za-z]:)/u, "$1"));
}

await run();
