import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { AllSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { nord as milkdownNord } from "@milkdown/theme-nord";
import "@milkdown/crepe/theme/common/style.css";
import type { EditorTab } from "../app/document-state";
import type { AppCopy } from "../app/i18n";
import {
  applyMilkdownThemeStyles,
  getMarkdownEditorTheme,
  type MarkdownEditorThemeId,
} from "./milkdown-themes";

const MARKDOWN_CHANGE_FLUSH_DELAY_MS = 150;
const MEDIUM_MARKDOWN_CHANGE_CHARACTER_LIMIT = 32 * 1024;
const LARGE_MARKDOWN_CHANGE_CHARACTER_LIMIT = 128 * 1024;
const VERY_LARGE_MARKDOWN_CHANGE_CHARACTER_LIMIT = 1024 * 1024;
const MEDIUM_MARKDOWN_CHANGE_FLUSH_DELAY_MS = 500;
const LARGE_MARKDOWN_CHANGE_FLUSH_DELAY_MS = 750;
const VERY_LARGE_MARKDOWN_CHANGE_FLUSH_DELAY_MS = 1500;
const LARGE_MARKDOWN_CURSOR_PROBE_OFFSETS = [
  0,
  -1,
  1,
  -2,
  2,
  -4,
  4,
  -8,
  8,
  -16,
  16,
  -32,
  32,
];
const MAX_LARGE_MARKDOWN_DIFFERENCE_PROBES = 8;

export interface MarkdownEditorProps {
  tab: EditorTab;
  themeId: MarkdownEditorThemeId;
  copy: AppCopy["editor"];
  onChange: (change: MarkdownEditorChange) => void;
}

export type MarkdownEditorChange =
  | MarkdownEditorSerializedChange
  | MarkdownEditorPendingChange;

export interface MarkdownEditorSerializedChange {
  tabId: string;
  markdown: string;
  knownChangedIndex?: number;
  isSavedBaselineSync?: boolean;
  isPendingContentChange?: false;
}

export interface MarkdownEditorPendingChange {
  tabId: string;
  isPendingContentChange: true;
}

export interface MarkdownEditorFlushOptions {
  requireSerializedMarkdown?: boolean;
}

export interface MarkdownEditorDestroyOptions {
  flushPendingMarkdown?: boolean;
  requireSerializedMarkdown?: boolean;
}

export interface MarkdownEditorScrollPosition {
  left: number;
  top: number;
}

export type MarkdownEditorContextCommand =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "select-all"
  | "bold"
  | "italic"
  | "inline-code";

export interface MarkdownEditorContextState {
  hasSelection: boolean;
}

interface MarkdownEditorContextSelection {
  from: number;
  to: number;
}

export interface MarkdownEditorHandle {
  element: HTMLElement;
  captureScrollPosition: () => MarkdownEditorScrollPosition;
  captureContextSelection: (x?: number, y?: number) => MarkdownEditorContextState;
  flushPendingMarkdownChange?: (options?: MarkdownEditorFlushOptions) => void;
  getContextState: () => MarkdownEditorContextState;
  restoreScrollPosition: (position: MarkdownEditorScrollPosition) => void;
  runContextCommand: (command: MarkdownEditorContextCommand) => Promise<void>;
  setCopy: (copy: AppCopy["editor"]) => void;
  destroy: (options?: MarkdownEditorDestroyOptions) => void;
}

export function MarkdownEditor({
  tab,
  themeId,
  copy,
  onChange,
}: MarkdownEditorProps): MarkdownEditorHandle {
  const theme = getMarkdownEditorTheme(themeId);
  const tabId = tab.id;
  let editorCopy = copy;
  applyMilkdownThemeStyles(theme.id);

  const editorHost = document.createElement("section");
  editorHost.className = "editor-host";
  editorHost.setAttribute("data-region", "editor");
  editorHost.dataset.editorTabId = tabId;

  const editorMount = document.createElement("div");
  editorMount.className = "markdown-editor";
  editorMount.setAttribute("aria-label", editorCopy.ariaLabel);
  editorMount.dataset.errorLabel = editorCopy.errorLabel;
  editorMount.dataset.editorTabId = tabId;
  editorMount.dataset.editorThemeId = theme.id;
  editorMount.dataset.editorThemeMode = theme.isDark ? "dark" : "light";

  editorHost.append(editorMount);

  let editor: Crepe | null = null;
  let disposed = false;
  let lastFlushedMarkdown = tab.markdown;
  let onMarkdownChange: MarkdownEditorProps["onChange"] | null = onChange;
  let hasPendingMarkdownChange = false;
  let hasReportedPendingMarkdownChange = false;
  let pendingMarkdownProbeIndex: number | null = null;
  let pendingMarkdownFlushTimer: number | null = null;
  let largeMarkdownDifferenceProbeIndexes: number[] = [];
  let savedContextSelection: MarkdownEditorContextSelection | null = null;
  let pendingScrollPosition: MarkdownEditorScrollPosition | null = null;
  let pendingScrollRestoreFrame: number | null = null;
  let hasSyncedInitialMarkdownBaseline = false;
  let editorReady = false;

  queueMicrotask(() => {
    if (disposed) {
      return;
    }

    const crepe = new Crepe({
      root: editorMount,
      defaultValue: lastFlushedMarkdown,
      features: {
        [Crepe.Feature.BlockEdit]: true,
      },
    });

    if (theme.useMilkdownNord) {
      crepe.editor.config(milkdownNord);
    }

    crepe.on((listenerApi) => {
      listenerApi.updated(() => {
        if (disposed || !hasSyncedInitialMarkdownBaseline) {
          return;
        }

        const markdownLengthEstimate = getCurrentMarkdownLengthEstimate();
        hasPendingMarkdownChange = true;
        pendingMarkdownProbeIndex = getCurrentMarkdownProbeIndex(markdownLengthEstimate);
        if (shouldReportPendingMarkdownChange(markdownLengthEstimate)) {
          reportPendingMarkdownChange();
        }
        schedulePendingMarkdownChangeFlush(markdownLengthEstimate);
      });
    });

    editor = crepe;

    void crepe
      .create()
      .then(() => {
        if (disposed) {
          void Promise.resolve(crepe.destroy()).catch(console.error);
          return;
        }

        syncInitialMarkdownBaseline();
        hasSyncedInitialMarkdownBaseline = true;
        editorReady = true;
        editorMount
          .querySelector<HTMLElement>(".ProseMirror")
          ?.focus({ preventScroll: true });
        restorePendingScrollPosition();
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!disposed) {
          editorMount.classList.add("markdown-editor--error");
        }
      });
  });

  return {
    element: editorHost,
    captureScrollPosition: () => getScrollPosition(),
    captureContextSelection: (x, y) => {
      savedContextSelection = getEditorContextRange(x, y);
      return getContextStateFromSelection(savedContextSelection);
    },
    flushPendingMarkdownChange: (options = {}) => {
      flushPendingMarkdownChange({
        force: options.requireSerializedMarkdown !== false,
        requireSerializedMarkdown: options.requireSerializedMarkdown !== false,
      });
    },
    getContextState: () => {
      if (savedContextSelection) {
        return getContextStateFromSelection(savedContextSelection);
      }

      const editorView = getEditorView();
      if (!editorView) {
        return getContextStateFromSelection(null);
      }

      return getContextStateFromSelection(
        createContextSelection(
          editorView,
          editorView.state.selection.from,
          editorView.state.selection.to,
        ),
      );
    },
    restoreScrollPosition: (position) => {
      restoreScrollPosition(position);
    },
    runContextCommand: (command) => runContextCommand(command),
    setCopy: (nextCopy) => {
      editorCopy = nextCopy;
      editorMount.setAttribute("aria-label", editorCopy.ariaLabel);
      editorMount.dataset.errorLabel = editorCopy.errorLabel;
    },
    destroy: (options = {}) => {
      if (options.flushPendingMarkdown !== false) {
        flushPendingMarkdownChange({
          force: options.requireSerializedMarkdown !== false,
          requireSerializedMarkdown: options.requireSerializedMarkdown !== false,
        });
      }
      disposed = true;
      onMarkdownChange = null;
      savedContextSelection = null;
      pendingScrollPosition = null;

      if (pendingScrollRestoreFrame !== null) {
        window.cancelAnimationFrame(pendingScrollRestoreFrame);
        pendingScrollRestoreFrame = null;
      }

      if (editor) {
        void Promise.resolve(editor.destroy()).catch(console.error);
        editor = null;
      }
    },
  };

  function getScrollPosition(): MarkdownEditorScrollPosition {
    return {
      left: editorMount.scrollLeft,
      top: editorMount.scrollTop,
    };
  }

  function restoreScrollPosition(position: MarkdownEditorScrollPosition): void {
    pendingScrollPosition = normalizeScrollPosition(position);
    applyPendingScrollPosition();

    if (editorReady) {
      schedulePendingScrollRestore();
    }
  }

  function normalizeScrollPosition(position: MarkdownEditorScrollPosition): MarkdownEditorScrollPosition {
    return {
      left: Math.max(0, Math.floor(position.left)),
      top: Math.max(0, Math.floor(position.top)),
    };
  }

  function restorePendingScrollPosition(): void {
    applyPendingScrollPosition();

    if (editorReady) {
      schedulePendingScrollRestore();
    }
  }

  function applyPendingScrollPosition(): void {
    if (!pendingScrollPosition || disposed) {
      return;
    }

    editorMount.scrollLeft = pendingScrollPosition.left;
    editorMount.scrollTop = pendingScrollPosition.top;
  }

  function schedulePendingScrollRestore(): void {
    if (!pendingScrollPosition || pendingScrollRestoreFrame !== null || disposed) {
      return;
    }

    pendingScrollRestoreFrame = window.requestAnimationFrame(() => {
      pendingScrollRestoreFrame = null;
      applyPendingScrollPosition();
      pendingScrollPosition = null;
    });
  }

  function schedulePendingMarkdownChangeFlush(markdownLength: number): void {
    if (!shouldSerializePendingMarkdownChangeAutomatically(markdownLength)) {
      if (pendingMarkdownFlushTimer !== null) {
        window.clearTimeout(pendingMarkdownFlushTimer);
        pendingMarkdownFlushTimer = null;
      }

      reportPendingMarkdownChange();
      return;
    }

    if (pendingMarkdownFlushTimer !== null) {
      if (!shouldDebouncePendingMarkdownChangeFlush(markdownLength)) {
        return;
      }

      // For medium and large documents, avoid repeated full Markdown serialization while edits are still arriving.
      window.clearTimeout(pendingMarkdownFlushTimer);
      pendingMarkdownFlushTimer = null;
    }

    const delayMs = getMarkdownChangeFlushDelay(markdownLength);
    queuePendingMarkdownChangeFlush(delayMs);
  }

  function queuePendingMarkdownChangeFlush(delayMs: number): void {
    pendingMarkdownFlushTimer = window.setTimeout(() => {
      pendingMarkdownFlushTimer = null;
      try {
        flushPendingMarkdownChange({ force: false });
      } catch (error) {
        console.error("Failed to flush pending Markdown change.", error);
      }
    }, delayMs);
  }

  function flushPendingMarkdownChange(options: {
    force: boolean;
    requireSerializedMarkdown?: boolean;
  }): void {
    const requireSerializedMarkdown = options.requireSerializedMarkdown !== false;

    if (pendingMarkdownFlushTimer !== null) {
      window.clearTimeout(pendingMarkdownFlushTimer);
      pendingMarkdownFlushTimer = null;
    }

    const markdownLengthEstimate = getCurrentMarkdownLengthEstimate();
    if (!requireSerializedMarkdown && shouldReportPendingMarkdownChange(markdownLengthEstimate)) {
      reportPendingMarkdownChange();
      return;
    }

    const probeIndex = pendingMarkdownProbeIndex;
    const markdown = hasPendingMarkdownChange ? getCurrentMarkdown() : null;

    if (disposed || !hasPendingMarkdownChange || markdown === null) {
      hasPendingMarkdownChange = false;
      pendingMarkdownProbeIndex = null;
      return;
    }

    hasPendingMarkdownChange = false;
    hasReportedPendingMarkdownChange = false;
    pendingMarkdownProbeIndex = null;

    const change = getMarkdownChange(markdown, lastFlushedMarkdown, probeIndex);
    if (!change.hasChanged) {
      return;
    }

    lastFlushedMarkdown = markdown;
    onMarkdownChange?.({
      tabId,
      markdown,
      knownChangedIndex: change.knownChangedIndex ?? undefined,
    });
  }

  function reportPendingMarkdownChange(): void {
    if (disposed || !hasPendingMarkdownChange || hasReportedPendingMarkdownChange) {
      return;
    }

    hasReportedPendingMarkdownChange = true;
    onMarkdownChange?.({
      tabId,
      isPendingContentChange: true,
    });
  }

  function shouldReportPendingMarkdownChange(markdownLength: number): boolean {
    return markdownLength > MEDIUM_MARKDOWN_CHANGE_CHARACTER_LIMIT;
  }

  function getCurrentMarkdown(): string | null {
    if (!editor) {
      return null;
    }

    try {
      return editor.getMarkdown();
    } catch (error) {
      throw new Error(editorCopy.serializeError, { cause: error });
    }
  }

  function syncInitialMarkdownBaseline(): void {
    const markdown = getCurrentMarkdown();
    if (markdown !== null) {
      lastFlushedMarkdown = markdown;
    }
  }

  function getCurrentMarkdownLengthEstimate(): number {
    const editorView = getEditorView();

    if (!editorView) {
      return lastFlushedMarkdown.length;
    }

    return Math.max(0, editorView.state.doc.content.size);
  }

  function getCurrentMarkdownProbeIndex(markdownLength: number): number | null {
    if (markdownLength <= 0) {
      return null;
    }

    const editorView = getEditorView();
    if (!editorView) {
      return null;
    }

    const selection = editorView.state.selection;
    const cursorPosition = Math.max(selection.from, selection.to) - 1;

    return clampMarkdownIndex(cursorPosition, markdownLength);
  }

  function getMarkdownChange(
    markdown: string,
    previousMarkdown: string,
    probeIndex: number | null,
  ): { hasChanged: boolean; knownChangedIndex: number | null } {
    if (markdown.length !== previousMarkdown.length) {
      largeMarkdownDifferenceProbeIndexes = [];
      return { hasChanged: true, knownChangedIndex: null };
    }

    if (markdown.length >= LARGE_MARKDOWN_CHANGE_CHARACTER_LIMIT) {
      const sampledDifferenceIndex = getSampledMarkdownDifferenceIndex(
        markdown,
        previousMarkdown,
        probeIndex,
      );

      if (sampledDifferenceIndex !== null) {
        rememberLargeMarkdownDifferenceIndex(sampledDifferenceIndex);
        return { hasChanged: true, knownChangedIndex: sampledDifferenceIndex };
      }

      // The editor update event is already the change signal. Avoid walking the full
      // string here just to recover an exact index for large equal-length edits.
      return { hasChanged: true, knownChangedIndex: null };
    }

    if (markdown === previousMarkdown) {
      return { hasChanged: false, knownChangedIndex: null };
    }

    return { hasChanged: true, knownChangedIndex: null };
  }

  function getSampledMarkdownDifferenceIndex(
    markdown: string,
    previousMarkdown: string,
    probeIndex: number | null,
  ): number | null {
    for (const index of getLargeMarkdownProbeIndexes(markdown.length, probeIndex)) {
      if (markdown.charCodeAt(index) !== previousMarkdown.charCodeAt(index)) {
        return index;
      }
    }

    return null;
  }

  function getLargeMarkdownProbeIndexes(
    markdownLength: number,
    probeIndex: number | null,
  ): number[] {
    const indexes = new Set<number>();

    addMarkdownProbeIndex(indexes, 0, markdownLength);
    addMarkdownProbeIndex(indexes, markdownLength >> 2, markdownLength);
    addMarkdownProbeIndex(indexes, markdownLength >> 1, markdownLength);
    addMarkdownProbeIndex(indexes, (markdownLength * 3) >> 2, markdownLength);
    addMarkdownProbeIndex(indexes, markdownLength - 1, markdownLength);

    for (const index of largeMarkdownDifferenceProbeIndexes) {
      addMarkdownProbeIndex(indexes, index, markdownLength);
    }

    if (probeIndex !== null) {
      for (const offset of LARGE_MARKDOWN_CURSOR_PROBE_OFFSETS) {
        addMarkdownProbeIndex(indexes, probeIndex + offset, markdownLength);
      }
    }

    return Array.from(indexes);
  }

  function addMarkdownProbeIndex(
    indexes: Set<number>,
    index: number,
    markdownLength: number,
  ): void {
    if (markdownLength <= 0) {
      return;
    }

    indexes.add(clampMarkdownIndex(index, markdownLength));
  }

  function rememberLargeMarkdownDifferenceIndex(index: number): void {
    largeMarkdownDifferenceProbeIndexes = [
      index,
      ...largeMarkdownDifferenceProbeIndexes.filter((probeIndex) => probeIndex !== index),
    ].slice(0, MAX_LARGE_MARKDOWN_DIFFERENCE_PROBES);
  }

  function clampMarkdownIndex(index: number, markdownLength: number): number {
    return Math.max(0, Math.min(index, markdownLength - 1));
  }

  async function runContextCommand(command: MarkdownEditorContextCommand): Promise<void> {
    try {
      await runContextCommandUnsafe(command);
    } catch (error) {
      throw new Error(editorCopy.editCommandError(command), { cause: error });
    }
  }

  async function runContextCommandUnsafe(command: MarkdownEditorContextCommand): Promise<void> {
    const editorView = getEditorView();

    if (!editorView) {
      return;
    }

    if (command === "select-all") {
      selectEditorContents(editorView);
      return;
    }

    if (command === "paste") {
      await pasteClipboardText(editorView);
      return;
    }

    if (command === "cut" || command === "copy") {
      const selection = getContextSelection(editorView);

      if (!getContextStateFromSelection(selection).hasSelection) {
        return;
      }

      const copied = await copySelectedText(editorView, selection);

      if (command === "cut" && copied) {
        deleteContextSelection(editorView, selection);
      }

      return;
    }

    if (command === "undo" || command === "redo") {
      editorView.focus();
      document.execCommand(command);
      return;
    }

    if (command === "bold") {
      replaceSelectionWithMarkedText(
        editorView,
        ["strong", "bold"],
        editorCopy.boldPlaceholder,
        "**",
        "**",
      );
      return;
    }

    if (command === "italic") {
      replaceSelectionWithMarkedText(
        editorView,
        ["emphasis", "em"],
        editorCopy.italicPlaceholder,
        "*",
        "*",
      );
      return;
    }

    if (command === "inline-code") {
      replaceSelectionWithMarkedText(
        editorView,
        ["inlineCode", "code_inline", "code"],
        "code",
        "`",
        "`",
      );
      return;
    }
  }

  function getEditorView(): EditorView | null {
    if (!editor) {
      return null;
    }

    let editorView: EditorView | null = null;

    editor.editor.action((ctx) => {
      editorView = ctx.get(editorViewCtx);
    });

    return editorView;
  }

  function getEditorContextRange(x?: number, y?: number): MarkdownEditorContextSelection | null {
    const editorView = getEditorView();

    if (!editorView) {
      return null;
    }

    const selection = editorView.state.selection;

    if (!selection.empty) {
      return createContextSelection(editorView, selection.from, selection.to);
    }

    const position =
      x !== undefined && y !== undefined
        ? editorView.posAtCoords({ left: x, top: y })?.pos
        : undefined;
    const fallbackPosition = position ?? selection.from;
    const boundedPosition = clampEditorPosition(editorView, fallbackPosition);

    return createContextSelection(editorView, boundedPosition, boundedPosition);
  }

  function createContextSelection(
    editorView: EditorView,
    from: number,
    to: number,
  ): MarkdownEditorContextSelection {
    const start = clampEditorPosition(editorView, Math.min(from, to));
    const end = clampEditorPosition(editorView, Math.max(from, to));

    return {
      from: start,
      to: end,
    };
  }

  function clampEditorPosition(editorView: EditorView, position: number): number {
    return Math.max(0, Math.min(position, editorView.state.doc.content.size));
  }

  function getContextSelection(editorView: EditorView): MarkdownEditorContextSelection {
    return (
      savedContextSelection ??
      createContextSelection(editorView, editorView.state.selection.from, editorView.state.selection.to)
    );
  }

  function getContextSelectionText(
    editorView: EditorView,
    selection: MarkdownEditorContextSelection,
  ): string {
    if (selection.from === selection.to) {
      return "";
    }

    return editorView.state.doc.textBetween(selection.from, selection.to, "\n");
  }

  function selectEditorContents(editorView: EditorView): void {
    const transaction = editorView.state.tr.setSelection(new AllSelection(editorView.state.doc));

    editorView.dispatch(transaction);
    editorView.focus();
    savedContextSelection = createContextSelection(editorView, 0, editorView.state.doc.content.size);
  }

  async function pasteClipboardText(editorView: EditorView): Promise<void> {
    let clipboardText: string | null = null;

    try {
      clipboardText = await navigator.clipboard?.readText();
    } catch {
      clipboardText = null;
    }

    if (clipboardText !== null && clipboardText !== undefined) {
      replaceSelectionWithText(editorView, clipboardText);
    }
  }

  async function copySelectedText(
    editorView: EditorView,
    selection: MarkdownEditorContextSelection,
  ): Promise<boolean> {
    const selectedText = getContextSelectionText(editorView, selection);

    if (!selectedText) {
      return false;
    }

    const clipboard = navigator.clipboard;

    if (!clipboard || typeof clipboard.writeText !== "function") {
      return false;
    }

    try {
      await clipboard.writeText(selectedText);
      return true;
    } catch {
      return false;
    }
  }

  function deleteContextSelection(
    editorView: EditorView,
    selection = getContextSelection(editorView),
  ): void {
    if (selection.from === selection.to) {
      return;
    }

    const transaction = editorView.state.tr.delete(selection.from, selection.to).scrollIntoView();

    editorView.dispatch(transaction);
    editorView.focus();
    savedContextSelection = createContextSelection(editorView, selection.from, selection.from);
  }

  function replaceSelectionWithMarkedText(
    editorView: EditorView,
    markNames: string[],
    placeholder: string,
    fallbackPrefix: string,
    fallbackSuffix: string,
  ): void {
    const selection = getContextSelection(editorView);
    const selectionText = getContextSelectionText(editorView, selection);
    const text = selectionText.length > 0 ? selectionText : placeholder;
    const markType = markNames
      .map((name) => editorView.state.schema.marks[name])
      .find((candidate) => Boolean(candidate));

    if (!markType) {
      replaceSelectionWithText(editorView, `${fallbackPrefix}${text}${fallbackSuffix}`);
      return;
    }

    const textNode = editorView.state.schema.text(text, [markType.create()]);
    const transaction = editorView.state.tr
      .replaceWith(selection.from, selection.to, textNode)
      .scrollIntoView();

    editorView.dispatch(transaction);
    editorView.focus();
    savedContextSelection = createContextSelection(
      editorView,
      selection.from + text.length,
      selection.from + text.length,
    );
  }

  function replaceSelectionWithText(editorView: EditorView, text: string): void {
    const selection = getContextSelection(editorView);
    const transaction = editorView.state.tr
      .insertText(text, selection.from, selection.to)
      .scrollIntoView();

    editorView.dispatch(transaction);
    editorView.focus();
    savedContextSelection = createContextSelection(
      editorView,
      selection.from + text.length,
      selection.from + text.length,
    );
  }
}

function getMarkdownChangeFlushDelay(markdownLength: number): number {
  if (markdownLength > VERY_LARGE_MARKDOWN_CHANGE_CHARACTER_LIMIT) {
    return VERY_LARGE_MARKDOWN_CHANGE_FLUSH_DELAY_MS;
  }

  if (markdownLength > LARGE_MARKDOWN_CHANGE_CHARACTER_LIMIT) {
    return LARGE_MARKDOWN_CHANGE_FLUSH_DELAY_MS;
  }

  if (markdownLength > MEDIUM_MARKDOWN_CHANGE_CHARACTER_LIMIT) {
    return MEDIUM_MARKDOWN_CHANGE_FLUSH_DELAY_MS;
  }

  return MARKDOWN_CHANGE_FLUSH_DELAY_MS;
}

function shouldDebouncePendingMarkdownChangeFlush(markdownLength: number): boolean {
  return markdownLength > MEDIUM_MARKDOWN_CHANGE_CHARACTER_LIMIT;
}

function shouldSerializePendingMarkdownChangeAutomatically(markdownLength: number): boolean {
  return markdownLength <= LARGE_MARKDOWN_CHANGE_CHARACTER_LIMIT;
}

function getContextStateFromSelection(
  selection: MarkdownEditorContextSelection | null,
): MarkdownEditorContextState {
  return {
    hasSelection: Boolean(selection && selection.from !== selection.to),
  };
}
