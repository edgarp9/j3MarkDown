import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEditorMarkdownBaseline,
  applyOpenedMarkdownDocument,
  applySavedMarkdownDocument,
  applySavedMarkdownDocumentUniquely,
  completePendingSavedMarkdownComparison,
  createDetachedWindowDocumentFromTab,
  createDetachedWindowDocumentFromTransfer,
  createDetachedWindowDocumentTransfer,
  createDetachedWindowDocumentWindowRequest,
  createFilePathTabIndex,
  createTabFromDetachedWindowDocument,
  createUntitledTab,
  getTabContentVersion,
  findTabByFilePath,
  getTabDisplayTitle,
  getTabTooltipText,
  normalizeFilePathForComparison,
  removeDetachedWindowSourceTab,
  restoreDetachedWindowSourceTab,
  updateTabMarkdown,
  updateTabMarkdownById,
} from "../.test-output/src/app/document-state.js";
import {
  DebouncedLatestSave,
  PerKeySaveQueue,
} from "../.test-output/src/app/save-queue.js";

test("new untitled tabs keep the canonical state fields", () => {
  const tab = createUntitledTab();

  assert.match(tab.id, /^tab-\d+$/u);
  assert.match(tab.title, /^Untitled(?:-\d+)?\.md$/u);
  assert.equal(tab.filePath, null);
  assert.equal(tab.markdown, "");
  assert.equal(tab.dirty, false);
  assert.equal(tab.lastSavedMarkdown, "");
  assert.equal(tab.saveTargetDetached, false);
  assert.equal(tab.contentVersion, 0);
});

test("untitled tab ids can be owned by an explicit state object", () => {
  const tabIdState = { nextTabId: 7 };

  const firstTab = createUntitledTab(tabIdState);
  const secondTab = createUntitledTab(tabIdState);

  assert.equal(firstTab.id, "tab-7");
  assert.equal(firstTab.title, "Untitled-7.md");
  assert.equal(secondTab.id, "tab-8");
  assert.equal(secondTab.title, "Untitled-8.md");
  assert.equal(tabIdState.nextTabId, 9);
});

test("markdown updates and saves keep dirty state tied to lastSavedMarkdown", () => {
  const tab = createUntitledTab();

  const richMarkdown = [
    "# 제목",
    "",
    "한글 입력 확인",
    "",
    "- 목록 하나",
    "- 목록 둘",
    "",
    "[링크](https://example.com)",
    "",
    "```js",
    "console.log('한글 코드');",
    "```",
  ].join("\n");

  updateTabMarkdown(tab, richMarkdown);

  assert.equal(tab.markdown, richMarkdown);
  assert.equal(tab.dirty, true);
  assert.equal(tab.lastSavedMarkdown, "");
  assert.equal(getTabDisplayTitle(tab), "* " + tab.title);

  applySavedMarkdownDocument(tab, {
    path: String.raw`C:\Notes\Draft.md`,
    title: "Draft.md",
  }, richMarkdown);

  assert.equal(tab.filePath, String.raw`C:\Notes\Draft.md`);
  assert.equal(tab.title, "Draft.md");
  assert.equal(tab.lastSavedMarkdown, richMarkdown);
  assert.equal(tab.dirty, false);
  assert.equal(getTabDisplayTitle(tab), "Draft.md");
  assert.equal(getTabTooltipText(tab), String.raw`C:\Notes\Draft.md`);
});

test("tab tooltip shows saved path and falls back to displayed title for untitled tabs", () => {
  const tabIdState = { nextTabId: 1 };
  const untitledTab = createUntitledTab(tabIdState);
  assert.equal(getTabTooltipText(untitledTab), "Untitled.md");

  updateTabMarkdown(untitledTab, "# Draft");
  assert.equal(getTabTooltipText(untitledTab), "* Untitled.md");

  applySavedMarkdownDocument(untitledTab, {
    path: String.raw`C:\Notes\Draft.md`,
    title: "Draft.md",
  }, untitledTab.markdown);
  assert.equal(getTabTooltipText(untitledTab), String.raw`C:\Notes\Draft.md`);

  updateTabMarkdown(untitledTab, "# Draft\n\nchanged");
  assert.equal(getTabTooltipText(untitledTab), String.raw`C:\Notes\Draft.md`);
});

test("opened and saved documents update the tab file fingerprint", () => {
  const tabs = [createUntitledTab()];
  const opened = applyOpenedMarkdownDocument(tabs, tabs[0].id, {
    path: String.raw`C:\Notes\Draft.md`,
    title: "Draft.md",
    content: "# Draft",
    fileFingerprint: "v1:7:opened",
  });

  assert.equal(opened.tab.fileFingerprint, "v1:7:opened");

  updateTabMarkdown(opened.tab, "# Draft\n\nchanged");
  applySavedMarkdownDocument(opened.tab, {
    path: String.raw`C:\Notes\Draft.md`,
    title: "Draft.md",
    fileFingerprint: "v1:16:saved",
  }, opened.tab.markdown);

  assert.equal(opened.tab.fileFingerprint, "v1:16:saved");
  assert.equal(opened.tab.dirty, false);
});

test("detached window document snapshots preserve independent tab state", () => {
  const tab = createUntitledTab();
  updateTabMarkdown(tab, "# Draft\n\nUnsaved in source window");
  applySavedMarkdownDocument(tab, {
    path: String.raw`C:\Notes\Draft.md`,
    title: "Draft.md",
  }, "# Draft");

  const snapshot = createDetachedWindowDocumentFromTab(tab);
  const detachedTab = createTabFromDetachedWindowDocument(snapshot, { nextTabId: 30 });

  assert.deepEqual(snapshot, {
    title: "Draft.md",
    filePath: String.raw`C:\Notes\Draft.md`,
    fileFingerprint: null,
    markdown: "# Draft\n\nUnsaved in source window",
    dirty: true,
    lastSavedMarkdown: "# Draft",
    saveTargetDetached: false,
  });
  assert.equal(detachedTab.id, "tab-30");
  assert.equal(detachedTab.title, "Draft.md");
  assert.equal(detachedTab.filePath, String.raw`C:\Notes\Draft.md`);
  assert.equal(detachedTab.fileFingerprint, null);
  assert.equal(detachedTab.markdown, "# Draft\n\nUnsaved in source window");
  assert.equal(detachedTab.lastSavedMarkdown, "# Draft");
  assert.equal(detachedTab.dirty, true);
  assert.equal(detachedTab.saveTargetDetached, false);
});

test("detached window request omits markdown snapshot for BroadcastChannel handoff", () => {
  const tab = createUntitledTab();
  const largeMarkdown = createLargeSameLengthMarkdown("handoff");
  updateTabMarkdown(tab, `${largeMarkdown}\n\nUnsaved source window edit`);
  applySavedMarkdownDocument(tab, {
    path: String.raw`C:\Notes\Large.md`,
    title: "Large.md",
  }, largeMarkdown);

  const snapshot = createDetachedWindowDocumentFromTab(tab);
  const request = createDetachedWindowDocumentWindowRequest(snapshot, "handoff-token");

  assert.equal(request.title, "Large.md");
  assert.equal(request.filePath, String.raw`C:\Notes\Large.md`);
  assert.equal(request.markdown, "");
  assert.equal(request.lastSavedMarkdown, undefined);
  assert.equal(request.dirty, true);
  assert.equal(request.saveTargetDetached, false);
  assert.equal(request.handoffToken, "handoff-token");
  assert.equal(request.broadcastHandoffOnly, true);
  assert.equal(snapshot.markdown, `${largeMarkdown}\n\nUnsaved source window edit`);
  assert.equal(snapshot.lastSavedMarkdown, largeMarkdown);
});

test("detached window transfer avoids duplicating saved baseline when it matches markdown", () => {
  const tab = createUntitledTab();
  const largeMarkdown = createLargeSameLengthMarkdown("clean");
  updateTabMarkdown(tab, largeMarkdown);
  applySavedMarkdownDocument(tab, {
    path: String.raw`C:\Notes\Clean.md`,
    title: "Clean.md",
  }, largeMarkdown);

  const snapshot = createDetachedWindowDocumentFromTab(tab);
  const transfer = createDetachedWindowDocumentTransfer(snapshot);
  const restored = createDetachedWindowDocumentFromTransfer(transfer);

  assert.equal(transfer.markdown, largeMarkdown);
  assert.equal(transfer.lastSavedMarkdown, undefined);
  assert.equal(transfer.lastSavedMarkdownMatchesMarkdown, true);
  assert.deepEqual(restored, snapshot);
});

test("detached window transfer keeps distinct saved baseline for dirty documents", () => {
  const tab = createUntitledTab();
  updateTabMarkdown(tab, "# Draft\n\nUnsaved edit");
  applySavedMarkdownDocument(tab, {
    path: String.raw`C:\Notes\Draft.md`,
    title: "Draft.md",
  }, "# Draft");

  const snapshot = createDetachedWindowDocumentFromTab(tab);
  const transfer = createDetachedWindowDocumentTransfer(snapshot);
  const restored = createDetachedWindowDocumentFromTransfer(transfer);

  assert.equal(transfer.markdown, "# Draft\n\nUnsaved edit");
  assert.equal(transfer.lastSavedMarkdown, "# Draft");
  assert.equal(transfer.lastSavedMarkdownMatchesMarkdown, undefined);
  assert.deepEqual(restored, snapshot);
});

test("detached window source tab is unavailable while handoff is pending", () => {
  const firstTab = createUntitledTab();
  const sourceTab = createUntitledTab();
  const lastTab = createUntitledTab();
  const tabs = [firstTab, sourceTab, lastTab];

  updateTabMarkdown(sourceTab, "# Draft\n\nhandoff snapshot");

  const result = removeDetachedWindowSourceTab(tabs, sourceTab.id, sourceTab);

  assert.equal(result.activeTabId, firstTab.id);
  assert.deepEqual(tabs, [firstTab, lastTab]);
  assert.equal(updateTabMarkdownById(tabs, sourceTab.id, "# Draft\n\nlate edit"), null);
  assert.equal(sourceTab.markdown, "# Draft\n\nhandoff snapshot");
});

test("failed detached window handoff restores the source tab without stealing later focus", () => {
  const firstTab = createUntitledTab();
  const sourceTab = createUntitledTab();
  const lastTab = createUntitledTab();
  const tabs = [firstTab, sourceTab, lastTab];

  const result = removeDetachedWindowSourceTab(tabs, sourceTab.id, sourceTab);
  const activeTabId = restoreDetachedWindowSourceTab(tabs, lastTab.id, result.removal);

  assert.deepEqual(tabs, [firstTab, sourceTab, lastTab]);
  assert.equal(activeTabId, lastTab.id);
});

test("save completion only clears dirty state for the markdown snapshot that was written", () => {
  const tab = createUntitledTab();
  const savedMarkdown = "# Draft\n\nversion saved to disk";
  const laterMarkdown = "# Draft\n\nedited while save was pending";

  updateTabMarkdown(tab, savedMarkdown);
  updateTabMarkdown(tab, laterMarkdown);
  applySavedMarkdownDocument(tab, {
    path: String.raw`C:\Notes\Draft.md`,
    title: "Draft.md",
  }, savedMarkdown);

  assert.equal(tab.markdown, laterMarkdown);
  assert.equal(tab.lastSavedMarkdown, savedMarkdown);
  assert.equal(tab.dirty, true);
  assert.equal(getTabDisplayTitle(tab), "* Draft.md");
});

test("save as path collision keeps the detached dirty tab protected from stale saved content", () => {
  const existingTab = createUntitledTab();
  const savingTab = createUntitledTab();
  const filePath = String.raw`C:\Notes\Draft.md`;
  const savedMarkdown = "# Draft\n\nsaved on disk";

  applySavedMarkdownDocument(existingTab, {
    path: filePath,
    title: "Draft.md",
  }, savedMarkdown);
  updateTabMarkdown(existingTab, "# Draft\n\nunsaved edits");
  updateTabMarkdown(savingTab, "# Replacement\n\nsaved through Save As");

  const tabs = [existingTab, savingTab];
  applySavedMarkdownDocumentUniquely(tabs, savingTab.id, savingTab, {
    path: filePath,
    title: "Draft.md",
  }, savingTab.markdown);

  assert.equal(existingTab.filePath, null);
  assert.equal(existingTab.saveTargetDetached, true);
  assert.equal(existingTab.dirty, true);

  updateTabMarkdown(existingTab, savedMarkdown);

  assert.equal(existingTab.markdown, savedMarkdown);
  assert.equal(existingTab.lastSavedMarkdown, savedMarkdown);
  assert.equal(existingTab.dirty, true);
  assert.equal(savingTab.filePath, filePath);
  assert.equal(savingTab.dirty, false);
});

test("save as path collision detaches a protected clean tab for close-other-tabs", () => {
  const targetTab = createUntitledTab();
  const closingTab = createUntitledTab();
  const filePath = String.raw`C:\Notes\Target.md`;
  const targetMarkdown = "# Target\n\noriginal open tab";
  const savedMarkdown = "# Replacement\n\nsaved from closing tab";

  updateTabMarkdown(targetTab, targetMarkdown);
  applySavedMarkdownDocument(targetTab, {
    path: filePath,
    title: "Target.md",
  }, targetMarkdown);
  updateTabMarkdown(closingTab, savedMarkdown);

  const tabs = [targetTab, closingTab];
  const result = applySavedMarkdownDocumentUniquely(tabs, targetTab.id, closingTab, {
    path: filePath,
    title: "Target.md",
  }, closingTab.markdown, {
    protectedTabIds: new Set([targetTab.id]),
  });

  assert.deepEqual(tabs, [targetTab, closingTab]);
  assert.equal(result.activeTabId, targetTab.id);
  assert.equal(targetTab.filePath, null);
  assert.equal(targetTab.markdown, targetMarkdown);
  assert.equal(targetTab.lastSavedMarkdown, targetMarkdown);
  assert.equal(targetTab.saveTargetDetached, true);
  assert.equal(targetTab.dirty, true);
  assert.equal(closingTab.filePath, filePath);
  assert.equal(closingTab.saveTargetDetached, false);
  assert.equal(closingTab.dirty, false);
  assert.notEqual(targetTab.filePath, closingTab.filePath);

  tabs.splice(tabs.indexOf(closingTab), 1);

  assert.deepEqual(tabs, [targetTab]);
  assert.equal(targetTab.dirty, true);
});

test("save queue serializes same-tab saves so the later snapshot is written last", async () => {
  const queue = new PerKeySaveQueue("failed");
  const firstWrite = createDeferred();
  const writes = [];
  let markdown = "# Draft\n\nold";

  const firstSave = queue.enqueue("tab-1", async () => {
    const snapshot = markdown;
    writes.push(`start:${snapshot}`);
    await firstWrite.promise;
    writes.push(`finish:${snapshot}`);
    return snapshot;
  });

  await flushSaveQueue();
  markdown = "# Draft\n\nnew";

  const secondSave = queue.enqueue("tab-1", async () => {
    const snapshot = markdown;
    writes.push(`finish:${snapshot}`);
    return snapshot;
  });

  await flushSaveQueue();
  assert.deepEqual(writes, ["start:# Draft\n\nold"]);

  firstWrite.resolve();

  assert.deepEqual(await Promise.all([firstSave, secondSave]), [
    "# Draft\n\nold",
    "# Draft\n\nnew",
  ]);
  assert.deepEqual(writes, [
    "start:# Draft\n\nold",
    "finish:# Draft\n\nold",
    "finish:# Draft\n\nnew",
  ]);
});

test("debounced latest save writes only the final pending value", async () => {
  const saver = new DebouncedLatestSave(5);
  const writes = [];

  saver.schedule("classic-dark", async (themeId) => {
    writes.push(themeId);
  });
  saver.schedule("lagoon", async (themeId) => {
    writes.push(themeId);
  });
  saver.schedule("berry-dark", async (themeId) => {
    writes.push(themeId);
  });

  await waitFor(() => writes.length === 1);

  assert.deepEqual(writes, ["berry-dark"]);
});

test("debounced latest save collapses changes while a save is running", async () => {
  const saver = new DebouncedLatestSave(1);
  const firstWrite = createDeferred();
  const writes = [];
  const saveTheme = async (themeId) => {
    writes.push(`start:${themeId}`);
    if (themeId === "classic-dark") {
      await firstWrite.promise;
    }
    writes.push(`finish:${themeId}`);
  };

  saver.schedule("classic-dark", saveTheme);
  await waitFor(() => writes.length === 1);

  saver.schedule("lagoon", saveTheme);
  saver.schedule("berry-dark", saveTheme);
  await delay(5);

  assert.deepEqual(writes, ["start:classic-dark"]);

  firstWrite.resolve();
  await waitFor(() => writes.includes("finish:berry-dark"));

  assert.deepEqual(writes, [
    "start:classic-dark",
    "finish:classic-dark",
    "start:berry-dark",
    "finish:berry-dark",
  ]);
});

test("blank editor normalization keeps an untitled tab pristine", () => {
  const tab = createUntitledTab();

  updateTabMarkdown(tab, "\n\n\n");

  assert.equal(tab.markdown, "");
  assert.equal(tab.dirty, false);

  updateTabMarkdown(tab, "# Draft");
  assert.equal(tab.dirty, true);

  updateTabMarkdown(tab, "\n\n");
  assert.equal(tab.markdown, "");
  assert.equal(tab.dirty, false);
  assert.equal(tab.lastSavedMarkdown, "");
});

test("user whitespace edits in an untitled blank tab stay dirty", () => {
  const tab = createUntitledTab();
  const initialVersion = getTabContentVersion(tab);

  updateTabMarkdown(tab, "\n\n", { isKnownContentChange: true });

  assert.equal(tab.markdown, "\n\n");
  assert.equal(tab.dirty, true);
  assert.equal(tab.lastSavedMarkdown, "");
  assert.equal(getTabContentVersion(tab), initialVersion + 1);
  assert.equal(getTabDisplayTitle(tab), `* ${tab.title}`);

  updateTabMarkdown(tab, "", { isKnownContentChange: true });

  assert.equal(tab.markdown, "");
  assert.equal(tab.dirty, false);
  assert.equal(tab.lastSavedMarkdown, "");
});

test("whitespace edits to a saved blank file remain dirty", () => {
  const tabs = [createUntitledTab()];
  const { tab } = applyOpenedMarkdownDocument(tabs, tabs[0].id, {
    path: String.raw`C:\Notes\Blank.md`,
    title: "Blank.md",
    content: "",
  });

  updateTabMarkdown(tab, "\n\n");

  assert.equal(tab.markdown, "\n\n");
  assert.equal(tab.dirty, true);

  updateTabMarkdown(tab, "");

  assert.equal(tab.markdown, "");
  assert.equal(tab.dirty, false);
});

test("tab content version changes only when stored markdown changes", () => {
  const tab = createUntitledTab();
  const initialVersion = getTabContentVersion(tab);

  assert.equal(tab.contentVersion, initialVersion);

  updateTabMarkdown(tab, "\n\n");

  assert.equal(tab.markdown, "");
  assert.equal(getTabContentVersion(tab), initialVersion);
  assert.equal(tab.contentVersion, initialVersion);

  updateTabMarkdown(tab, "# Draft");
  assert.equal(getTabContentVersion(tab), initialVersion + 1);
  assert.equal(tab.contentVersion, initialVersion + 1);

  applySavedMarkdownDocument(tab, {
    path: String.raw`C:\Notes\Draft.md`,
    title: "Draft.md",
  }, tab.markdown);
  assert.equal(getTabContentVersion(tab), initialVersion + 1);
  assert.equal(tab.contentVersion, initialVersion + 1);

  updateTabMarkdown(tab, "# Draft\n\nmore");
  assert.equal(getTabContentVersion(tab), initialVersion + 2);
  assert.equal(tab.contentVersion, initialVersion + 2);
});

test("editor-origin markdown updates only mutate the source tab", () => {
  const firstTab = createUntitledTab();
  const secondTab = createUntitledTab();
  const tabs = [firstTab, secondTab];

  const sourceMarkdown = "# 첫 번째 탭\n\nsource tab update";
  const updatedTab = updateTabMarkdownById(tabs, firstTab.id, sourceMarkdown);

  assert.equal(updatedTab, firstTab);
  assert.equal(firstTab.markdown, sourceMarkdown);
  assert.equal(firstTab.dirty, true);
  assert.equal(secondTab.markdown, "");
  assert.equal(secondTab.dirty, false);
  assert.equal(updateTabMarkdownById(tabs, "closed-tab", "stale update"), null);
  assert.equal(firstTab.markdown, sourceMarkdown);
  assert.equal(secondTab.markdown, "");
});

test("editor baseline sync keeps clean opened Milkdown-normalized content clean", () => {
  const tabs = [createUntitledTab()];
  const originalMarkdown = "# Heading\n\n- one\n- two";
  const { tab } = applyOpenedMarkdownDocument(tabs, tabs[0].id, {
    path: String.raw`C:\Notes\List.md`,
    title: "List.md",
    content: originalMarkdown,
  });
  const initialVersion = getTabContentVersion(tab);
  const normalizedMarkdown = "# Heading\n\n* one\n\n* two\n\n";

  applyEditorMarkdownBaseline(tab, normalizedMarkdown);

  assert.equal(tab.markdown, normalizedMarkdown);
  assert.equal(tab.lastSavedMarkdown, normalizedMarkdown);
  assert.equal(tab.dirty, false);
  assert.equal(getTabContentVersion(tab), initialVersion + 1);

  updateTabMarkdown(tab, "# Heading\n\n* one\n\n* two\n\nchanged");
  assert.equal(tab.dirty, true);

  updateTabMarkdown(tab, normalizedMarkdown);
  assert.equal(tab.dirty, false);

  updateTabMarkdown(tab, originalMarkdown);
  assert.equal(tab.dirty, true);
});

test("editor baseline sync keeps dirty opened Milkdown-normalized content dirty", () => {
  const tabs = [createUntitledTab()];
  const originalMarkdown = "# Heading\n\n- one\n- two";
  const { tab } = applyOpenedMarkdownDocument(tabs, tabs[0].id, {
    path: String.raw`C:\Notes\List.md`,
    title: "List.md",
    content: originalMarkdown,
  });
  updateTabMarkdown(tab, `${originalMarkdown}\n\nuser edit`);
  const initialVersion = getTabContentVersion(tab);
  const normalizedMarkdown = "# Heading\n\n* one\n\n* two\n\nuser edit";

  applyEditorMarkdownBaseline(tab, normalizedMarkdown);

  assert.equal(tab.markdown, normalizedMarkdown);
  assert.equal(tab.lastSavedMarkdown, originalMarkdown);
  assert.equal(tab.dirty, true);
  assert.equal(getTabContentVersion(tab), initialVersion + 1);
});

test("completing pending saved comparison clears false dirty state before close", () => {
  const largeMarkdown = createLargeSameLengthMarkdown("saved");
  const tabs = [createUntitledTab()];
  const { tab } = applyOpenedMarkdownDocument(tabs, tabs[0].id, {
    path: String.raw`C:\Notes\Large.md`,
    title: "Large.md",
    content: largeMarkdown,
  });

  updateTabMarkdown(tab, largeMarkdown, {
    isKnownContentChange: true,
    deferSavedMarkdownComparison: true,
  });

  assert.equal(tab.dirty, true);
  assert.equal(tab.needsSavedMarkdownComparison, true);
  assert.equal(completePendingSavedMarkdownComparison(tab), true);
  assert.equal(tab.dirty, false);
  assert.equal(tab.needsSavedMarkdownComparison, false);
});

test("completing pending saved comparison keeps real same-length edits dirty", () => {
  const largeMarkdown = createLargeSameLengthMarkdown("saved");
  const editedMarkdown = `${largeMarkdown.slice(0, -1)}!`;
  const tabs = [createUntitledTab()];
  const { tab } = applyOpenedMarkdownDocument(tabs, tabs[0].id, {
    path: String.raw`C:\Notes\Large.md`,
    title: "Large.md",
    content: largeMarkdown,
  });

  assert.equal(editedMarkdown.length, largeMarkdown.length);

  updateTabMarkdown(tab, editedMarkdown, {
    isKnownContentChange: true,
    deferSavedMarkdownComparison: true,
  });

  assert.equal(tab.dirty, true);
  assert.equal(tab.needsSavedMarkdownComparison, true);
  assert.equal(completePendingSavedMarkdownComparison(tab), false);
  assert.equal(tab.dirty, true);
  assert.equal(tab.needsSavedMarkdownComparison, false);
});

test("opening files replaces only a pristine untitled tab and preserves edited tabs", () => {
  const tabs = [createUntitledTab()];

  const firstOpen = applyOpenedMarkdownDocument(tabs, tabs[0].id, {
    path: String.raw`C:\Notes\One.md`,
    title: "One.md",
    content: "# One",
  });

  assert.equal(tabs.length, 1);
  assert.equal(firstOpen.activeTabId, tabs[0].id);
  assert.equal(tabs[0].markdown, "# One");
  assert.equal(tabs[0].dirty, false);

  updateTabMarkdown(tabs[0], "# One\n\nEdited");
  const secondOpen = applyOpenedMarkdownDocument(tabs, tabs[0].id, {
    path: String.raw`C:\Notes\Two.md`,
    title: "Two.md",
    content: "# Two",
  });

  assert.equal(tabs.length, 2);
  assert.equal(tabs[0].markdown, "# One\n\nEdited");
  assert.equal(tabs[0].dirty, true);
  assert.equal(tabs[1].markdown, "# Two");
  assert.equal(secondOpen.activeTabId, tabs[1].id);
});

test("opening an already open path activates the existing tab without duplication", () => {
  const tabs = [createUntitledTab()];
  const firstOpen = applyOpenedMarkdownDocument(tabs, tabs[0].id, {
    path: String.raw`C:\Users\Demo\Notes\File Name.md`,
    title: "File Name.md",
    content: "# Original",
  });

  const duplicateOpen = applyOpenedMarkdownDocument(tabs, firstOpen.activeTabId, {
    path: String.raw`\\?\C:\Users\Demo\Notes\Sub\..\FILE NAME.md`,
    title: "FILE NAME.md",
    content: "# Re-read",
  });

  assert.equal(tabs.length, 1);
  assert.equal(duplicateOpen.activeTabId, firstOpen.activeTabId);
  assert.equal(duplicateOpen.reusedExistingTab, true);
  assert.equal(tabs[0].markdown, "# Original");
});

test("opening with a stale explicit null existing tab still rechecks current tabs", () => {
  const tabs = [createUntitledTab()];
  const firstOpen = applyOpenedMarkdownDocument(tabs, tabs[0].id, {
    path: String.raw`C:\Users\Demo\Notes\File Name.md`,
    title: "File Name.md",
    content: "# Original",
  });

  const duplicateOpen = applyOpenedMarkdownDocument(tabs, firstOpen.activeTabId, {
    path: String.raw`C:\Users\Demo\Notes\FILE NAME.md`,
    title: "FILE NAME.md",
    content: "# Re-read",
  }, null);

  assert.equal(tabs.length, 1);
  assert.equal(duplicateOpen.activeTabId, firstOpen.activeTabId);
  assert.equal(duplicateOpen.reusedExistingTab, true);
  assert.equal(tabs[0].markdown, "# Original");
});

test("path comparison normalizes Windows separators, case, dot segments, and verbatim prefixes", () => {
  assert.equal(
    normalizeFilePathForComparison(String.raw`C:/Users/Demo/Notes/../Notes/File.md`),
    normalizeFilePathForComparison(String.raw`\\?\C:\users\demo\notes\file.md`),
  );
  assert.equal(
    normalizeFilePathForComparison(String.raw`\\?\UNC\Server\Share\Folder\File.md`),
    normalizeFilePathForComparison(String.raw`\\server\share\folder\file.md`),
  );
});

test("findTabByFilePath handles long names and spaces without matching the excluded tab", () => {
  const tab = createUntitledTab();
  tab.title = "A very long file name with spaces and symbols.md";
  tab.filePath = String.raw`C:\Notes\A very long file name with spaces and symbols.md`;
  const tabs = [tab];

  assert.equal(
    findTabByFilePath(
      tabs,
      String.raw`c:\notes\.\A VERY LONG FILE NAME WITH SPACES AND SYMBOLS.md`,
    ),
    tab,
  );
  assert.equal(findTabByFilePath(tabs, tab.filePath, tab.id), null);

  updateTabMarkdown(tab, "changed");
  assert.equal(getTabDisplayTitle(tab), `* ${tab.title}`);
});

test("file path tab index uses normalized paths and preserves first matches", () => {
  const firstTab = createUntitledTab();
  firstTab.filePath = String.raw`C:\Notes\File.md`;

  const duplicatePathTab = createUntitledTab();
  duplicatePathTab.filePath = String.raw`\\?\C:\Notes\Sub\..\FILE.md`;

  const excludedTab = createUntitledTab();
  excludedTab.filePath = String.raw`C:\Notes\Excluded.md`;

  const tabsByPath = createFilePathTabIndex(
    [firstTab, duplicatePathTab, excludedTab],
    excludedTab.id,
  );

  assert.equal(
    tabsByPath.get(normalizeFilePathForComparison(duplicatePathTab.filePath)),
    firstTab,
  );
  assert.equal(
    tabsByPath.has(normalizeFilePathForComparison(excludedTab.filePath)),
    false,
  );
});

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

async function flushSaveQueue() {
  await Promise.resolve();
  await Promise.resolve();
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitFor(predicate) {
  const deadline = Date.now() + 500;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("condition was not met before timeout");
    }

    await delay(5);
  }
}

function createLargeSameLengthMarkdown(label) {
  return Array.from({ length: 3000 }, (_, index) => {
    return `${label} line ${String(index).padStart(4, "0")} keeps comparison over the large markdown threshold.`;
  }).join("\n");
}
