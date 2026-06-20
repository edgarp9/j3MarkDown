export interface EditorTab {
  id: string;
  title: string;
  filePath: string | null;
  fileFingerprint: string | null;
  markdown: string;
  dirty: boolean;
  lastSavedMarkdown: string;
  needsSavedMarkdownComparison?: boolean;
  saveTargetDetached: boolean;
  contentVersion?: number;
  updatedAt: Date;
}

export interface DocumentStats {
  lines: number;
  words: number;
  characters: number;
}

export interface DocumentStatsScanState {
  readonly markdown: string;
  index: number;
  lines: number;
  words: number;
  isInWord: boolean;
}

export interface OpenedMarkdownDocument {
  path: string;
  title: string;
  content: string;
  fileFingerprint?: string | null;
}

export interface SavedMarkdownDocument {
  path: string;
  title: string;
  fileFingerprint?: string | null;
}

export interface DetachedWindowDocument {
  title: string;
  filePath: string | null;
  fileFingerprint: string | null;
  markdown: string;
  dirty: boolean;
  lastSavedMarkdown: string;
  saveTargetDetached: boolean;
  handoffToken?: string;
}

export interface DetachedWindowDocumentTransfer {
  title: string;
  filePath: string | null;
  fileFingerprint?: string | null;
  markdown: string;
  dirty: boolean;
  lastSavedMarkdown?: string;
  lastSavedMarkdownMatchesMarkdown?: boolean;
  saveTargetDetached: boolean;
  handoffToken?: string;
  broadcastHandoffOnly?: boolean;
}

export interface DetachedWindowSourceTabRemoval {
  readonly tab: EditorTab;
  readonly index: number;
  readonly wasActive: boolean;
  readonly replacementActiveTabId: string;
}

export interface DetachedWindowSourceTabRemovalResult {
  readonly activeTabId: string;
  readonly removal: DetachedWindowSourceTabRemoval;
}

export interface OpenedMarkdownDocumentResult {
  activeTabId: string;
  tab: EditorTab;
  reusedExistingTab: boolean;
}

export interface SavedMarkdownDocumentResult {
  activeTabId: string;
  tab: EditorTab;
}

export interface SaveMarkdownDocumentUniquelyOptions {
  protectedTabIds?: ReadonlySet<string>;
}

export type FilePathTabIndex = Map<string, EditorTab>;

export interface UpdateTabMarkdownOptions {
  isKnownContentChange?: boolean;
  knownChangedIndex?: number;
  deferSavedMarkdownComparison?: boolean;
}

export interface UntitledTabIdState {
  nextTabId: number;
}

const defaultUntitledTabIdState: UntitledTabIdState = {
  nextTabId: 1,
};
const MARKDOWN_NON_WHITESPACE_PATTERN = /\S/u;
const LARGE_MARKDOWN_SAVED_COMPARISON_CHARACTER_LIMIT = 128 * 1024;
const TRAILING_MARKDOWN_CHANGE_PREFIX_SAMPLE_SIZE = 64;

export function createUntitledTab(
  tabIdState: UntitledTabIdState = defaultUntitledTabIdState,
): EditorTab {
  const tabNumber = tabIdState.nextTabId;
  tabIdState.nextTabId += 1;

  const tab = {
    id: `tab-${tabNumber}`,
    title: tabNumber === 1 ? "Untitled.md" : `Untitled-${tabNumber}.md`,
    filePath: null,
    fileFingerprint: null,
    markdown: "",
    dirty: false,
    lastSavedMarkdown: "",
    needsSavedMarkdownComparison: false,
    saveTargetDetached: false,
    contentVersion: 0,
    updatedAt: new Date(),
  };

  return tab;
}

export function getTabDisplayTitle(tab: EditorTab): string {
  return `${tab.dirty ? "* " : ""}${tab.title}`;
}

export function getTabTooltipText(tab: EditorTab): string {
  return tab.filePath ?? getTabDisplayTitle(tab);
}

export function isPristineUntitledTab(tab: EditorTab): boolean {
  return (
    tab.filePath === null &&
    !tab.dirty &&
    tab.markdown.length === 0 &&
    tab.lastSavedMarkdown.length === 0 &&
    !tab.saveTargetDetached
  );
}

export function normalizeFilePathForComparison(filePath: string): string {
  const path = removeWindowsVerbatimPrefix(filePath.replace(/\//gu, "\\"));
  const { root, rest, preventsAboveRoot } = splitWindowsPathRoot(path);
  const segments = normalizePathSegments(rest.split("\\"), preventsAboveRoot);
  const suffix = segments.join("\\");
  const needsSeparator =
    root.length > 0 && suffix.length > 0 && !root.endsWith("\\") && !/^[a-z]:$/iu.test(root);

  return `${root}${needsSeparator ? "\\" : ""}${suffix}`.toLowerCase();
}

export function createFilePathTabIndex(
  tabs: EditorTab[],
  excludedTabId: string | null = null,
): FilePathTabIndex {
  const tabsByFilePath: FilePathTabIndex = new Map();

  for (const tab of tabs) {
    if (tab.id === excludedTabId || tab.filePath === null) {
      continue;
    }

    const normalizedFilePath = normalizeFilePathForComparison(tab.filePath);
    if (!tabsByFilePath.has(normalizedFilePath)) {
      tabsByFilePath.set(normalizedFilePath, tab);
    }
  }

  return tabsByFilePath;
}

export function getTabContentVersion(tab: EditorTab): number {
  return tab.contentVersion ?? 0;
}

export function createDetachedWindowDocumentFromTab(
  tab: EditorTab,
): DetachedWindowDocument {
  return {
    title: tab.title,
    filePath: tab.filePath,
    fileFingerprint: tab.fileFingerprint,
    markdown: tab.markdown,
    dirty: tab.dirty,
    lastSavedMarkdown: tab.lastSavedMarkdown,
    saveTargetDetached: tab.saveTargetDetached,
  };
}

export function createDetachedWindowDocumentWindowRequest(
  document: DetachedWindowDocument,
  handoffToken: string,
): DetachedWindowDocumentTransfer {
  return {
    title: document.title,
    filePath: document.filePath,
    fileFingerprint: document.fileFingerprint,
    markdown: "",
    dirty: document.dirty,
    saveTargetDetached: document.saveTargetDetached,
    handoffToken,
    broadcastHandoffOnly: true,
  };
}

export function createDetachedWindowDocumentTransfer(
  document: DetachedWindowDocument,
): DetachedWindowDocumentTransfer {
  const transfer: DetachedWindowDocumentTransfer = {
    title: document.title,
    filePath: document.filePath,
    fileFingerprint: document.fileFingerprint,
    markdown: document.markdown,
    dirty: document.dirty,
    saveTargetDetached: document.saveTargetDetached,
  };

  if (document.lastSavedMarkdown === document.markdown) {
    transfer.lastSavedMarkdownMatchesMarkdown = true;
  } else {
    transfer.lastSavedMarkdown = document.lastSavedMarkdown;
  }

  if (document.handoffToken) {
    transfer.handoffToken = document.handoffToken;
  }

  return transfer;
}

export function createDetachedWindowDocumentFromTransfer(
  transfer: DetachedWindowDocumentTransfer,
): DetachedWindowDocument {
  const document: DetachedWindowDocument = {
    title: transfer.title,
    filePath: transfer.filePath,
    fileFingerprint: transfer.fileFingerprint ?? null,
    markdown: transfer.markdown,
    dirty: transfer.dirty,
    lastSavedMarkdown:
      transfer.lastSavedMarkdownMatchesMarkdown === true
        ? transfer.markdown
        : transfer.lastSavedMarkdown ?? "",
    saveTargetDetached: transfer.saveTargetDetached,
  };

  if (transfer.handoffToken) {
    document.handoffToken = transfer.handoffToken;
  }

  return document;
}

export function removeDetachedWindowSourceTab(
  tabs: EditorTab[],
  activeTabId: string,
  tab: EditorTab,
): DetachedWindowSourceTabRemovalResult | null {
  const index = tabs.indexOf(tab);
  if (index < 0 || tabs.length <= 1) {
    return null;
  }

  const wasActive = activeTabId === tab.id;
  const replacementActiveTabId = wasActive
    ? tabs[index === 0 ? 1 : index - 1].id
    : activeTabId;

  tabs.splice(index, 1);

  return {
    activeTabId: replacementActiveTabId,
    removal: {
      tab,
      index,
      wasActive,
      replacementActiveTabId,
    },
  };
}

export function restoreDetachedWindowSourceTab(
  tabs: EditorTab[],
  activeTabId: string,
  removal: DetachedWindowSourceTabRemoval,
): string {
  if (tabs.includes(removal.tab)) {
    return activeTabId;
  }

  const insertIndex = Math.min(removal.index, tabs.length);
  const shouldRestoreActive =
    removal.wasActive && activeTabId === removal.replacementActiveTabId;
  tabs.splice(insertIndex, 0, removal.tab);

  if (shouldRestoreActive || !tabs.some((tab) => tab.id === activeTabId)) {
    return removal.tab.id;
  }

  return activeTabId;
}

export function createTabFromDetachedWindowDocument(
  document: DetachedWindowDocument,
  tabIdState: UntitledTabIdState = defaultUntitledTabIdState,
): EditorTab {
  const tab = createUntitledTab(tabIdState);

  tab.title = document.title || tab.title;
  tab.filePath = document.filePath;
  tab.fileFingerprint = document.fileFingerprint ?? null;
  tab.markdown = document.markdown;
  tab.lastSavedMarkdown = document.lastSavedMarkdown;
  tab.dirty = document.dirty;
  tab.needsSavedMarkdownComparison = false;
  tab.saveTargetDetached = document.saveTargetDetached;
  tab.contentVersion = document.markdown.length > 0 ? 1 : 0;
  tab.updatedAt = new Date();

  return tab;
}

export function updateTabMarkdown(
  tab: EditorTab,
  markdown: string,
  options: UpdateTabMarkdownOptions = {},
): void {
  const previousMarkdown = tab.markdown;
  const isKnownContentChange = Boolean(options.isKnownContentChange);
  const knownChangedIndex = options.knownChangedIndex ?? null;
  const deferSavedMarkdownComparison = Boolean(options.deferSavedMarkdownComparison);
  const saveTargetDetached = tab.filePath === null && tab.saveTargetDetached;
  const isBlankEquivalentToSaved =
    !isKnownContentChange &&
    tab.filePath === null &&
    !saveTargetDetached &&
    getLastSavedMarkdownIsBlank(tab) &&
    isBlankMarkdown(markdown);
  const nextMarkdown =
    isBlankEquivalentToSaved ? tab.lastSavedMarkdown : markdown;
  const dirtyState =
    saveTargetDetached || isBlankEquivalentToSaved
      ? { isDirty: false, needsSavedMarkdownComparison: false }
      : getMarkdownDirtyStateFromSaved(
          markdown,
          tab.lastSavedMarkdown,
          isKnownContentChange,
          knownChangedIndex,
          deferSavedMarkdownComparison,
        );

  tab.markdown = nextMarkdown;
  tab.dirty = saveTargetDetached || dirtyState.isDirty;
  tab.needsSavedMarkdownComparison =
    !saveTargetDetached && !isBlankEquivalentToSaved && dirtyState.needsSavedMarkdownComparison;
  tab.updatedAt = new Date();

  if (
    isStoredMarkdownChanged(
      previousMarkdown,
      nextMarkdown,
      isBlankEquivalentToSaved,
      isKnownContentChange,
    )
  ) {
    bumpTabContentVersion(tab);
  }
}

export function updateTabMarkdownById(
  tabs: EditorTab[],
  tabId: string,
  markdown: string,
  options: UpdateTabMarkdownOptions = {},
): EditorTab | null {
  const tab = tabs.find((candidate) => candidate.id === tabId);

  if (!tab) {
    return null;
  }

  updateTabMarkdown(tab, markdown, options);
  return tab;
}

export function applyEditorMarkdownBaseline(tab: EditorTab, markdown: string): void {
  const previousMarkdown = tab.markdown;
  const isBlankEquivalentToSaved =
    tab.filePath === null &&
    !tab.saveTargetDetached &&
    getLastSavedMarkdownIsBlank(tab) &&
    isBlankMarkdown(markdown);
  const nextMarkdown = isBlankEquivalentToSaved ? tab.lastSavedMarkdown : markdown;

  tab.markdown = nextMarkdown;
  tab.updatedAt = new Date();

  const dirtyState =
    isBlankEquivalentToSaved
      ? { isDirty: false, needsSavedMarkdownComparison: false }
      : getMarkdownDirtyStateFromSaved(
          nextMarkdown,
          tab.lastSavedMarkdown,
          false,
          null,
          false,
        );

  tab.dirty = tab.saveTargetDetached || dirtyState.isDirty;
  tab.needsSavedMarkdownComparison =
    !tab.saveTargetDetached && !isBlankEquivalentToSaved && dirtyState.needsSavedMarkdownComparison;

  if (previousMarkdown !== nextMarkdown) {
    bumpTabContentVersion(tab);
  }
}

export function findTabByFilePath(
  tabs: EditorTab[],
  filePath: string,
  excludedTabId: string | null = null,
): EditorTab | null {
  const normalizedFilePath = normalizeFilePathForComparison(filePath);

  return (
    tabs.find((tab) => {
      return (
        tab.id !== excludedTabId &&
        tab.filePath !== null &&
        normalizeFilePathForComparison(tab.filePath) === normalizedFilePath
      );
    }) ?? null
  );
}

export function applyOpenedMarkdownDocument(
  tabs: EditorTab[],
  activeTabId: string,
  file: OpenedMarkdownDocument,
  existingTab: EditorTab | null | undefined = undefined,
): OpenedMarkdownDocumentResult {
  const matchingExistingTab = existingTab ?? findTabByFilePath(tabs, file.path);

  if (matchingExistingTab) {
    return {
      activeTabId: matchingExistingTab.id,
      tab: matchingExistingTab,
      reusedExistingTab: true,
    };
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  if (!activeTab) {
    throw new Error("Active tab was not found.");
  }

  const tab = isPristineUntitledTab(activeTab) ? activeTab : createUntitledTab();

  if (tab !== activeTab) {
    tabs.push(tab);
  }

  const previousMarkdown = tab.markdown;

  tab.title = file.title;
  tab.filePath = file.path;
  tab.fileFingerprint = file.fileFingerprint ?? null;
  tab.markdown = file.content;
  tab.lastSavedMarkdown = tab.markdown;
  tab.needsSavedMarkdownComparison = false;
  tab.saveTargetDetached = false;
  tab.dirty = false;
  tab.updatedAt = new Date();

  if (tab.markdown !== previousMarkdown) {
    bumpTabContentVersion(tab);
  }

  return {
    activeTabId: tab.id,
    tab,
    reusedExistingTab: false,
  };
}

export function replaceTabWithOpenedMarkdownDocument(
  tab: EditorTab,
  file: OpenedMarkdownDocument,
): void {
  const previousMarkdown = tab.markdown;

  tab.title = file.title;
  tab.filePath = file.path;
  tab.fileFingerprint = file.fileFingerprint ?? null;
  tab.markdown = file.content;
  tab.lastSavedMarkdown = tab.markdown;
  tab.needsSavedMarkdownComparison = false;
  tab.saveTargetDetached = false;
  tab.dirty = false;
  tab.updatedAt = new Date();

  if (tab.markdown !== previousMarkdown) {
    bumpTabContentVersion(tab);
  }
}

export function applySavedMarkdownDocument(
  tab: EditorTab,
  savedFile: SavedMarkdownDocument,
  savedMarkdown: string,
): void {
  const savedBaseline = savedMarkdown === tab.markdown ? tab.markdown : savedMarkdown;

  tab.title = savedFile.title;
  tab.filePath = savedFile.path;
  tab.fileFingerprint = savedFile.fileFingerprint ?? null;
  tab.lastSavedMarkdown = savedBaseline;
  tab.needsSavedMarkdownComparison = false;
  tab.saveTargetDetached = false;
  tab.dirty = isMarkdownDirtyFromSaved(tab.markdown, savedBaseline, false);
  tab.updatedAt = new Date();
}

export function hasPendingSavedMarkdownComparison(tab: EditorTab): boolean {
  return Boolean(tab.needsSavedMarkdownComparison);
}

export function canCompletePendingSavedMarkdownComparisonSynchronously(
  tab: EditorTab,
): boolean {
  return (
    hasPendingSavedMarkdownComparison(tab) &&
    (tab.markdown.length !== tab.lastSavedMarkdown.length ||
      tab.markdown.length < LARGE_MARKDOWN_SAVED_COMPARISON_CHARACTER_LIMIT)
  );
}

export function resolvePendingSavedMarkdownComparison(
  tab: EditorTab,
  matchesSavedMarkdown: boolean,
): boolean {
  if (!hasPendingSavedMarkdownComparison(tab)) {
    return false;
  }

  const previousDirty = tab.dirty;

  tab.needsSavedMarkdownComparison = false;
  tab.dirty = tab.saveTargetDetached || !matchesSavedMarkdown;

  return tab.dirty !== previousDirty;
}

export function completePendingSavedMarkdownComparison(tab: EditorTab): boolean {
  if (!hasPendingSavedMarkdownComparison(tab)) {
    return false;
  }

  return resolvePendingSavedMarkdownComparison(tab, tab.markdown === tab.lastSavedMarkdown);
}

export function applySavedMarkdownDocumentUniquely(
  tabs: EditorTab[],
  activeTabId: string,
  tab: EditorTab,
  savedFile: SavedMarkdownDocument,
  savedMarkdown: string,
  options: SaveMarkdownDocumentUniquelyOptions = {},
): SavedMarkdownDocumentResult {
  const existingTab = findTabByFilePath(tabs, savedFile.path, tab.id);
  let nextActiveTabId = activeTabId;

  if (existingTab) {
    if (existingTab.dirty || options.protectedTabIds?.has(existingTab.id)) {
      existingTab.filePath = null;
      existingTab.fileFingerprint = null;
      existingTab.saveTargetDetached = true;
      existingTab.dirty = true;
      existingTab.updatedAt = new Date();
    } else {
      const existingTabIndex = tabs.findIndex((candidate) => candidate.id === existingTab.id);
      if (existingTabIndex >= 0) {
        tabs.splice(existingTabIndex, 1);
      }

      if (nextActiveTabId === existingTab.id) {
        nextActiveTabId = tab.id;
      }
    }
  }

  applySavedMarkdownDocument(tab, savedFile, savedMarkdown);

  return {
    activeTabId: nextActiveTabId,
    tab,
  };
}

export function getDocumentStats(markdown: string): DocumentStats {
  const scanState = createDocumentStatsScan(markdown);
  const stats = advanceDocumentStatsScan(scanState, Math.max(1, markdown.length));

  if (stats === null) {
    return completeDocumentStatsScan(scanState);
  }

  return stats;
}

export function getDocumentStatsAfterTrailingMarkdownChange(
  previousMarkdown: string,
  markdown: string,
  previousStats: DocumentStats,
): DocumentStats | null {
  if (previousStats.characters !== previousMarkdown.length) {
    return null;
  }

  if (
    hasStableTrailingChangePrefix(previousMarkdown, markdown) &&
    markdown.startsWith(previousMarkdown)
  ) {
    return appendDocumentStats(previousMarkdown, markdown, previousStats);
  }

  if (
    hasStableTrailingChangePrefix(markdown, previousMarkdown) &&
    previousMarkdown.startsWith(markdown)
  ) {
    return truncateDocumentStats(previousMarkdown, markdown, previousStats);
  }

  return null;
}

export function createDocumentStatsScan(markdown: string): DocumentStatsScanState {
  return {
    markdown,
    index: 0,
    lines: 1,
    words: 0,
    isInWord: false,
  };
}

export function advanceDocumentStatsScan(
  scanState: DocumentStatsScanState,
  maxCharacters: number,
): DocumentStats | null {
  const markdown = scanState.markdown;
  const chunkSize = Math.max(1, Math.floor(maxCharacters));
  const chunkEndIndex = Math.min(markdown.length, scanState.index + chunkSize);

  while (scanState.index < chunkEndIndex) {
    const characterCode = markdown.charCodeAt(scanState.index);
    const isLineBreak =
      characterCode === CARRIAGE_RETURN_CHARACTER_CODE ||
      characterCode === LINE_FEED_CHARACTER_CODE;

    if (isLineBreak) {
      scanState.lines += 1;

      if (
        characterCode === CARRIAGE_RETURN_CHARACTER_CODE &&
        markdown.charCodeAt(scanState.index + 1) === LINE_FEED_CHARACTER_CODE
      ) {
        scanState.index += 1;
      }
    }

    if (isMarkdownWhitespaceCharacterCode(characterCode)) {
      scanState.isInWord = false;
      scanState.index += 1;
      continue;
    }

    if (!scanState.isInWord) {
      scanState.words += 1;
      scanState.isInWord = true;
    }

    scanState.index += 1;
  }

  if (scanState.index < markdown.length) {
    return null;
  }

  return completeDocumentStatsScan(scanState);
}

function completeDocumentStatsScan(scanState: DocumentStatsScanState): DocumentStats {
  return {
    lines: scanState.lines,
    words: scanState.words,
    characters: scanState.markdown.length,
  };
}

function hasStableTrailingChangePrefix(prefix: string, markdown: string): boolean {
  if (prefix.length > markdown.length) {
    return false;
  }

  const sampleStartIndex = Math.max(
    0,
    prefix.length - TRAILING_MARKDOWN_CHANGE_PREFIX_SAMPLE_SIZE,
  );

  for (let index = sampleStartIndex; index < prefix.length; index += 1) {
    if (prefix.charCodeAt(index) !== markdown.charCodeAt(index)) {
      return false;
    }
  }

  return true;
}

function appendDocumentStats(
  previousMarkdown: string,
  markdown: string,
  previousStats: DocumentStats,
): DocumentStats {
  const appendedMarkdown = markdown.slice(previousMarkdown.length);
  const boundaryLineBreakAdjustment =
    previousMarkdown.endsWith("\r") && appendedMarkdown.startsWith("\n") ? -1 : 0;
  const initialIsInWord = isMarkdownTrailingCharacterInWord(previousMarkdown);

  return {
    lines:
      previousStats.lines +
      countMarkdownLineBreaks(appendedMarkdown) +
      boundaryLineBreakAdjustment,
    words:
      previousStats.words +
      countMarkdownWordsStartedInSegment(appendedMarkdown, initialIsInWord),
    characters: markdown.length,
  };
}

function truncateDocumentStats(
  previousMarkdown: string,
  markdown: string,
  previousStats: DocumentStats,
): DocumentStats {
  const removedMarkdown = previousMarkdown.slice(markdown.length);
  const boundaryLineBreakAdjustment =
    markdown.endsWith("\r") && removedMarkdown.startsWith("\n") ? 1 : 0;
  const initialIsInWord = isMarkdownTrailingCharacterInWord(markdown);

  return {
    lines:
      previousStats.lines -
      countMarkdownLineBreaks(removedMarkdown) +
      boundaryLineBreakAdjustment,
    words:
      previousStats.words -
      countMarkdownWordsStartedInSegment(removedMarkdown, initialIsInWord),
    characters: markdown.length,
  };
}

function countMarkdownLineBreaks(markdown: string): number {
  let lines = 0;

  for (let index = 0; index < markdown.length; index += 1) {
    const characterCode = markdown.charCodeAt(index);

    if (characterCode === CARRIAGE_RETURN_CHARACTER_CODE) {
      lines += 1;

      if (markdown.charCodeAt(index + 1) === LINE_FEED_CHARACTER_CODE) {
        index += 1;
      }

      continue;
    }

    if (characterCode === LINE_FEED_CHARACTER_CODE) {
      lines += 1;
    }
  }

  return lines;
}

function countMarkdownWordsStartedInSegment(
  markdown: string,
  initialIsInWord: boolean,
): number {
  let words = 0;
  let isInWord = initialIsInWord;

  for (let index = 0; index < markdown.length; index += 1) {
    if (isMarkdownWhitespaceCharacterCode(markdown.charCodeAt(index))) {
      isInWord = false;
      continue;
    }

    if (!isInWord) {
      words += 1;
      isInWord = true;
    }
  }

  return words;
}

function isMarkdownTrailingCharacterInWord(markdown: string): boolean {
  return (
    markdown.length > 0 &&
    !isMarkdownWhitespaceCharacterCode(markdown.charCodeAt(markdown.length - 1))
  );
}

function removeWindowsVerbatimPrefix(path: string): string {
  const upperPath = path.toUpperCase();

  if (upperPath.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${path.slice("\\\\?\\UNC\\".length)}`;
  }

  if (upperPath.startsWith("\\\\?\\")) {
    return path.slice("\\\\?\\".length);
  }

  return path;
}

function splitWindowsPathRoot(path: string): {
  root: string;
  rest: string;
  preventsAboveRoot: boolean;
} {
  if (path.startsWith("\\\\")) {
    const parts = path.slice(2).split("\\");
    const [server, share] = parts;

    if (server && share) {
      return {
        root: `\\\\${server}\\${share}`,
        rest: parts.slice(2).join("\\"),
        preventsAboveRoot: true,
      };
    }

    return {
      root: "\\\\",
      rest: parts.join("\\"),
      preventsAboveRoot: true,
    };
  }

  if (/^[a-z]:\\/iu.test(path)) {
    return {
      root: path.slice(0, 3),
      rest: path.slice(3),
      preventsAboveRoot: true,
    };
  }

  if (/^[a-z]:/iu.test(path)) {
    return {
      root: path.slice(0, 2),
      rest: path.slice(2),
      preventsAboveRoot: false,
    };
  }

  if (path.startsWith("\\")) {
    return {
      root: "\\",
      rest: path.slice(1),
      preventsAboveRoot: true,
    };
  }

  return {
    root: "",
    rest: path,
    preventsAboveRoot: false,
  };
}

function normalizePathSegments(segments: string[], preventsAboveRoot: boolean): string[] {
  const normalizedSegments: string[] = [];

  for (const segment of segments) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      const previousSegment = normalizedSegments[normalizedSegments.length - 1];

      if (previousSegment && previousSegment !== "..") {
        normalizedSegments.pop();
        continue;
      }

      if (preventsAboveRoot) {
        continue;
      }
    }

    normalizedSegments.push(segment);
  }

  return normalizedSegments;
}

function isMarkdownDirtyFromSaved(
  markdown: string,
  lastSavedMarkdown: string,
  isKnownContentChange: boolean,
  knownChangedIndex: number | null = null,
): boolean {
  return getMarkdownDirtyStateFromSaved(
    markdown,
    lastSavedMarkdown,
    isKnownContentChange,
    knownChangedIndex,
    false,
  ).isDirty;
}

function getMarkdownDirtyStateFromSaved(
  markdown: string,
  lastSavedMarkdown: string,
  isKnownContentChange: boolean,
  knownChangedIndex: number | null = null,
  deferSavedMarkdownComparison = false,
): { isDirty: boolean; needsSavedMarkdownComparison: boolean } {
  if (markdown.length !== lastSavedMarkdown.length) {
    return { isDirty: true, needsSavedMarkdownComparison: false };
  }

  if (
    isKnownContentChange &&
    hasKnownMarkdownDifferenceAtIndex(markdown, lastSavedMarkdown, knownChangedIndex)
  ) {
    return { isDirty: true, needsSavedMarkdownComparison: false };
  }

  if (
    shouldDeferSavedMarkdownComparison(
      markdown,
      isKnownContentChange,
      knownChangedIndex,
      deferSavedMarkdownComparison,
    )
  ) {
    return { isDirty: true, needsSavedMarkdownComparison: true };
  }

  if (markdown === lastSavedMarkdown) {
    return { isDirty: false, needsSavedMarkdownComparison: false };
  }

  if (isKnownContentChange) {
    // Editor updates already prove content changed from the previous value.
    // Once the saved baseline equality check above fails, same-length edits are dirty.
    return { isDirty: true, needsSavedMarkdownComparison: false };
  }

  return { isDirty: markdown !== lastSavedMarkdown, needsSavedMarkdownComparison: false };
}

function shouldDeferSavedMarkdownComparison(
  markdown: string,
  isKnownContentChange: boolean,
  knownChangedIndex: number | null,
  deferSavedMarkdownComparison: boolean,
): boolean {
  return (
    deferSavedMarkdownComparison &&
    isKnownContentChange &&
    knownChangedIndex === null &&
    markdown.length >= LARGE_MARKDOWN_SAVED_COMPARISON_CHARACTER_LIMIT
  );
}

function hasKnownMarkdownDifferenceAtIndex(
  markdown: string,
  lastSavedMarkdown: string,
  knownChangedIndex: number | null,
): boolean {
  return (
    knownChangedIndex !== null &&
    knownChangedIndex >= 0 &&
    knownChangedIndex < markdown.length &&
    knownChangedIndex < lastSavedMarkdown.length &&
    markdown.charCodeAt(knownChangedIndex) !== lastSavedMarkdown.charCodeAt(knownChangedIndex)
  );
}

function isStoredMarkdownChanged(
  previousMarkdown: string,
  nextMarkdown: string,
  isBlankEquivalentToSaved: boolean,
  isKnownContentChange: boolean,
): boolean {
  if (previousMarkdown.length !== nextMarkdown.length) {
    return true;
  }

  if (isKnownContentChange && !isBlankEquivalentToSaved) {
    return true;
  }

  return nextMarkdown !== previousMarkdown;
}

function getLastSavedMarkdownIsBlank(tab: EditorTab): boolean {
  return isBlankMarkdown(tab.lastSavedMarkdown);
}

function bumpTabContentVersion(tab: EditorTab): void {
  tab.contentVersion = getTabContentVersion(tab) + 1;
}

function isBlankMarkdown(markdown: string): boolean {
  return !MARKDOWN_NON_WHITESPACE_PATTERN.test(markdown);
}

const LINE_FEED_CHARACTER_CODE = 0x0a;
const CARRIAGE_RETURN_CHARACTER_CODE = 0x0d;

function isMarkdownWhitespaceCharacterCode(characterCode: number): boolean {
  return (
    characterCode === 0x20 ||
    (characterCode >= 0x09 && characterCode <= 0x0d) ||
    characterCode === 0xa0 ||
    characterCode === 0x1680 ||
    (characterCode >= 0x2000 && characterCode <= 0x200a) ||
    characterCode === 0x2028 ||
    characterCode === 0x2029 ||
    characterCode === 0x202f ||
    characterCode === 0x205f ||
    characterCode === 0x3000 ||
    characterCode === 0xfeff
  );
}
