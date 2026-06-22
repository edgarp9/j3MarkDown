import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  EditorContextMenu,
  type EditorContextMenuEntry,
} from "../components/EditorContextMenu";
import {
  MarkdownEditor as createMarkdownEditor,
  type MarkdownEditorChange,
  type MarkdownEditorContextCommand,
  type MarkdownEditorHandle,
  type MarkdownEditorProps,
  type MarkdownEditorScrollPosition,
} from "../components/MarkdownEditor";
import { TabBar } from "../components/TabBar";
import {
  defaultMarkdownEditorThemeId,
  getMarkdownEditorTheme,
  type MarkdownEditorThemeId,
} from "../components/milkdown-themes";
import {
  createAppChrome,
  createAppShell,
  createAppStatusBar,
  type AppChromeOptions,
  type ToolbarAction,
} from "./app-shell";
import { getAboutInfo, openAboutLink } from "./app-info";
import {
  loadEditorThemeSetting,
  loadUiLanguageSetting,
  saveEditorThemeSetting,
  saveUiLanguageSetting,
} from "./app-settings";
import {
  advanceDocumentStatsScan,
  applyEditorMarkdownBaseline,
  applyOpenedMarkdownDocument,
  applySavedMarkdownDocumentUniquely,
  canCompletePendingSavedMarkdownComparisonSynchronously,
  completePendingSavedMarkdownComparison,
  createDetachedWindowDocumentFromTab,
  createDetachedWindowDocumentFromTransfer,
  createDetachedWindowDocumentTransfer,
  createDetachedWindowDocumentWindowRequest,
  createDocumentStatsScan,
  createFilePathTabIndex,
  createTabFromDetachedWindowDocument,
  createUntitledTab,
  getDocumentStats,
  getDocumentStatsAfterTrailingMarkdownChange,
  getTabContentVersion,
  getTabDisplayTitle,
  getTabTooltipText,
  hasPendingSavedMarkdownComparison,
  normalizeFilePathForComparison,
  removeDetachedWindowSourceTab,
  replaceTabWithOpenedMarkdownDocument,
  resolvePendingSavedMarkdownComparison,
  restoreDetachedWindowSourceTab,
  type DocumentStats,
  type DocumentStatsScanState,
  type DetachedWindowDocument,
  type DetachedWindowSourceTabRemoval,
  type DetachedWindowDocumentTransfer,
  type EditorTab,
  type OpenedMarkdownDocumentResult,
  updateTabMarkdownById,
} from "./document-state";
import { listenForDroppedFiles } from "./file-drop";
import {
  completeDetachedWindowBroadcastHandoff,
  getLaunchPaths,
  openMarkdownFile,
  openMarkdownDocumentInNewWindow,
  openMarkdownFileAtPath,
  openMarkdownFilesAtPaths,
  saveMarkdownFile,
  selectMarkdownSavePath,
  takeDetachedWindowDocument,
  type OpenedMarkdownFileAtPathResult,
  type OpenedMarkdownFile,
  type MarkdownFileSaveConflict,
  type SavedMarkdownFile,
} from "./file-commands";
import {
  defaultUiLanguage,
  getAppCopy,
  type AppCopy,
  type UiLanguage,
} from "./i18n";
import { getAboutText } from "./about-text";
import { DebouncedLatestSave, PerKeySaveQueue } from "./save-queue";
import {
  markStartupPoint,
  measureStartupBetween,
  measureStartupFromNavigationStart,
  measureStartupWork,
  reportStartupProfile,
  startStartupSpan,
} from "./startup-profile";
import {
  startCurrentWindowCloseGuard,
  type WindowCloseGuard,
} from "./window-close-guard";

const ACTIVE_DOCUMENT_CHROME_UPDATE_DELAY_MS = 250;
const ACTIVE_DOCUMENT_STATS_UPDATE_DELAY_MS = 800;
const LARGE_DOCUMENT_STATS_UPDATE_DELAY_MS = 2500;
const LARGE_DOCUMENT_STATS_MIN_RESCAN_INTERVAL_MS = 5000;

const ACTIVE_DOCUMENT_STATS_IDLE_TIMEOUT_MS = 2000;
const SYNCHRONOUS_DOCUMENT_STATS_CHARACTER_LIMIT = 32 * 1024;
const LARGE_DOCUMENT_STATS_CHARACTER_LIMIT = 128 * 1024;
const VERY_LARGE_DOCUMENT_STATS_CHARACTER_LIMIT = 1024 * 1024;
const VERY_LARGE_DOCUMENT_STATS_UPDATE_DELAY_MS = 5000;
const VERY_LARGE_DOCUMENT_STATS_MIN_RESCAN_INTERVAL_MS = 15000;
const DOCUMENT_STATS_SCAN_CHUNK_SIZE = 32 * 1024;
const SAVED_MARKDOWN_COMPARISON_SCAN_CHUNK_SIZE = 32 * 1024;
const SAVED_MARKDOWN_COMPARISON_IDLE_TIMEOUT_MS = 1000;
const MAX_CACHED_MARKDOWN_EDITORS = 3;
const MARKDOWN_FILE_SAVE_QUEUE_KEY = "markdown-file-save";
const APP_SETTING_SAVE_DELAY_MS = 300;
const DETACHED_DOCUMENT_QUERY_KEY = "detachedDocumentToken";
const DETACHED_WINDOW_HANDOFF_CHANNEL_NAME = "j3markdown-detached-window-handoff";
const DETACHED_WINDOW_HANDOFF_CONSUMPTION_TIMEOUT_MS = 30_000;
const DETACHED_WINDOW_HANDOFF_REQUEST_TIMEOUT_MS = 1_000;
const TAB_CONTEXT_MENU_OPEN_IN_NEW_WINDOW_ACTION = "open-in-new-window";
const TAB_CONTEXT_MENU_CLOSE_OTHER_TABS_ACTION = "close-other-tabs";
const DETACHED_WINDOW_HANDOFF_REQUEST_MESSAGE = "detached-window-document-request";
const DETACHED_WINDOW_HANDOFF_RESPONSE_MESSAGE = "detached-window-document-response";
const DETACHED_WINDOW_HANDOFF_CONSUMED_MESSAGE = "detached-window-document-consumed";
const MARKDOWN_EDITOR_CONTEXT_COMMANDS: readonly MarkdownEditorContextCommand[] = [
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
  "select-all",
  "bold",
  "italic",
  "inline-code",
] as const;

interface DetachedWindowBroadcastHandoff {
  consumed: Promise<void>;
  dispose: () => void;
}

interface DetachedWindowSourceTransfer {
  readonly removal: DetachedWindowSourceTabRemoval;
  readonly scrollPosition: MarkdownEditorScrollPosition | null;
}

interface DetachedWindowHandoffRequestMessage {
  type: typeof DETACHED_WINDOW_HANDOFF_REQUEST_MESSAGE;
  token: string;
}

interface DetachedWindowHandoffResponseMessage {
  type: typeof DETACHED_WINDOW_HANDOFF_RESPONSE_MESSAGE;
  token: string;
  document: DetachedWindowDocumentTransfer;
}

interface DetachedWindowHandoffConsumedMessage {
  type: typeof DETACHED_WINDOW_HANDOFF_CONSUMED_MESSAGE;
  token: string;
}

type DetachedWindowHandoffMessage =
  | DetachedWindowHandoffRequestMessage
  | DetachedWindowHandoffResponseMessage
  | DetachedWindowHandoffConsumedMessage;
type MarkdownEditorFactory = (props: MarkdownEditorProps) => MarkdownEditorHandle;

export class MarkdownApp {
  private readonly tabs: EditorTab[] = measureStartupWork(
    "initial untitled tab state",
    () => [createUntitledTab()],
  );
  private activeTabId: string = this.tabs[0].id;
  private markdownEditor: MarkdownEditorHandle | null = null;
  private readonly markdownEditors = new Map<string, MarkdownEditorHandle>();
  private readonly markdownEditorFactory: MarkdownEditorFactory = createMarkdownEditor;
  private readonly markdownEditorScrollPositions = new Map<
    string,
    MarkdownEditorScrollPosition
  >();
  private fileDropUnlisten: (() => void) | null = null;
  private windowCloseGuard: WindowCloseGuard | null = null;
  private lifecycleVersion = 0;
  private readonly tabSaveQueue = new PerKeySaveQueue<SaveTabResult>("failed");
  private readonly markdownFileSaveQueue = new PerKeySaveQueue<SaveTabResult>("failed");
  private readonly pendingTabSaves = new Map<string, Promise<SaveTabResult>>();
  private readonly pendingTabCloseRequests = new Set<string>();
  private readonly pendingEditorContentChangeTabIds = new Set<string>();
  private isFileDragOver = false;
  private editorThemeId: MarkdownEditorThemeId = defaultMarkdownEditorThemeId;
  private uiLanguage: UiLanguage = defaultUiLanguage;
  private copy: AppCopy = getAppCopy(defaultUiLanguage);
  private editorThemeSettingVersion = 0;
  private uiLanguageSettingVersion = 0;
  private activeDocumentChromeUpdateTimer: number | null = null;
  private toolbarElement: HTMLElement | null = null;
  private tabBarElement: HTMLElement | null = null;
  private statusBarElement: HTMLElement | null = null;
  private editorContextMenuElement: HTMLElement | null = null;
  private tabContextMenuElement: HTMLElement | null = null;
  private pendingWindowCloseGuardRegistrationError: unknown = null;
  private hasRequestedInitialWindowShow = false;
  private hasCompletedInitialAppStartup = false;
  private hasObservedFirstEditableEditorReady = false;
  private hasReportedFirstEditableStartupProfile = false;
  private readonly activeDocumentStatsCache = new Map<string, ActiveDocumentStatsCache>();
  private activeDocumentStatsUpdateTimer: number | null = null;
  private activeDocumentStatsIdleCallback: number | null = null;
  private activeDocumentStatsRefreshTarget: ActiveDocumentStatsRefreshTarget | null = null;
  private activeDocumentStatsScan: ActiveDocumentStatsScan | null = null;
  private activeDocumentStatsLastCompletedScan: ActiveDocumentStatsCompletedScan | null = null;
  private savedMarkdownComparisonIdleCallback: number | null = null;
  private savedMarkdownComparisonTimer: number | null = null;
  private savedMarkdownComparisonScan: SavedMarkdownComparisonScan | null = null;
  private readonly uiLanguageSettingSave = new DebouncedLatestSave<UiLanguage>(
    APP_SETTING_SAVE_DELAY_MS,
  );
  private readonly editorThemeSettingSave = new DebouncedLatestSave<MarkdownEditorThemeId>(
    APP_SETTING_SAVE_DELAY_MS,
  );
  private readonly handleRootContextMenu = (event: MouseEvent): void => {
    this.handleContextMenuEvent(event);
  };
  private readonly handleWindowPointerDown = (event: PointerEvent): void => {
    this.handleContextMenuPointerDown(event);
  };
  private readonly handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (
      event.key === "Escape" &&
      (this.editorContextMenuElement || this.tabContextMenuElement)
    ) {
      event.preventDefault();
      this.hideContextMenus();
      return;
    }

    if (event.isComposing || event.defaultPrevented || this.hasOpenAppModalDialog()) {
      return;
    }

    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      this.hideContextMenus();
      void this.handleToolbarActionSafely("save");
      return;
    }

    if (key === "w") {
      event.preventDefault();
      this.hideContextMenus();
      this.requestCloseTabSafely(this.activeTabId);
    }
  };
  private readonly handleWindowContextMenuDismiss = (): void => {
    this.hideContextMenus();
  };

  public constructor(private readonly root: HTMLElement) {}

  public mount(): void {
    markStartupPoint("MarkdownApp mount started");
    this.lifecycleVersion += 1;

    this.root.addEventListener("contextmenu", this.handleRootContextMenu);
    window.addEventListener("pointerdown", this.handleWindowPointerDown, true);
    window.addEventListener("keydown", this.handleWindowKeyDown, true);
    window.addEventListener("resize", this.handleWindowContextMenuDismiss);
    window.addEventListener("blur", this.handleWindowContextMenuDismiss);

    const lifecycleVersion = this.lifecycleVersion;
    const windowCloseGuard = this.startWindowCloseListener();
    void this.watchWindowCloseGuardRegistration(lifecycleVersion, windowCloseGuard);
    void this.renderInitialApp(
      lifecycleVersion,
      this.editorThemeSettingVersion,
      this.uiLanguageSettingVersion,
    );
  }

  public destroy(): void {
    this.lifecycleVersion += 1;
    this.flushPendingMarkdownEditorChanges();
    this.flushPendingAppSettingSaves();

    this.root.removeEventListener("contextmenu", this.handleRootContextMenu);
    window.removeEventListener("pointerdown", this.handleWindowPointerDown, true);
    window.removeEventListener("keydown", this.handleWindowKeyDown, true);
    window.removeEventListener("resize", this.handleWindowContextMenuDismiss);
    window.removeEventListener("blur", this.handleWindowContextMenuDismiss);

    this.hideContextMenus();
    this.cancelActiveDocumentChromeUpdate();
    this.cancelActiveDocumentStatsRefresh();
    this.cancelSavedMarkdownComparison();
    this.fileDropUnlisten?.();
    this.fileDropUnlisten = null;
    this.windowCloseGuard?.stop();
    this.windowCloseGuard = null;
    this.pendingWindowCloseGuardRegistrationError = null;
    this.destroyMarkdownEditors();
    this.markdownEditor = null;
    this.clearAllPendingEditorContentChanges();
    this.toolbarElement = null;
    this.tabBarElement = null;
    this.statusBarElement = null;
    this.activeDocumentStatsCache.clear();
    this.markdownEditorScrollPositions.clear();
  }

  private hasOpenAppModalDialog(): boolean {
    return this.root.querySelector("dialog[open]") !== null;
  }

  private render(): void {
    const isInitialRender = !this.toolbarElement;
    const finishInitialRender = isInitialRender
      ? startStartupSpan("initial app shell render")
      : null;

    this.hideContextMenus();
    this.cancelActiveDocumentChromeUpdate();
    this.cancelActiveDocumentStatsRefresh();

    const activeTab = this.getActiveTab();
    const editorElement = this.getOrCreateMarkdownEditorElement(activeTab);
    this.pruneMarkdownEditorCache(activeTab.id);
    this.pruneActiveDocumentStatsCache(activeTab.id);

    const shell = createAppShell({
      ...this.getAppChromeOptions(activeTab),
      editorElement,
    });

    this.toolbarElement = shell.toolbarElement;
    this.tabBarElement = shell.tabBarElement;
    this.statusBarElement = shell.statusBarElement;

    this.root.replaceChildren(shell.shellElement);
    this.restoreMarkdownEditorScrollPosition(activeTab.id);
    this.showWindowAfterInitialRender();

    finishInitialRender?.();
    if (isInitialRender) {
      markStartupPoint("initial app shell rendered");
      measureStartupBetween(
        "MarkdownApp mount start to initial shell render",
        "MarkdownApp mount started",
        "initial app shell rendered",
      );
    }
  }

  private showWindowAfterInitialRender(): void {
    if (this.hasRequestedInitialWindowShow) {
      return;
    }

    this.hasRequestedInitialWindowShow = true;
    const finishInitialWindowShow = startStartupSpan("initial window show IPC");
    const markInitialWindowShown = (): void => {
      markStartupPoint("initial window shown");
      measureStartupBetween(
        "frontend JS start to initial window shown",
        "frontend JS start",
        "initial window shown",
      );
      measureStartupFromNavigationStart(
        "WebView navigation start to initial window shown",
        "initial window shown",
      );
      finishInitialWindowShow();
    };

    void getCurrentWindow()
      .show()
      .then(markInitialWindowShown)
      .catch((error: unknown) => {
        finishInitialWindowShow();
        console.warn("App window could not be shown after initial render.", error);
      });
  }

  private async handleToolbarAction(action: ToolbarAction): Promise<void> {
    if (action === "new") {
      const tab = createUntitledTab();
      this.tabs.push(tab);
      this.activateTab(tab.id);
      this.renderTabChange();
      return;
    }

    if (action === "open") {
      await this.openDocument();
      return;
    }

    if (action === "save") {
      await this.saveActiveDocument();
      return;
    }

    if (action === "save-as") {
      await this.saveActiveDocumentAs();
      return;
    }

    if (action === "about") {
      await this.showAboutDialog();
      return;
    }
  }

  private async handleToolbarActionSafely(action: ToolbarAction): Promise<void> {
    try {
      await this.handleToolbarAction(action);
    } catch (error) {
      this.showErrorDialog(
        getToolbarActionErrorTitle(action, this.copy),
        this.getErrorMessage(error),
      );
    }
  }

  private async openDocument(): Promise<void> {
    try {
      const file = await openMarkdownFile();
      if (!file) {
        return;
      }

      this.applyOpenedFile(file);
      this.render();
    } catch (error) {
      this.showErrorDialog(this.copy.errors.openFailed, this.getErrorMessage(error));
    }
  }

  private startFileDropListener(): void {
    const lifecycleVersion = this.lifecycleVersion;
    const finishFileDropListenerRegistration = startStartupSpan(
      "file drop listener registration",
    );

    void listenForDroppedFiles({
      onDropPaths: (paths) => {
        if (this.lifecycleVersion !== lifecycleVersion) {
          return;
        }

        return this.openDroppedDocuments(paths);
      },
      onDragStateChange: (isDragging) => {
        if (this.lifecycleVersion !== lifecycleVersion) {
          return;
        }

        this.setFileDragState(isDragging);
      },
      onUnhandledError: (error) => {
        if (this.lifecycleVersion !== lifecycleVersion) {
          return;
        }

        this.showErrorDialog(this.copy.errors.openFailed, this.getErrorMessage(error));
      },
    })
      .then((unlisten) => {
        if (this.lifecycleVersion !== lifecycleVersion) {
          unlisten();
          return;
        }

        this.fileDropUnlisten = unlisten;
      })
      .catch((error: unknown) => {
        if (this.lifecycleVersion !== lifecycleVersion) {
          return;
        }

        console.warn("File drag-and-drop is unavailable.", error);
        this.showErrorDialog(this.copy.errors.dropError, this.getErrorMessage(error));
      })
      .finally(finishFileDropListenerRegistration);
  }

  private async watchWindowCloseGuardRegistration(
    lifecycleVersion: number,
    windowCloseGuard: WindowCloseGuard,
  ): Promise<void> {
    const finishWindowCloseGuardRegistration = startStartupSpan(
      "window close guard registration",
    );
    try {
      await windowCloseGuard.ready;
    } catch (error) {
      if (this.lifecycleVersion !== lifecycleVersion) {
        return;
      }

      this.handleWindowCloseGuardRegistrationError(error);
    } finally {
      finishWindowCloseGuardRegistration();
    }

    if (
      this.lifecycleVersion !== lifecycleVersion ||
      this.windowCloseGuard !== windowCloseGuard
    ) {
      return;
    }
    this.showPendingWindowCloseGuardRegistrationError();
  }

  private startWindowCloseListener(): WindowCloseGuard {
    const lifecycleVersion = this.lifecycleVersion;

    this.windowCloseGuard?.stop();
    this.pendingWindowCloseGuardRegistrationError = null;
    const windowCloseGuard = startCurrentWindowCloseGuard({
      flushPendingChanges: () => {
        this.flushPendingMarkdownEditorChanges({ requireSerializedMarkdown: false });
        return this.flushPendingAppSettingSaves();
      },
      hasDirtyTabs: () => this.hasDirtyTabs(),
      resolveCloseRequest: () => this.resolveWindowCloseRequest(),
      onRegistrationError: (error) => {
        if (this.lifecycleVersion !== lifecycleVersion) {
          return;
        }

        this.handleWindowCloseGuardRegistrationError(error);
      },
      onCloseError: (error) => {
        if (this.lifecycleVersion !== lifecycleVersion) {
          return;
        }

        this.showErrorDialog(this.copy.errors.closeFailed, this.getErrorMessage(error));
      },
    });

    this.windowCloseGuard = windowCloseGuard;
    return windowCloseGuard;
  }

  private handleWindowCloseGuardRegistrationError(error: unknown): void {
    if (!this.toolbarElement) {
      this.pendingWindowCloseGuardRegistrationError = error;
      return;
    }

    this.showWindowCloseGuardUnavailableDialog(error);
  }

  private showPendingWindowCloseGuardRegistrationError(): void {
    const error = this.pendingWindowCloseGuardRegistrationError;

    if (error === null) {
      return;
    }

    this.pendingWindowCloseGuardRegistrationError = null;
    this.showWindowCloseGuardUnavailableDialog(error);
  }

  private showWindowCloseGuardUnavailableDialog(error: unknown): void {
    this.showErrorDialog(
      this.copy.errors.closeGuardTitle,
      this.copy.errors.closeGuardMessage(this.getErrorMessage(error)),
    );
  }

  private setFileDragState(isDragging: boolean): void {
    if (this.isFileDragOver === isDragging) {
      return;
    }

    this.isFileDragOver = isDragging;
    this.root.classList.toggle("is-file-drag-over", isDragging);
  }

  private handleContextMenuEvent(event: MouseEvent): void {
    event.preventDefault();

    const target = event.target;
    if (!(target instanceof Element)) {
      this.hideContextMenus();
      return;
    }

    if (target.closest(".editor-context-menu")) {
      return;
    }

    const editorMount = target.closest<HTMLElement>(".markdown-editor");
    if (!editorMount || !this.markdownEditor?.element.contains(editorMount)) {
      this.hideContextMenus();
      return;
    }

    const contextState = this.markdownEditor.captureContextSelection(
      event.clientX,
      event.clientY,
    );
    this.showEditorContextMenu(event.clientX, event.clientY, contextState.hasSelection);
  }

  private handleContextMenuPointerDown(event: PointerEvent): void {
    const menus = [this.editorContextMenuElement, this.tabContextMenuElement].filter(
      (menu): menu is HTMLElement => menu !== null,
    );

    if (menus.length === 0) {
      return;
    }

    const target = event.target;
    if (target instanceof Node && menus.some((menu) => menu.contains(target))) {
      return;
    }

    this.hideContextMenus();
  }

  private showEditorContextMenu(x: number, y: number, hasSelection: boolean): void {
    this.hideContextMenus();

    const menu = EditorContextMenu({
      items: createEditorContextMenuItems(hasSelection, this.copy.editorContextMenu),
      x,
      y,
      ariaLabel: this.copy.editorContextMenu.ariaLabel,
      onAction: (action) => this.handleEditorContextMenuAction(action),
      onDismiss: () => this.hideEditorContextMenu(),
    });

    this.editorContextMenuElement = menu.element;
    menu.element.dataset.editorThemeMode = getMarkdownEditorTheme(this.editorThemeId).isDark
      ? "dark"
      : "light";
    this.root.append(menu.element);
    menu.positionInViewport();
    menu.focusFirstItem();
  }

  private showTabContextMenu(tabId: string, x: number, y: number): void {
    const tab = this.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) {
      this.hideContextMenus();
      return;
    }

    this.hideContextMenus();

    const menu = EditorContextMenu({
      items: [
        {
          type: "item",
          action: TAB_CONTEXT_MENU_OPEN_IN_NEW_WINDOW_ACTION,
          label: this.copy.tabBar.openInNewWindow,
          disabled: this.tabs.length <= 1,
        },
        { type: "separator" },
        {
          type: "item",
          action: TAB_CONTEXT_MENU_CLOSE_OTHER_TABS_ACTION,
          label: this.copy.tabBar.closeOtherTabs,
          disabled: this.tabs.length <= 1,
        },
      ],
      x,
      y,
      ariaLabel: this.copy.tabBar.contextMenuAriaLabel,
      className: "tab-context-menu",
      onAction: (action) => this.handleTabContextMenuAction(tab.id, action),
      onDismiss: () => this.hideTabContextMenu(),
    });

    this.tabContextMenuElement = menu.element;
    menu.element.dataset.editorThemeMode = getMarkdownEditorTheme(this.editorThemeId).isDark
      ? "dark"
      : "light";
    this.root.append(menu.element);
    menu.positionInViewport();
    menu.focusFirstItem();
  }

  private hideContextMenus(): void {
    this.hideEditorContextMenu();
    this.hideTabContextMenu();
  }

  private hideEditorContextMenu(): void {
    this.editorContextMenuElement?.remove();
    this.editorContextMenuElement = null;
  }

  private hideTabContextMenu(): void {
    this.tabContextMenuElement?.remove();
    this.tabContextMenuElement = null;
  }

  private async handleEditorContextMenuAction(action: string): Promise<void> {
    if (!isMarkdownEditorContextCommand(action)) {
      return;
    }

    try {
      await this.markdownEditor?.runContextCommand(action);
    } catch (error) {
      this.showErrorDialog(this.copy.errors.editFailed, this.getErrorMessage(error));
    }
  }

  private async handleTabContextMenuAction(tabId: string, action: string): Promise<void> {
    if (action === TAB_CONTEXT_MENU_OPEN_IN_NEW_WINDOW_ACTION) {
      await this.openTabInNewWindow(tabId);
      return;
    }

    if (action === TAB_CONTEXT_MENU_CLOSE_OTHER_TABS_ACTION) {
      await this.requestCloseOtherTabs(tabId);
    }
  }

  private async openDroppedDocuments(paths: string[]): Promise<void> {
    await this.openDocumentsAtPaths(paths, this.copy.errors.cannotOpen, {
      droppedPaths: true,
    });
  }

  private async openInitialDocuments(): Promise<void> {
    const finishInitialDocuments = startStartupSpan("initial document preparation");
    const detachedDocumentToken = getDetachedDocumentToken(window.location.search);

    try {
      if (detachedDocumentToken) {
        await this.openDetachedWindowDocument(detachedDocumentToken);
        return;
      }

      await this.openLaunchDocuments();
    } finally {
      finishInitialDocuments();
    }
  }

  private async openDetachedWindowDocument(token: string): Promise<void> {
    try {
      const document = await this.receiveDetachedWindowDocument(token);
      if (!document) {
        if (!this.toolbarElement) {
          this.render();
        }
        this.showErrorDialog(
          this.copy.errors.newWindowOpenFailed,
          this.copy.errors.newWindowDocumentMissing,
        );
        return;
      }

      const tab = createTabFromDetachedWindowDocument(document);
      this.destroyMarkdownEditors();
      this.markdownEditorScrollPositions.clear();
      this.activeDocumentStatsCache.clear();
      this.tabs.splice(0, this.tabs.length, tab);
      this.activeTabId = tab.id;
      this.render();
    } catch (error) {
      if (!this.toolbarElement) {
        this.render();
      }
      this.showErrorDialog(
        this.copy.errors.newWindowOpenFailed,
        this.getErrorMessage(error),
      );
    }
  }

  private async receiveDetachedWindowDocument(
    token: string,
  ): Promise<DetachedWindowDocument | null> {
    const broadcastDocument = await requestDetachedWindowDocument(token);
    if (broadcastDocument) {
      await completeDetachedWindowBroadcastHandoff(token);
      return broadcastDocument;
    }

    const ipcDocument = await takeDetachedWindowDocument(token);

    return ipcDocument ? createDetachedWindowDocumentFromTransfer(ipcDocument) : null;
  }

  private async openLaunchDocuments(): Promise<void> {
    try {
      const finishLaunchPathIpc = startStartupSpan("startup launch path IPC");
      const paths = await getLaunchPaths().finally(finishLaunchPathIpc);
      const finishLaunchDocumentOpen = startStartupSpan("startup launch documents open");
      await this.openDocumentsAtPaths(paths, this.copy.errors.cannotOpen).finally(
        finishLaunchDocumentOpen,
      );
    } catch (error) {
      if (!this.toolbarElement) {
        this.render();
      }
      this.showErrorDialog(this.copy.errors.startupFileError, this.getErrorMessage(error));
      return;
    }

    if (this.toolbarElement) {
      return;
    }

    const openDialog = this.root.querySelector<HTMLDialogElement>(":scope > dialog[open]");
    if (openDialog) {
      openDialog.addEventListener(
        "close",
        () => {
          if (!this.toolbarElement) {
            this.render();
          }
        },
        { once: true },
      );
      return;
    }

    this.render();
  }

  private async openDocumentsAtPaths(
    paths: string[],
    errorTitle: string,
    options: OpenDocumentsAtPathsOptions = {},
  ): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    const errors: OpenPathError[] = [];
    const openTabsByFilePath = createFilePathTabIndex(this.tabs);
    const missingOpenTabFilePaths = new Set<string>();
    const openRequests = paths.map((path, index) => {
      const normalizedPath = normalizeFilePathForComparison(path);

      return {
        path,
        index,
        normalizedPath,
        alreadyOpen: openTabsByFilePath.has(normalizedPath),
      };
    });
    const openPendingRequests = async (
      requests: typeof openRequests,
    ): Promise<Map<number, OpenedMarkdownFileAtPathResult>> => {
      const requestedPaths = requests.map((request) => request.path);
      let openResults: OpenedMarkdownFileAtPathResult[];

      try {
        openResults = await openMarkdownFilesAtPaths(requestedPaths, {
          droppedPaths: options.droppedPaths,
        });
      } catch (error) {
        const message = this.getErrorMessage(error);
        openResults = requestedPaths.map((path) => ({
          path,
          file: null,
          error: message,
        }));
      }

      const resultsByPathIndex = new Map<number, OpenedMarkdownFileAtPathResult>();
      requests.forEach((request, resultIndex) => {
        resultsByPathIndex.set(
          request.index,
          openResults[resultIndex] ?? {
            path: request.path,
            file: null,
            error: this.copy.errors.noOpenResult,
          },
        );
      });

      return resultsByPathIndex;
    };
    const openResultsByPathIndex = new Map<number, OpenedMarkdownFileAtPathResult>();
    let nextOpenRequestOffset = 0;
    const setCurrentOpenTabInPathIndex = (
      normalizedPath: string,
      tab: EditorTab,
    ): void => {
      openTabsByFilePath.set(normalizedPath, tab);
      missingOpenTabFilePaths.delete(normalizedPath);
    };
    const getCurrentOpenTabFromPathIndex = (normalizedPath: string): EditorTab | null => {
      const indexedTab = openTabsByFilePath.get(normalizedPath) ?? null;
      if (indexedTab && this.isOpenTabInstance(indexedTab)) {
        return indexedTab;
      }
      if (missingOpenTabFilePaths.has(normalizedPath)) {
        return null;
      }

      const currentTab =
        this.tabs.find((tab) => {
          return (
            tab.filePath !== null &&
            normalizeFilePathForComparison(tab.filePath) === normalizedPath
          );
        }) ?? null;

      if (currentTab) {
        setCurrentOpenTabInPathIndex(normalizedPath, currentTab);
      } else {
        openTabsByFilePath.delete(normalizedPath);
        missingOpenTabFilePaths.add(normalizedPath);
      }

      return currentTab;
    };
    const applyReadyOpenResults = (): boolean => {
      let shouldRender = false;

      while (nextOpenRequestOffset < openRequests.length) {
        const request = openRequests[nextOpenRequestOffset];
        const existingTab = getCurrentOpenTabFromPathIndex(request.normalizedPath);
        if (existingTab) {
          openResultsByPathIndex.delete(request.index);
          this.activateTab(existingTab.id);
          shouldRender = true;
          nextOpenRequestOffset += 1;
          continue;
        }

        const openResult = openResultsByPathIndex.get(request.index);
        if (!openResult && request.alreadyOpen) {
          nextOpenRequestOffset += 1;
          continue;
        }
        if (!openResult) {
          break;
        }

        openResultsByPathIndex.delete(request.index);
        if (openResult.file) {
          const openedFileNormalizedPath = normalizeFilePathForComparison(openResult.file.path);
          const openedFileExistingTab =
            getCurrentOpenTabFromPathIndex(openedFileNormalizedPath);
          const result = this.applyOpenedFile(openResult.file, openedFileExistingTab);

          if (!openTabsByFilePath.has(request.normalizedPath)) {
            setCurrentOpenTabInPathIndex(request.normalizedPath, result.tab);
          }
          if (!openTabsByFilePath.has(openedFileNormalizedPath)) {
            setCurrentOpenTabInPathIndex(openedFileNormalizedPath, result.tab);
          }

          shouldRender = true;
        } else {
          errors.push({
            path: openResult.path,
            message: openResult.error ?? this.copy.errors.cannotOpen,
          });
        }

        nextOpenRequestOffset += 1;
      }

      return shouldRender;
    };

    const shouldPreserveDroppedRequestCount = options.droppedPaths === true;
    const pendingRequests: typeof openRequests = [];
    const pendingRequestIndexesByPath = new Map<string, number[]>();
    for (const request of openRequests) {
      if (request.alreadyOpen) {
        continue;
      }

      if (!shouldPreserveDroppedRequestCount) {
        const existingIndexes = pendingRequestIndexesByPath.get(request.normalizedPath);
        if (existingIndexes) {
          existingIndexes.push(request.index);
          continue;
        }

        pendingRequestIndexesByPath.set(request.normalizedPath, [request.index]);
      }

      pendingRequests.push(request);
    }

    const applyAndRenderReadyOpenResults = (): void => {
      if (applyReadyOpenResults()) {
        this.renderTabChange();
      }
    };
    const queueOpenResult = (
      request: (typeof openRequests)[number],
      openResult: OpenedMarkdownFileAtPathResult | undefined,
    ): void => {
      if (!openResult) {
        return;
      }

      const requestIndexes = shouldPreserveDroppedRequestCount
        ? [request.index]
        : (pendingRequestIndexesByPath.get(request.normalizedPath) ?? [request.index]);
      for (const requestIndex of requestIndexes) {
        openResultsByPathIndex.set(requestIndex, openResult);
      }
    };

    if (pendingRequests.length > 0) {
      const openResultsByRequestIndex = await openPendingRequests(pendingRequests);
      for (const request of pendingRequests) {
        queueOpenResult(request, openResultsByRequestIndex.get(request.index));
      }
    }

    applyAndRenderReadyOpenResults();

    if (errors.length > 0) {
      if (!this.toolbarElement) {
        this.render();
      }
      this.showErrorDialog(errorTitle, formatOpenPathErrors(errors, this.copy));
    }
  }

  private async saveActiveDocument(): Promise<void> {
    const saveResult = await this.saveTab(this.getActiveTab());
    if (saveResult === "saved") {
      this.updateSavedDocumentChrome();
    }
  }

  private async saveActiveDocumentAs(): Promise<void> {
    const saveResult = await this.saveTabAs(this.getActiveTab());
    if (saveResult === "saved") {
      this.updateSavedDocumentChrome();
    }
  }

  private async openTabInNewWindow(tabId: string): Promise<void> {
    const tab = this.tabs.find((candidate) => candidate.id === tabId);
    if (!tab || this.tabs.length <= 1) {
      return;
    }

    this.flushPendingMarkdownEditorChange(tab.id);
    await this.waitForPendingTabSave(tab);
    if (!this.isOpenTabInstance(tab) || this.tabs.length <= 1) {
      return;
    }

    this.flushPendingMarkdownEditorChange(tab.id);
    await this.completeSavedMarkdownComparisonBeforeClose(tab);
    this.updateTabButton(tab);
    if (tab.id === this.activeTabId) {
      this.updateActiveDocumentChrome(tab);
    }

    const document = createDetachedWindowDocumentFromTab(tab);
    const documentTransfer = createDetachedWindowDocumentTransfer(document);
    const handoffToken = createDetachedWindowHandoffToken();
    const broadcastHandoff = createDetachedWindowBroadcastHandoff(
      handoffToken,
      documentTransfer,
    );
    void broadcastHandoff?.consumed.catch(() => undefined);
    const windowDocument =
      broadcastHandoff === null
        ? documentTransfer
        : createDetachedWindowDocumentWindowRequest(document, handoffToken);
    let sourceTransfer: DetachedWindowSourceTransfer | null = null;
    try {
      await openMarkdownDocumentInNewWindow(windowDocument);

      if (!this.isOpenTabInstance(tab) || this.tabs.length <= 1) {
        return;
      }

      sourceTransfer = this.removeDetachedWindowSourceTabForTransfer(tab);
    } catch (error) {
      if (sourceTransfer) {
        this.restoreDetachedWindowSourceTabAfterFailedTransfer(sourceTransfer);
      }
      this.showErrorDialog(
        this.copy.errors.newWindowOpenFailed,
        this.getErrorMessage(error),
      );
    } finally {
      broadcastHandoff?.dispose();
    }
  }

  private async requestCloseOtherTabs(tabId: string): Promise<void> {
    const targetTab = this.tabs.find((candidate) => candidate.id === tabId);
    if (!targetTab || this.tabs.length <= 1) {
      return;
    }

    const tabsToClose = this.tabs.filter((tab) => tab.id !== tabId);
    for (const tab of tabsToClose) {
      if (!this.isOpenTabInstance(targetTab)) {
        return;
      }

      if (!this.isOpenTabInstance(tab)) {
        continue;
      }

      await this.requestCloseTab(tab.id, {
        protectedTabIds: new Set([targetTab.id]),
      });
      if (this.isOpenTabInstance(tab)) {
        return;
      }
    }

    if (this.isOpenTabInstance(targetTab) && this.activeTabId !== targetTab.id) {
      this.activateTab(targetTab.id);
      this.renderTabChange();
    }
  }

  private async saveTab(
    tab: EditorTab,
    options: SaveTabOptions = {},
  ): Promise<SaveTabResult> {
    return this.trackPendingTabSave(
      tab.id,
      this.tabSaveQueue.enqueue(tab.id, () => this.saveTabNow(tab, options)),
    );
  }

  private async saveTabAs(tab: EditorTab): Promise<SaveTabResult> {
    return this.trackPendingTabSave(
      tab.id,
      this.tabSaveQueue.enqueue(tab.id, () => this.saveTabAsNow(tab)),
    );
  }

  private trackPendingTabSave(
    tabId: string,
    saveResult: Promise<SaveTabResult>,
  ): Promise<SaveTabResult> {
    this.pendingTabSaves.set(tabId, saveResult);
    return saveResult.finally(() => {
      if (this.pendingTabSaves.get(tabId) === saveResult) {
        this.pendingTabSaves.delete(tabId);
      }
    });
  }

  private async waitForPendingTabSave(tab: EditorTab): Promise<void> {
    while (this.isOpenTabInstance(tab)) {
      const pendingSave = this.pendingTabSaves.get(tab.id);
      if (!pendingSave) {
        return;
      }

      await pendingSave;
    }
  }

  private async saveTabNow(
    tab: EditorTab,
    options: SaveTabOptions = {},
  ): Promise<SaveTabResult> {
    return this.markdownFileSaveQueue.enqueue(MARKDOWN_FILE_SAVE_QUEUE_KEY, () =>
      this.saveTabWithExclusiveFileWrite(tab, options),
    );
  }

  private async saveTabAsNow(tab: EditorTab): Promise<SaveTabResult> {
    return this.markdownFileSaveQueue.enqueue(MARKDOWN_FILE_SAVE_QUEUE_KEY, () =>
      this.saveTabAsWithExclusiveFileWrite(tab),
    );
  }

  private async saveTabWithExclusiveFileWrite(
    tab: EditorTab,
    options: SaveTabOptions = {},
  ): Promise<SaveTabResult> {
    try {
      if (!this.isOpenTabInstance(tab)) {
        return "cancelled";
      }

      if (!tab.filePath) {
        return await this.saveTabAsWithExclusiveFileWrite(tab, options);
      }

      this.flushPendingMarkdownEditorChange(tab.id);

      if (!this.isOpenTabInstance(tab)) {
        return "cancelled";
      }

      const filePathToSave = tab.filePath;
      const markdownToSave = tab.markdown;
      const saveResult = await saveMarkdownFile(filePathToSave, markdownToSave, {
        expectedFileFingerprint: tab.fileFingerprint,
      });
      if (saveResult.status === "conflict") {
        return await this.resolveSaveConflict(
          tab,
          saveResult.conflict,
          markdownToSave,
          options,
        );
      }

      const savedFile = saveResult.file;
      if (!this.applySavedFile(tab, savedFile, markdownToSave, options)) {
        return "cancelled";
      }
      return "saved";
    } catch (error) {
      this.showErrorDialog(this.copy.errors.saveFailed, this.getErrorMessage(error));
      return "failed";
    }
  }

  private async saveTabAsWithExclusiveFileWrite(
    tab: EditorTab,
    options: SaveTabOptions = {},
  ): Promise<SaveTabResult> {
    try {
      if (!this.isOpenTabInstance(tab)) {
        return "cancelled";
      }

      const selectedPath = await selectMarkdownSavePath(tab.filePath);
      if (!selectedPath) {
        return "cancelled";
      }

      if (!this.isOpenTabInstance(tab)) {
        return "cancelled";
      }

      this.flushPendingMarkdownEditorChange(tab.id);

      if (!this.isOpenTabInstance(tab)) {
        return "cancelled";
      }

      const markdownToSave = tab.markdown;
      const saveResult = await saveMarkdownFile(selectedPath, markdownToSave, {
        expectedFileFingerprint: null,
        allowExternalOverwrite: true,
      });
      if (saveResult.status === "conflict") {
        this.showErrorDialog(
          this.copy.errors.saveFailed,
          this.copy.errors.selectedSaveConflictUnknown,
        );
        return "failed";
      }
      const savedFile = saveResult.file;

      if (!this.applySavedFile(tab, savedFile, markdownToSave, options)) {
        return "cancelled";
      }
      return "saved";
    } catch (error) {
      this.showErrorDialog(this.copy.errors.saveFailed, this.getErrorMessage(error));
      return "failed";
    }
  }

  private async resolveSaveConflict(
    tab: EditorTab,
    conflict: MarkdownFileSaveConflict,
    markdownToSave: string,
    options: SaveTabOptions,
  ): Promise<SaveTabResult> {
    if (!this.isOpenTabInstance(tab)) {
      return "cancelled";
    }

    const decision = await this.showSaveConflictDialog(tab, conflict);

    if (decision === "cancel") {
      return "cancelled";
    }

    if (!this.isOpenTabInstance(tab)) {
      return "cancelled";
    }

    if (decision === "reload") {
      return await this.reloadTabAfterSaveConflict(tab, conflict.path);
    }

    if (decision === "save-as") {
      return await this.saveTabAsWithExclusiveFileWrite(tab, options);
    }

    const overwriteResult = await saveMarkdownFile(conflict.path, markdownToSave, {
      expectedFileFingerprint: tab.fileFingerprint,
      allowExternalOverwrite: true,
    });
    if (overwriteResult.status === "conflict") {
      this.showErrorDialog(
        this.copy.errors.saveFailed,
        this.copy.errors.overwriteConflictUnresolved,
      );
      return "failed";
    }

    if (!this.applySavedFile(tab, overwriteResult.file, markdownToSave, options)) {
      return "cancelled";
    }

    return "saved";
  }

  private async reloadTabAfterSaveConflict(
    tab: EditorTab,
    path: string,
  ): Promise<SaveTabResult> {
    let file: OpenedMarkdownFile;

    try {
      file = await openMarkdownFileAtPath(path);
    } catch (error) {
      this.showErrorDialog(this.copy.errors.reloadFailed, this.getErrorMessage(error));
      return "failed";
    }

    if (!this.isOpenTabInstance(tab)) {
      return "cancelled";
    }

    replaceTabWithOpenedMarkdownDocument(tab, file);
    this.discardMarkdownEditorState(tab.id);

    if (this.activeTabId === tab.id) {
      this.renderTabChange();
    } else {
      this.updateTabBar();
    }

    return "saved";
  }

  private applySavedFile(
    tab: EditorTab,
    savedFile: SavedMarkdownFile,
    savedMarkdown: string,
    options: SaveTabOptions = {},
  ): boolean {
    if (!this.isOpenTabInstance(tab)) {
      return false;
    }

    const result = applySavedMarkdownDocumentUniquely(
      this.tabs,
      this.activeTabId,
      tab,
      savedFile,
      savedMarkdown,
      { protectedTabIds: options.protectedTabIds },
    );
    this.activateTab(result.activeTabId);
    this.clearPendingEditorContentChange(result.tab.id);
    return true;
  }

  private isOpenTabInstance(tab: EditorTab): boolean {
    return this.tabs.includes(tab);
  }

  private removeDetachedWindowSourceTabForTransfer(
    tab: EditorTab,
  ): DetachedWindowSourceTransfer | null {
    const result = removeDetachedWindowSourceTab(this.tabs, this.activeTabId, tab);
    if (!result) {
      return null;
    }

    this.destroyMarkdownEditor(tab.id, { flushPendingMarkdown: false });
    const sourceScrollPosition = this.markdownEditorScrollPositions.get(tab.id) ?? null;
    this.activeTabId = result.activeTabId;
    this.markdownEditorScrollPositions.delete(tab.id);
    this.renderTabChange();

    return {
      removal: result.removal,
      scrollPosition: sourceScrollPosition,
    };
  }

  private restoreDetachedWindowSourceTabAfterFailedTransfer(
    transfer: DetachedWindowSourceTransfer,
  ): void {
    this.activeTabId = restoreDetachedWindowSourceTab(
      this.tabs,
      this.activeTabId,
      transfer.removal,
    );
    if (transfer.scrollPosition) {
      this.markdownEditorScrollPositions.set(
        transfer.removal.tab.id,
        transfer.scrollPosition,
      );
    }
    this.renderTabChange();
  }

  private applyOpenedFile(
    file: OpenedMarkdownFile,
    existingTab?: EditorTab | null,
  ): OpenedMarkdownDocumentResult {
    this.flushPendingMarkdownEditorChanges({ requireSerializedMarkdown: false });
    this.rememberActiveMarkdownEditorScrollPosition();

    const result = applyOpenedMarkdownDocument(this.tabs, this.activeTabId, file, existingTab);
    this.activeTabId = result.activeTabId;

    if (!result.reusedExistingTab) {
      this.discardMarkdownEditorState(result.tab.id);
    }

    return result;
  }

  private selectTab(tabId: string): void {
    const nextTab = this.tabs.find((tab) => tab.id === tabId);

    if (!nextTab || this.activeTabId === tabId) {
      return;
    }

    const previousTabId = this.activeTabId;
    try {
      this.flushPendingMarkdownEditorChange(previousTabId, {
        requireSerializedMarkdown: false,
      });
    } catch (error) {
      this.showErrorDialog(this.copy.errors.tabSwitchFailed, this.getErrorMessage(error));
      return;
    }
    this.cancelActiveDocumentChromeUpdate();
    this.cancelActiveDocumentStatsRefresh();
    this.activateTab(tabId);
    this.showActiveMarkdownEditor(nextTab);
    this.updateSelectedTabButton(previousTabId, false);
    this.updateSelectedTabButton(tabId, true);
    this.updateActiveDocumentChrome(nextTab);
  }

  private updateEditorContent(change: MarkdownEditorChange): void {
    if (change.isPendingContentChange) {
      this.markEditorContentPending(change.tabId);
      return;
    }

    const { markdown: content, tabId } = change;
    const previousTab = this.tabs.find((candidate) => candidate.id === tabId);
    const previousContentVersion = previousTab ? getTabContentVersion(previousTab) : null;
    const previousDisplayTitle = previousTab ? getTabDisplayTitle(previousTab) : null;
    const previousMarkdown = previousTab?.markdown ?? null;
    this.clearPendingEditorContentChange(tabId);
    const previousStats =
      previousTab && previousContentVersion !== null
        ? this.getFreshActiveDocumentStats(previousTab.id, previousContentVersion)
        : null;

    if (change.isSavedBaselineSync) {
      if (!previousTab) {
        return;
      }

      applyEditorMarkdownBaseline(previousTab, content);
      this.ensureSavedMarkdownComparison(previousTab);
      this.updateEditorContentChrome(
        previousTab,
        previousContentVersion,
        previousDisplayTitle,
      );
      return;
    }

    const isKnownContentChange = previousMarkdown === null || previousMarkdown !== content;
    const tab = updateTabMarkdownById(this.tabs, tabId, content, {
      isKnownContentChange,
      knownChangedIndex: isKnownContentChange ? change.knownChangedIndex : undefined,
      deferSavedMarkdownComparison: true,
    });

    if (!tab) {
      return;
    }

    this.ensureSavedMarkdownComparison(tab);
    this.updateEditorContentChrome(tab, previousContentVersion, previousDisplayTitle, {
      previousMarkdown,
      previousStats,
    });
  }

  private updateEditorContentChrome(
    tab: EditorTab,
    previousContentVersion: number | null,
    previousDisplayTitle: string | null,
    statsChange: ActiveDocumentStatsMarkdownChange | null = null,
  ): void {
    const displayTitle = getTabDisplayTitle(tab);
    if (displayTitle !== previousDisplayTitle) {
      this.updateTabButton(tab);
    }

    if (tab.id !== this.activeTabId) {
      return;
    }

    const contentVersion = getTabContentVersion(tab);
    if (contentVersion === previousContentVersion) {
      if (displayTitle !== previousDisplayTitle) {
        this.scheduleActiveDocumentChromeUpdate();
      }
      return;
    }

    this.scheduleActiveDocumentChromeUpdate();
    if (
      this.cacheActiveDocumentStatsFromTrailingChange(
        tab,
        contentVersion,
        statsChange,
      )
    ) {
      return;
    }

    this.scheduleActiveDocumentStatsRefresh(tab.id, contentVersion);
  }

  private markEditorContentPending(tabId: string): void {
    const tab = this.tabs.find((candidate) => candidate.id === tabId);

    if (!tab) {
      return;
    }

    const previousDisplayTitle = getTabDisplayTitle(tab);
    this.markPendingEditorContentChange(tab.id);
    tab.dirty = true;
    tab.updatedAt = new Date();

    if (getTabDisplayTitle(tab) !== previousDisplayTitle) {
      this.updateTabButton(tab);
    }

    if (tab.id === this.activeTabId) {
      this.scheduleActiveDocumentChromeUpdate();
    }
  }

  private setEditorTheme(themeId: MarkdownEditorThemeId): void {
    if (this.editorThemeId === themeId) {
      return;
    }

    this.editorThemeId = themeId;
    this.editorThemeSettingVersion += 1;
    this.queueEditorThemeSettingSave(themeId);
    void this.flushPendingEditorThemeSettingSave();
    this.destroyMarkdownEditors();
    this.render();
  }

  private setUiLanguage(languageId: UiLanguage): void {
    if (this.uiLanguage === languageId) {
      return;
    }

    this.applyUiLanguage(languageId);
    this.uiLanguageSettingVersion += 1;
    this.queueUiLanguageSettingSave(languageId);
    void this.flushPendingUiLanguageSettingSave();
    this.updateMarkdownEditorCopy();
    this.rememberActiveMarkdownEditorScrollPosition();
    this.render();
  }

  private queueEditorThemeSettingSave(themeId: MarkdownEditorThemeId): void {
    this.editorThemeSettingSave.schedule(
      themeId,
      saveEditorThemeSetting,
      (error: unknown) => {
        console.warn("Editor theme setting could not be saved.", error);
      },
    );
  }

  private flushPendingEditorThemeSettingSave(): Promise<void> | void {
    return this.editorThemeSettingSave.flush();
  }

  private flushPendingAppSettingSaves(): Promise<void> {
    return Promise.all([
      this.flushPendingEditorThemeSettingSave(),
      this.flushPendingUiLanguageSettingSave(),
    ]).then(() => undefined);
  }

  private queueUiLanguageSettingSave(languageId: UiLanguage): void {
    this.uiLanguageSettingSave.schedule(
      languageId,
      saveUiLanguageSetting,
      (error: unknown) => {
        console.warn("UI language setting could not be saved.", error);
      },
    );
  }

  private flushPendingUiLanguageSettingSave(): Promise<void> | void {
    return this.uiLanguageSettingSave.flush();
  }

  private updateMarkdownEditorCopy(): void {
    for (const editor of this.markdownEditors.values()) {
      editor.setCopy(this.copy.editor);
    }
  }

  private applyUiLanguage(languageId: UiLanguage): void {
    this.uiLanguage = languageId;
    this.copy = getAppCopy(languageId);
  }

  private async loadPersistedAppSettings(
    lifecycleVersion: number,
    themeSettingVersion: number,
    languageSettingVersion: number,
  ): Promise<void> {
    const finishPersistedSettingsLoad = startStartupSpan("persisted app settings load");
    const [languageId, themeId] = await Promise.all([
      loadUiLanguageSetting(),
      loadEditorThemeSetting(),
    ]).finally(finishPersistedSettingsLoad);

    if (this.lifecycleVersion !== lifecycleVersion) {
      return;
    }

    let shouldRender = false;
    let shouldRecreateEditors = false;

    if (
      this.uiLanguageSettingVersion === languageSettingVersion &&
      this.uiLanguage !== languageId
    ) {
      this.applyUiLanguage(languageId);
      this.uiLanguageSettingVersion += 1;
      this.updateMarkdownEditorCopy();
      shouldRender = true;
    }

    if (
      this.editorThemeSettingVersion === themeSettingVersion &&
      this.editorThemeId !== themeId
    ) {
      this.editorThemeId = themeId;
      this.editorThemeSettingVersion += 1;
      shouldRecreateEditors = true;
      shouldRender = true;
    }

    if (!shouldRender) {
      return;
    }

    if (shouldRecreateEditors) {
      this.destroyMarkdownEditors();
    }

    this.render();
  }

  private async renderInitialApp(
    lifecycleVersion: number,
    themeSettingVersion: number,
    languageSettingVersion: number,
  ): Promise<void> {
    const finishInitialAppRender = startStartupSpan("initial app orchestration");
    try {
      if (!this.toolbarElement) {
        this.render();
      }

      await this.loadPersistedAppSettings(
        lifecycleVersion,
        themeSettingVersion,
        languageSettingVersion,
      );
      if (this.lifecycleVersion !== lifecycleVersion) {
        return;
      }

      await this.openInitialDocuments();
    } finally {
      finishInitialAppRender();
      if (this.lifecycleVersion !== lifecycleVersion) {
        return;
      }

      if (!this.toolbarElement) {
        this.render();
      }
      this.startFileDropListener();
      this.showPendingWindowCloseGuardRegistrationError();
      this.hasCompletedInitialAppStartup = true;
      markStartupPoint("initial app orchestration completed");
      measureStartupBetween(
        "frontend JS start to initial app orchestration complete",
        "frontend JS start",
        "initial app orchestration completed",
      );
      this.reportFirstEditableStartupProfile();
    }
  }

  private getOrCreateMarkdownEditorElement(tab: EditorTab): HTMLElement {
    const editor = this.getOrCreateMarkdownEditor(tab);

    this.markdownEditor = editor;
    return editor.element;
  }

  private getOrCreateMarkdownEditor(tab: EditorTab): MarkdownEditorHandle {
    const existingEditor = this.markdownEditors.get(tab.id);

    if (existingEditor) {
      this.markdownEditors.delete(tab.id);
      this.markdownEditors.set(tab.id, existingEditor);
      return existingEditor;
    }

    const editor = measureStartupWork("MarkdownEditor handle creation", () =>
      this.markdownEditorFactory({
        tab,
        themeId: this.editorThemeId,
        copy: this.copy.editor,
        onChange: (change) => this.updateEditorContent(change),
        onReady: (ready) => this.handleMarkdownEditorReady(ready.tabId),
      }),
    );

    this.markdownEditors.set(tab.id, editor);
    return editor;
  }

  private showActiveMarkdownEditor(activeTab: EditorTab): boolean {
    const nextEditor = this.getOrCreateMarkdownEditor(activeTab);
    const currentEditorElement = this.root.querySelector<HTMLElement>("[data-region='editor']");
    const nextEditorElement = nextEditor.element;

    this.markdownEditor = nextEditor;
    this.pruneActiveDocumentStatsCache(activeTab.id);

    if (!currentEditorElement) {
      this.render();
      return false;
    }

    if (currentEditorElement !== nextEditorElement) {
      currentEditorElement.replaceWith(nextEditorElement);
    }

    this.pruneMarkdownEditorCache(activeTab.id);
    if (nextEditor) {
      this.restoreMarkdownEditorScrollPosition(activeTab.id);
    }
    return true;
  }

  private handleMarkdownEditorReady(tabId: string): void {
    if (
      this.hasReportedFirstEditableStartupProfile ||
      tabId !== this.activeTabId
    ) {
      return;
    }

    markStartupPoint("first editable editor ready");
    this.hasObservedFirstEditableEditorReady = true;
    this.reportFirstEditableStartupProfile();
  }

  private reportFirstEditableStartupProfile(): void {
    if (
      this.hasReportedFirstEditableStartupProfile ||
      !this.hasCompletedInitialAppStartup ||
      !this.hasObservedFirstEditableEditorReady
    ) {
      return;
    }

    this.hasReportedFirstEditableStartupProfile = true;
    measureStartupBetween(
      "frontend JS start to first editable editor",
      "frontend JS start",
      "first editable editor ready",
    );
    measureStartupFromNavigationStart(
      "WebView navigation start to first editable editor",
      "first editable editor ready",
    );
    measureStartupBetween(
      "MarkdownApp mount start to first editable editor",
      "MarkdownApp mount started",
      "first editable editor ready",
    );
    measureStartupBetween(
      "initial shell render to first editable editor",
      "initial app shell rendered",
      "first editable editor ready",
    );
    reportStartupProfile("first editable editor ready");
  }

  private destroyMarkdownEditor(
    tabId: string,
    options: { flushPendingMarkdown?: boolean; requireSerializedMarkdown?: boolean } = {},
  ): void {
    const editor = this.markdownEditors.get(tabId);

    if (!editor) {
      return;
    }

    this.rememberMarkdownEditorScrollPosition(tabId);
    if (options.flushPendingMarkdown !== false) {
      this.flushPendingMarkdownEditorChange(tabId, {
        requireSerializedMarkdown: options.requireSerializedMarkdown !== false,
      });
    }
    editor.destroy({ flushPendingMarkdown: false });
    editor.element.remove();
    this.markdownEditors.delete(tabId);

    if (this.markdownEditor === editor) {
      this.markdownEditor = null;
    }
  }

  private destroyMarkdownEditors(): void {
    for (const tabId of Array.from(this.markdownEditors.keys())) {
      this.destroyMarkdownEditor(tabId);
    }
  }

  private discardMarkdownEditorState(tabId: string): void {
    this.destroyMarkdownEditor(tabId, { flushPendingMarkdown: false });
    this.clearPendingEditorContentChange(tabId);
    this.markdownEditorScrollPositions.delete(tabId);
  }

  private markPendingEditorContentChange(tabId: string): void {
    this.pendingEditorContentChangeTabIds.add(tabId);
  }

  private clearPendingEditorContentChange(tabId: string): void {
    this.pendingEditorContentChangeTabIds.delete(tabId);
  }

  private clearAllPendingEditorContentChanges(): void {
    this.pendingEditorContentChangeTabIds.clear();
  }

  private hasPendingEditorContentChange(tabId: string): boolean {
    return this.pendingEditorContentChangeTabIds.has(tabId);
  }

  private flushPendingMarkdownEditorChange(
    tabId: string,
    options: { requireSerializedMarkdown?: boolean } = {},
  ): void {
    const editor = this.markdownEditors.get(tabId);
    if (!editor) {
      return;
    }

    editor.flushPendingMarkdownChange?.({
      requireSerializedMarkdown: this.shouldRequireSerializedMarkdownFlush(tabId, options),
    });
  }

  private flushPendingMarkdownEditorChanges(
    options: { requireSerializedMarkdown?: boolean } = {},
  ): void {
    for (const [tabId, editor] of this.markdownEditors) {
      editor.flushPendingMarkdownChange?.({
        requireSerializedMarkdown: this.shouldRequireSerializedMarkdownFlush(
          tabId,
          options,
        ),
      });
    }
  }

  private shouldRequireSerializedMarkdownFlush(
    tabId: string,
    options: { requireSerializedMarkdown?: boolean },
  ): boolean {
    return (
      options.requireSerializedMarkdown !== false ||
      this.hasPendingEditorContentChange(tabId)
    );
  }

  private activateTab(tabId: string): void {
    if (this.activeTabId === tabId) {
      return;
    }

    this.rememberActiveMarkdownEditorScrollPosition();
    this.activeTabId = tabId;
  }

  private rememberActiveMarkdownEditorScrollPosition(): void {
    this.rememberMarkdownEditorScrollPosition(this.activeTabId);
  }

  private rememberMarkdownEditorScrollPosition(tabId: string): void {
    const editor = this.markdownEditors.get(tabId);

    if (!editor) {
      return;
    }

    this.markdownEditorScrollPositions.set(tabId, editor.captureScrollPosition());
  }

  private restoreMarkdownEditorScrollPosition(tabId: string): void {
    const position = this.markdownEditorScrollPositions.get(tabId);
    const editor = this.markdownEditors.get(tabId);

    if (!position || !editor) {
      return;
    }

    editor.restoreScrollPosition(position);
  }

  private pruneMarkdownEditorScrollPositions(openTabsById: Map<string, EditorTab>): void {
    for (const tabId of Array.from(this.markdownEditorScrollPositions.keys())) {
      if (!openTabsById.has(tabId)) {
        this.markdownEditorScrollPositions.delete(tabId);
      }
    }
  }

  private pruneMarkdownEditorCache(activeTabId: string): void {
    const openTabsById = new Map(this.tabs.map((tab) => [tab.id, tab] as const));

    for (const tabId of Array.from(this.markdownEditors.keys())) {
      if (!openTabsById.has(tabId)) {
        this.destroyMarkdownEditor(tabId);
        this.markdownEditorScrollPositions.delete(tabId);
      }
    }

    for (const tabId of Array.from(this.markdownEditors.keys())) {
      if (this.markdownEditors.size <= MAX_CACHED_MARKDOWN_EDITORS) {
        return;
      }

      if (tabId !== activeTabId) {
        this.destroyMarkdownEditor(tabId);
      }
    }

    this.pruneMarkdownEditorScrollPositions(openTabsById);
  }

  private updateActiveDocumentChrome(activeTab: EditorTab): void {
    const nextStatusBar = createAppStatusBar({
      activeTab,
      tabCount: this.tabs.length,
      stats: this.getActiveDocumentStats(activeTab),
      copy: this.copy.status,
    });
    const statusBar =
      this.statusBarElement ?? this.root.querySelector<HTMLElement>("[data-region='status']");

    if (statusBar) {
      statusBar.replaceWith(nextStatusBar);
      this.statusBarElement = nextStatusBar;
    }
  }

  private renderTabChange(): void {
    this.hideContextMenus();
    this.cancelActiveDocumentChromeUpdate();
    this.cancelActiveDocumentStatsRefresh();

    const activeTab = this.getActiveTab();
    if (!this.showActiveMarkdownEditor(activeTab)) {
      return;
    }

    this.updateTabBar();
    this.updateActiveDocumentChrome(activeTab);
  }

  private updateTabBar(): void {
    const tabBar =
      this.tabBarElement ?? this.root.querySelector<HTMLElement>("[data-region='tabs']");

    if (!tabBar) {
      this.render();
      return;
    }

    const nextTabBar = TabBar({
      tabs: this.tabs,
      activeTabId: this.activeTabId,
      onSelect: (tabId) => this.selectTab(tabId),
      onClose: (tabId) => this.requestCloseTabSafely(tabId),
      onCloseError: (error) =>
        this.showErrorDialog(this.copy.errors.closeFailed, this.getErrorMessage(error)),
      onContextMenu: ({ tabId, x, y }) => this.showTabContextMenu(tabId, x, y),
      copy: this.copy.tabBar,
    });

    tabBar.replaceWith(nextTabBar);
    this.tabBarElement = nextTabBar;
  }

  private updateSavedDocumentChrome(): void {
    this.cancelActiveDocumentChromeUpdate();

    const activeTab = this.getActiveTab();
    const chrome = createAppChrome(this.getAppChromeOptions(activeTab));
    const nextToolbar = chrome.toolbarElement;
    const nextTabBar = chrome.tabBarElement;
    const nextStatusBar = chrome.statusBarElement;

    this.toolbarElement?.replaceWith(nextToolbar);
    this.tabBarElement?.replaceWith(nextTabBar);
    this.statusBarElement?.replaceWith(nextStatusBar);

    this.toolbarElement = nextToolbar;
    this.tabBarElement = nextTabBar;
    this.statusBarElement = nextStatusBar;
  }

  private getAppChromeOptions(activeTab: EditorTab): AppChromeOptions {
    return {
      activeTab,
      tabs: this.tabs,
      activeTabId: this.activeTabId,
      themeId: this.editorThemeId,
      languageId: this.uiLanguage,
      copy: this.copy,
      stats: this.getActiveDocumentStats(activeTab),
      onToolbarAction: (action) => this.handleToolbarActionSafely(action),
      onThemeChange: (themeId) => this.setEditorTheme(themeId),
      onLanguageChange: (languageId) => this.setUiLanguage(languageId),
      onSelectTab: (tabId) => this.selectTab(tabId),
      onCloseTab: (tabId) => this.requestCloseTabSafely(tabId),
      onTabContextMenu: (tabId, x, y) => this.showTabContextMenu(tabId, x, y),
    };
  }

  private getActiveDocumentStats(activeTab: EditorTab): DocumentStats {
    const contentVersion = getTabContentVersion(activeTab);
    const cachedStats = this.getFreshActiveDocumentStats(activeTab.id, contentVersion);

    if (cachedStats !== null) {
      return cachedStats;
    }

    const tabStatsCache = this.activeDocumentStatsCache.get(activeTab.id);
    if (tabStatsCache) {
      this.ensureActiveDocumentStatsRefresh(activeTab.id, contentVersion);
      return tabStatsCache.stats;
    }

    if (activeTab.markdown.length > SYNCHRONOUS_DOCUMENT_STATS_CHARACTER_LIMIT) {
      this.ensureActiveDocumentStatsRefresh(activeTab.id, contentVersion);
      return getPendingDocumentStats(activeTab.markdown);
    }

    return this.computeActiveDocumentStats(activeTab);
  }

  private computeActiveDocumentStats(activeTab: EditorTab): DocumentStats {
    const contentVersion = getTabContentVersion(activeTab);
    const stats = getDocumentStats(activeTab.markdown);
    this.activeDocumentStatsCache.set(activeTab.id, {
      tabId: activeTab.id,
      contentVersion,
      stats,
    });

    return stats;
  }

  private cacheActiveDocumentStatsFromTrailingChange(
    activeTab: EditorTab,
    contentVersion: number,
    statsChange: ActiveDocumentStatsMarkdownChange | null,
  ): boolean {
    if (
      !statsChange ||
      statsChange.previousMarkdown === null ||
      statsChange.previousStats === null
    ) {
      return false;
    }

    const stats = getDocumentStatsAfterTrailingMarkdownChange(
      statsChange.previousMarkdown,
      activeTab.markdown,
      statsChange.previousStats,
    );

    if (stats === null) {
      return false;
    }

    this.cancelActiveDocumentStatsRefresh();
    this.activeDocumentStatsCache.set(activeTab.id, {
      tabId: activeTab.id,
      contentVersion,
      stats,
    });

    return true;
  }

  private scheduleActiveDocumentChromeUpdate(): void {
    if (this.activeDocumentChromeUpdateTimer !== null) {
      window.clearTimeout(this.activeDocumentChromeUpdateTimer);
    }

    this.activeDocumentChromeUpdateTimer = window.setTimeout(() => {
      this.activeDocumentChromeUpdateTimer = null;
      this.updateActiveDocumentChrome(this.getActiveTab());
    }, ACTIVE_DOCUMENT_CHROME_UPDATE_DELAY_MS);
  }

  private cancelActiveDocumentChromeUpdate(): void {
    if (this.activeDocumentChromeUpdateTimer === null) {
      return;
    }

    window.clearTimeout(this.activeDocumentChromeUpdateTimer);
    this.activeDocumentChromeUpdateTimer = null;
  }

  private scheduleActiveDocumentStatsRefresh(tabId: string, contentVersion: number): void {
    if (this.hasFreshActiveDocumentStats(tabId, contentVersion)) {
      this.cancelActiveDocumentStatsRefresh();
      return;
    }

    if (this.isActiveDocumentStatsRefreshPending(tabId, contentVersion)) {
      return;
    }

    this.cancelActiveDocumentStatsRefresh();
    this.activeDocumentStatsRefreshTarget = { tabId, contentVersion };
    this.queueActiveDocumentStatsRefresh(tabId, contentVersion);
  }

  private ensureActiveDocumentStatsRefresh(tabId: string, contentVersion: number): void {
    if (
      this.hasFreshActiveDocumentStats(tabId, contentVersion) ||
      this.isActiveDocumentStatsRefreshPending(tabId, contentVersion)
    ) {
      return;
    }

    this.scheduleActiveDocumentStatsRefresh(tabId, contentVersion);
  }

  private queueActiveDocumentStatsRefresh(tabId: string, contentVersion: number): void {
    const delayMs = this.getActiveDocumentStatsRefreshDelay(tabId, contentVersion);

    this.activeDocumentStatsUpdateTimer = window.setTimeout(() => {
      this.activeDocumentStatsUpdateTimer = null;
      this.queueActiveDocumentStatsIdleRefresh(tabId, contentVersion);
    }, delayMs);
  }

  private getActiveDocumentStatsRefreshDelay(tabId: string, contentVersion: number): number {
    const activeTab = this.getActiveTab();

    if (
      activeTab.id !== tabId ||
      getTabContentVersion(activeTab) !== contentVersion ||
      activeTab.markdown.length <= LARGE_DOCUMENT_STATS_CHARACTER_LIMIT
    ) {
      return ACTIVE_DOCUMENT_STATS_UPDATE_DELAY_MS;
    }

    const isVeryLargeDocument =
      activeTab.markdown.length >= VERY_LARGE_DOCUMENT_STATS_CHARACTER_LIMIT;
    const largeDocumentUpdateDelayMs = isVeryLargeDocument
      ? VERY_LARGE_DOCUMENT_STATS_UPDATE_DELAY_MS
      : LARGE_DOCUMENT_STATS_UPDATE_DELAY_MS;
    const largeDocumentMinRescanIntervalMs = isVeryLargeDocument
      ? VERY_LARGE_DOCUMENT_STATS_MIN_RESCAN_INTERVAL_MS
      : LARGE_DOCUMENT_STATS_MIN_RESCAN_INTERVAL_MS;

    const elapsedSinceScan = this.getElapsedSinceLastCompletedStatsScan(tabId);
    if (elapsedSinceScan === null) {
      return largeDocumentUpdateDelayMs;
    }

    const cooldownDelay = Math.max(
      0,
      largeDocumentMinRescanIntervalMs - elapsedSinceScan,
    );

    return Math.max(largeDocumentUpdateDelayMs, cooldownDelay);
  }

  private getElapsedSinceLastCompletedStatsScan(tabId: string): number | null {
    if (this.activeDocumentStatsLastCompletedScan?.tabId !== tabId) {
      return null;
    }

    return Math.max(0, Date.now() - this.activeDocumentStatsLastCompletedScan.completedAt);
  }

  private queueActiveDocumentStatsIdleRefresh(tabId: string, contentVersion: number): void {
    if (typeof window.requestIdleCallback === "function") {
      this.activeDocumentStatsIdleCallback = window.requestIdleCallback(
        () => {
          this.activeDocumentStatsIdleCallback = null;
          this.refreshActiveDocumentStats(tabId, contentVersion);
        },
        { timeout: ACTIVE_DOCUMENT_STATS_IDLE_TIMEOUT_MS },
      );
      return;
    }

    this.activeDocumentStatsUpdateTimer = window.setTimeout(() => {
      this.activeDocumentStatsUpdateTimer = null;
      this.refreshActiveDocumentStats(tabId, contentVersion);
    }, 0);
  }

  private refreshActiveDocumentStats(tabId: string, contentVersion: number): void {
    if (this.hasFreshActiveDocumentStats(tabId, contentVersion)) {
      this.clearActiveDocumentStatsRefreshTarget(tabId, contentVersion);
      return;
    }

    const activeTab = this.getActiveTab();
    const activeContentVersion = getTabContentVersion(activeTab);

    if (activeTab.id !== tabId || activeContentVersion !== contentVersion) {
      this.clearActiveDocumentStatsRefreshTarget(tabId, contentVersion);
      return;
    }

    const stats = this.advanceActiveDocumentStatsScan(activeTab, tabId, contentVersion);

    if (stats === null) {
      this.queueActiveDocumentStatsIdleRefresh(tabId, contentVersion);
      return;
    }

    this.activeDocumentStatsCache.set(tabId, {
      tabId,
      contentVersion,
      stats,
    });
    this.rememberCompletedActiveDocumentStatsScan(activeTab);
    this.clearActiveDocumentStatsRefreshTarget(tabId, contentVersion);
    this.updateActiveDocumentChrome(activeTab);
  }

  private rememberCompletedActiveDocumentStatsScan(activeTab: EditorTab): void {
    if (activeTab.markdown.length <= LARGE_DOCUMENT_STATS_CHARACTER_LIMIT) {
      return;
    }

    this.activeDocumentStatsLastCompletedScan = {
      tabId: activeTab.id,
      completedAt: Date.now(),
    };
  }

  private advanceActiveDocumentStatsScan(
    activeTab: EditorTab,
    tabId: string,
    contentVersion: number,
  ): DocumentStats | null {
    let scan = this.activeDocumentStatsScan;

    if (!scan || scan.tabId !== tabId || scan.contentVersion !== contentVersion) {
      scan = {
        tabId,
        contentVersion,
        state: createDocumentStatsScan(activeTab.markdown),
      };
      this.activeDocumentStatsScan = scan;
    }

    return advanceDocumentStatsScan(scan.state, DOCUMENT_STATS_SCAN_CHUNK_SIZE);
  }

  private cancelActiveDocumentStatsRefresh(): void {
    if (this.activeDocumentStatsUpdateTimer !== null) {
      window.clearTimeout(this.activeDocumentStatsUpdateTimer);
      this.activeDocumentStatsUpdateTimer = null;
    }

    if (
      this.activeDocumentStatsIdleCallback !== null &&
      typeof window.cancelIdleCallback === "function"
    ) {
      window.cancelIdleCallback(this.activeDocumentStatsIdleCallback);
    }

    this.activeDocumentStatsIdleCallback = null;
    this.activeDocumentStatsRefreshTarget = null;
    this.activeDocumentStatsScan = null;
  }

  private pruneActiveDocumentStatsCache(preserveStaleTabId: string): void {
    const openTabContentVersions = new Map<string, number>();

    for (const tab of this.tabs) {
      openTabContentVersions.set(tab.id, getTabContentVersion(tab));
    }

    for (const [tabId, cache] of this.activeDocumentStatsCache) {
      if (
        !openTabContentVersions.has(tabId) ||
        (tabId !== preserveStaleTabId &&
          openTabContentVersions.get(tabId) !== cache.contentVersion)
      ) {
        this.activeDocumentStatsCache.delete(tabId);
      }
    }
  }

  private hasFreshActiveDocumentStats(tabId: string, contentVersion: number): boolean {
    return this.getFreshActiveDocumentStats(tabId, contentVersion) !== null;
  }

  private getFreshActiveDocumentStats(
    tabId: string,
    contentVersion: number,
  ): DocumentStats | null {
    const cache = this.activeDocumentStatsCache.get(tabId);
    if (cache?.contentVersion === contentVersion) {
      return cache.stats;
    }

    return null;
  }

  private isActiveDocumentStatsRefreshPending(tabId: string, contentVersion: number): boolean {
    return (
      this.activeDocumentStatsRefreshTarget?.tabId === tabId &&
      this.activeDocumentStatsRefreshTarget.contentVersion === contentVersion
    );
  }

  private clearActiveDocumentStatsRefreshTarget(tabId: string, contentVersion: number): void {
    if (this.isActiveDocumentStatsRefreshPending(tabId, contentVersion)) {
      this.activeDocumentStatsRefreshTarget = null;
    }

    if (
      this.activeDocumentStatsScan?.tabId === tabId &&
      this.activeDocumentStatsScan.contentVersion === contentVersion
    ) {
      this.activeDocumentStatsScan = null;
    }
  }

  private ensureSavedMarkdownComparison(tab: EditorTab): void {
    if (!hasPendingSavedMarkdownComparison(tab)) {
      if (this.savedMarkdownComparisonScan?.tabId === tab.id) {
        this.cancelSavedMarkdownComparison();
      }
      return;
    }

    const contentVersion = getTabContentVersion(tab);
    const scan = this.savedMarkdownComparisonScan;

    if (scan?.tabId === tab.id && scan.contentVersion === contentVersion) {
      return;
    }

    this.cancelSavedMarkdownComparison();
    this.ensureSavedMarkdownComparisonScan(tab);
    this.queueSavedMarkdownComparison();
  }

  private ensureSavedMarkdownComparisonScan(tab: EditorTab): void {
    const contentVersion = getTabContentVersion(tab);
    const scan = this.savedMarkdownComparisonScan;

    if (scan?.tabId === tab.id && scan.contentVersion === contentVersion) {
      return;
    }

    this.savedMarkdownComparisonScan = {
      tabId: tab.id,
      contentVersion,
      markdown: tab.markdown,
      lastSavedMarkdown: tab.lastSavedMarkdown,
      index: 0,
    };
  }

  private queueSavedMarkdownComparison(): void {
    if (this.isSavedMarkdownComparisonQueued()) {
      return;
    }

    if (typeof window.requestIdleCallback === "function") {
      this.savedMarkdownComparisonIdleCallback = window.requestIdleCallback(
        () => {
          this.savedMarkdownComparisonIdleCallback = null;
          this.advanceSavedMarkdownComparison();
        },
        { timeout: SAVED_MARKDOWN_COMPARISON_IDLE_TIMEOUT_MS },
      );
      return;
    }

    this.savedMarkdownComparisonTimer = window.setTimeout(() => {
      this.savedMarkdownComparisonTimer = null;
      this.advanceSavedMarkdownComparison();
    }, 0);
  }

  private isSavedMarkdownComparisonQueued(): boolean {
    return (
      this.savedMarkdownComparisonIdleCallback !== null ||
      this.savedMarkdownComparisonTimer !== null
    );
  }

  private advanceSavedMarkdownComparison(): void {
    if (!this.advanceSavedMarkdownComparisonScan()) {
      this.queueSavedMarkdownComparison();
    }
  }

  private advanceSavedMarkdownComparisonScan(): boolean {
    const scan = this.savedMarkdownComparisonScan;

    if (!scan) {
      return true;
    }

    const tab = this.tabs.find((candidate) => candidate.id === scan.tabId);
    if (
      !tab ||
      getTabContentVersion(tab) !== scan.contentVersion ||
      !hasPendingSavedMarkdownComparison(tab)
    ) {
      this.savedMarkdownComparisonScan = null;
      return true;
    }

    if (scan.markdown.length !== scan.lastSavedMarkdown.length) {
      this.finishSavedMarkdownComparison(tab, false);
      return true;
    }

    const chunkEndIndex = Math.min(
      scan.markdown.length,
      scan.index + SAVED_MARKDOWN_COMPARISON_SCAN_CHUNK_SIZE,
    );

    while (scan.index < chunkEndIndex) {
      if (
        scan.markdown.charCodeAt(scan.index) !==
        scan.lastSavedMarkdown.charCodeAt(scan.index)
      ) {
        this.finishSavedMarkdownComparison(tab, false);
        return true;
      }

      scan.index += 1;
    }

    if (scan.index >= scan.markdown.length) {
      this.finishSavedMarkdownComparison(tab, true);
      return true;
    }

    return false;
  }

  private finishSavedMarkdownComparison(tab: EditorTab, matchesSavedMarkdown: boolean): void {
    const dirtyChanged = resolvePendingSavedMarkdownComparison(tab, matchesSavedMarkdown);

    if (this.savedMarkdownComparisonScan?.tabId === tab.id) {
      this.savedMarkdownComparisonScan = null;
    }

    if (!dirtyChanged) {
      return;
    }

    this.updateTabButton(tab);

    if (tab.id === this.activeTabId) {
      this.scheduleActiveDocumentChromeUpdate();
    }
  }

  private async completeSavedMarkdownComparisonBeforeClose(tab: EditorTab): Promise<void> {
    if (!this.isOpenTabInstance(tab) || !hasPendingSavedMarkdownComparison(tab)) {
      return;
    }

    if (!canCompletePendingSavedMarkdownComparisonSynchronously(tab)) {
      await this.completeDeferredSavedMarkdownComparisonBeforeClose(tab);
      return;
    }

    if (this.savedMarkdownComparisonScan?.tabId === tab.id) {
      this.cancelSavedMarkdownComparisonQueue();
      this.savedMarkdownComparisonScan = null;
    }

    const dirtyChanged = completePendingSavedMarkdownComparison(tab);

    if (!dirtyChanged) {
      return;
    }

    this.updateTabButton(tab);

    if (tab.id === this.activeTabId) {
      this.scheduleActiveDocumentChromeUpdate();
    }
  }

  private async completeDeferredSavedMarkdownComparisonBeforeClose(
    tab: EditorTab,
  ): Promise<void> {
    this.cancelSavedMarkdownComparisonQueue();
    this.ensureSavedMarkdownComparisonScan(tab);

    while (this.isOpenTabInstance(tab) && hasPendingSavedMarkdownComparison(tab)) {
      const scan = this.savedMarkdownComparisonScan;
      if (
        !scan ||
        scan.tabId !== tab.id ||
        scan.contentVersion !== getTabContentVersion(tab)
      ) {
        this.ensureSavedMarkdownComparisonScan(tab);
      }

      if (this.advanceSavedMarkdownComparisonScan()) {
        return;
      }

      await waitForNextSavedMarkdownComparisonChunk();
    }
  }

  private cancelSavedMarkdownComparison(): void {
    this.cancelSavedMarkdownComparisonQueue();
    this.savedMarkdownComparisonScan = null;
  }

  private cancelSavedMarkdownComparisonQueue(): void {
    if (this.savedMarkdownComparisonIdleCallback !== null) {
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(this.savedMarkdownComparisonIdleCallback);
      }
      this.savedMarkdownComparisonIdleCallback = null;
    }

    if (this.savedMarkdownComparisonTimer !== null) {
      window.clearTimeout(this.savedMarkdownComparisonTimer);
      this.savedMarkdownComparisonTimer = null;
    }
  }

  private updateTabButton(tab: EditorTab): void {
    const tabButton = this.findTabButton(tab.id);

    if (!tabButton) {
      return;
    }

    tabButton.classList.toggle("is-dirty", tab.dirty);
    tabButton.dataset.tooltipText = getTabTooltipText(tab);
    tabButton.textContent = getTabDisplayTitle(tab);
  }

  private updateSelectedTabButton(tabId: string, isActive: boolean): void {
    const tabButton = this.findTabButton(tabId);

    if (!tabButton) {
      return;
    }

    tabButton.classList.toggle("is-active", isActive);
    tabButton.setAttribute("aria-selected", String(isActive));
  }

  private findTabButton(tabId: string): HTMLButtonElement | null {
    for (const tabButton of this.root.querySelectorAll<HTMLButtonElement>(".tab-bar__tab")) {
      if (tabButton.dataset.tabId === tabId) {
        return tabButton;
      }
    }

    return null;
  }

  private async requestCloseTab(
    tabId: string,
    options: SaveTabOptions = {},
  ): Promise<void> {
    const tab = this.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) {
      return;
    }

    if (this.pendingTabCloseRequests.has(tabId)) {
      return;
    }

    this.pendingTabCloseRequests.add(tabId);
    try {
      this.flushPendingMarkdownEditorChange(tab.id, {
        requireSerializedMarkdown: false,
      });
      await this.waitForPendingTabSave(tab);
      if (!this.isOpenTabInstance(tab)) {
        return;
      }

      this.flushPendingMarkdownEditorChange(tab.id, {
        requireSerializedMarkdown: false,
      });
      await this.completeSavedMarkdownComparisonBeforeClose(tab);

      let shouldFlushPendingMarkdownOnClose = true;
      if (tab.dirty) {
        const decision = await this.showUnsavedChangeDialog(tab, "tab");

        if (decision === "cancel") {
          return;
        }

        if (decision === "save") {
          const saveResult = await this.saveTab(tab, options);
          if (saveResult !== "saved") {
            return;
          }

          if (tab.dirty) {
            this.render();
            return;
          }
        } else {
          shouldFlushPendingMarkdownOnClose = false;
        }
      }

      this.closeTab(tabId, {
        flushPendingMarkdown: shouldFlushPendingMarkdownOnClose,
      });
    } finally {
      this.pendingTabCloseRequests.delete(tabId);
    }
  }

  private requestCloseTabSafely(tabId: string): void {
    void this.requestCloseTab(tabId).catch((error: unknown) => {
      this.showErrorDialog(this.copy.errors.closeFailed, this.getErrorMessage(error));
    });
  }

  private async resolveWindowCloseRequest(): Promise<boolean> {
    const discardedTabIds = new Set<string>();

    while (true) {
      this.flushPendingMarkdownEditorChanges({ requireSerializedMarkdown: false });

      const dirtyTab = this.tabs.find((tab) => tab.dirty && !discardedTabIds.has(tab.id));
      if (!dirtyTab) {
        return true;
      }

      await this.waitForPendingTabSave(dirtyTab);
      if (!this.isOpenTabInstance(dirtyTab)) {
        continue;
      }

      await this.completeSavedMarkdownComparisonBeforeClose(dirtyTab);

      if (!dirtyTab.dirty) {
        this.render();
        continue;
      }

      this.activateTab(dirtyTab.id);
      this.render();

      const decision = await this.showUnsavedChangeDialog(dirtyTab, "window");

      if (decision === "cancel") {
        return false;
      }

      if (decision === "discard") {
        discardedTabIds.add(dirtyTab.id);
        continue;
      }

      const saveResult = await this.saveTab(dirtyTab);
      if (saveResult !== "saved") {
        return false;
      }

      this.render();
    }
  }

  private closeTab(
    tabId: string,
    options: { flushPendingMarkdown?: boolean; requireSerializedMarkdown?: boolean } = {},
  ): void {
    if (options.flushPendingMarkdown !== false) {
      this.flushPendingMarkdownEditorChange(tabId, {
        requireSerializedMarkdown: options.requireSerializedMarkdown !== false,
      });
    }

    if (this.tabs.length === 1) {
      this.discardMarkdownEditorState(tabId);
      const replacement = createUntitledTab();
      this.tabs.splice(0, 1, replacement);
      this.activeTabId = replacement.id;
      this.renderTabChange();
      return;
    }

    const tabIndex = this.tabs.findIndex((candidate) => candidate.id === tabId);
    if (tabIndex < 0) {
      return;
    }

    this.discardMarkdownEditorState(tabId);
    this.tabs.splice(tabIndex, 1);
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs[Math.max(0, tabIndex - 1)].id;
    }
    this.renderTabChange();
  }

  private getActiveTab(): EditorTab {
    const activeTab = this.tabs.find((tab) => tab.id === this.activeTabId);

    if (!activeTab) {
      throw new Error("Active tab was not found.");
    }

    return activeTab;
  }

  private hasDirtyTabs(): boolean {
    return this.tabs.some((tab) => tab.dirty);
  }

  private showUnsavedChangeDialog(
    tab: EditorTab,
    context: UnsavedChangeContext,
  ): Promise<UnsavedChangeDecision> {
    const dialog = document.createElement("dialog");
    const dialogId = nextDialogElementId("unsaved-change-dialog");
    const headingId = `${dialogId}-heading`;
    const bodyId = `${dialogId}-body`;

    dialog.id = dialogId;
    dialog.className = "modal-dialog";
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", headingId);
    dialog.setAttribute("aria-describedby", bodyId);

    const form = document.createElement("form");
    form.method = "dialog";
    form.className = "modal-dialog__body";

    const heading = document.createElement("h2");
    heading.id = headingId;
    heading.textContent = this.copy.dialogs.unsavedTitle;

    const body = document.createElement("p");
    body.id = bodyId;
    body.textContent = this.copy.dialogs.unsavedMessage(tab.title, context);

    const actions = document.createElement("div");
    actions.className = "modal-dialog__actions";

    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.value = "save";
    saveButton.className = "primary-button";
    saveButton.textContent = this.copy.dialogs.buttons.save;

    const discardButton = document.createElement("button");
    discardButton.type = "submit";
    discardButton.value = "discard";
    discardButton.className = "danger-button";
    discardButton.textContent = this.copy.dialogs.buttons.discard;

    const cancelButton = document.createElement("button");
    cancelButton.type = "submit";
    cancelButton.value = "cancel";
    cancelButton.className = "secondary-button";
    cancelButton.textContent = this.copy.dialogs.buttons.cancel;

    actions.append(saveButton, discardButton, cancelButton);
    form.append(heading, body, actions);
    dialog.append(form);
    this.root.append(dialog);

    return new Promise((resolve) => {
      let didResolve = false;
      const resolveOnce = (decision: UnsavedChangeDecision): void => {
        if (didResolve) {
          return;
        }

        didResolve = true;
        dialog.remove();
        resolve(decision);
      };

      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        dialog.close("cancel");
      });

      dialog.addEventListener(
        "close",
        () => {
          const decision = getUnsavedChangeDecision(dialog.returnValue);
          resolveOnce(decision);
        },
        { once: true },
      );

      try {
        dialog.showModal();
      } catch (error) {
        console.error("Failed to show unsaved changes dialog.", error);
        resolveOnce("cancel");
        return;
      }

      cancelButton.focus();
    });
  }

  private showSaveConflictDialog(
    tab: EditorTab,
    conflict: MarkdownFileSaveConflict,
  ): Promise<SaveConflictDecision> {
    const dialog = document.createElement("dialog");
    const dialogId = nextDialogElementId("save-conflict-dialog");
    const headingId = `${dialogId}-heading`;
    const bodyId = `${dialogId}-body`;

    dialog.id = dialogId;
    dialog.className = "modal-dialog";
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", headingId);
    dialog.setAttribute("aria-describedby", bodyId);

    const form = document.createElement("form");
    form.method = "dialog";
    form.className = "modal-dialog__body";

    const heading = document.createElement("h2");
    heading.id = headingId;
    heading.textContent = this.copy.dialogs.saveConflictTitle;

    const body = document.createElement("p");
    body.id = bodyId;
    body.textContent = getSaveConflictMessage(tab, conflict, this.copy);

    const actions = document.createElement("div");
    actions.className = "modal-dialog__actions";

    const reloadButton = document.createElement("button");
    reloadButton.type = "submit";
    reloadButton.value = "reload";
    reloadButton.className = "secondary-button";
    reloadButton.textContent = this.copy.dialogs.buttons.reload;

    const saveAsButton = document.createElement("button");
    saveAsButton.type = "submit";
    saveAsButton.value = "save-as";
    saveAsButton.className = "secondary-button";
    saveAsButton.textContent = this.copy.dialogs.buttons.saveAs;

    const overwriteButton = document.createElement("button");
    overwriteButton.type = "submit";
    overwriteButton.value = "overwrite";
    overwriteButton.className = "danger-button";
    overwriteButton.textContent = this.copy.dialogs.buttons.overwrite;

    const cancelButton = document.createElement("button");
    cancelButton.type = "submit";
    cancelButton.value = "cancel";
    cancelButton.className = "primary-button";
    cancelButton.textContent = this.copy.dialogs.buttons.cancel;

    actions.append(reloadButton, saveAsButton, overwriteButton, cancelButton);
    form.append(heading, body, actions);
    dialog.append(form);
    this.root.append(dialog);

    return new Promise((resolve) => {
      let didResolve = false;
      const resolveOnce = (decision: SaveConflictDecision): void => {
        if (didResolve) {
          return;
        }

        didResolve = true;
        dialog.remove();
        resolve(decision);
      };

      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        dialog.close("cancel");
      });

      dialog.addEventListener(
        "close",
        () => {
          resolveOnce(getSaveConflictDecision(dialog.returnValue));
        },
        { once: true },
      );

      try {
        dialog.showModal();
      } catch (error) {
        console.error("Failed to show save conflict dialog.", error);
        resolveOnce("cancel");
        return;
      }

      cancelButton.focus();
    });
  }

  private async showAboutDialog(): Promise<void> {
    const aboutInfo = await getAboutInfo();
    const aboutText = await getAboutText().catch((error: unknown) => {
      console.error("Failed to load about.txt.", error);

      return this.copy.dialogs.aboutTextLoadFailed(
        aboutInfo.version,
        aboutInfo.githubUrl,
      );
    });
    const dialog = document.createElement("dialog");
    const dialogId = nextDialogElementId("about-dialog");
    const headingId = `${dialogId}-heading`;
    const bodyId = `${dialogId}-body`;

    dialog.id = dialogId;
    dialog.className = "modal-dialog modal-dialog--about";
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", headingId);
    dialog.setAttribute("aria-describedby", bodyId);

    const form = document.createElement("form");
    form.method = "dialog";
    form.className = "modal-dialog__body";

    const heading = document.createElement("h2");
    heading.id = headingId;
    heading.textContent = this.copy.dialogs.aboutTitle;

    const version = document.createElement("p");
    version.className = "modal-dialog__version";
    version.textContent = this.copy.dialogs.aboutVersion(aboutInfo.version);

    const aboutContent = document.createElement("pre");
    aboutContent.id = bodyId;
    aboutContent.className = "modal-dialog__about-text";
    aboutContent.tabIndex = 0;
    aboutContent.textContent = aboutText;

    const footer = document.createElement("div");
    footer.className = "modal-dialog__footer";

    const link = document.createElement("a");
    link.className = "modal-dialog__link";
    link.href = aboutInfo.githubUrl;
    link.textContent = aboutInfo.githubUrl;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void openAboutLink().catch((error: unknown) => {
        if (dialog.open) {
          dialog.close("open-link-error");
        } else {
          dialog.remove();
        }
        window.setTimeout(() => {
          this.showErrorDialog(
            this.copy.errors.linkOpenFailed,
            this.getErrorMessage(error),
          );
        }, 0);
      });
    });

    const actions = document.createElement("div");
    actions.className = "modal-dialog__actions";

    const closeButton = document.createElement("button");
    closeButton.type = "submit";
    closeButton.value = "ok";
    closeButton.className = "primary-button";
    closeButton.textContent = this.copy.dialogs.buttons.close;

    actions.append(closeButton);
    footer.append(link, actions);
    form.append(heading, version, aboutContent, footer);
    dialog.append(form);
    this.root.append(dialog);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      dialog.close("ok");
    });
    dialog.addEventListener("close", () => dialog.remove(), { once: true });

    try {
      dialog.showModal();
    } catch (error) {
      console.error("Failed to show about dialog.", error);
      dialog.remove();
      return;
    }

    closeButton.focus();
  }

  private getErrorMessage(error: unknown): string {
    return getErrorMessage(error, this.copy.errors.unknown);
  }

  private showErrorDialog(title: string, message: string): void {
    const dialog = document.createElement("dialog");
    const dialogId = nextDialogElementId("error-dialog");
    const headingId = `${dialogId}-heading`;
    const bodyId = `${dialogId}-body`;

    dialog.id = dialogId;
    dialog.className = "modal-dialog";
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", headingId);
    dialog.setAttribute("aria-describedby", bodyId);

    const form = document.createElement("form");
    form.method = "dialog";
    form.className = "modal-dialog__body";

    const heading = document.createElement("h2");
    heading.id = headingId;
    heading.textContent = title;

    const body = document.createElement("p");
    body.id = bodyId;
    body.textContent = message;

    const actions = document.createElement("div");
    actions.className = "modal-dialog__actions";

    const okButton = document.createElement("button");
    okButton.type = "submit";
    okButton.value = "ok";
    okButton.className = "primary-button";
    okButton.textContent = this.copy.dialogs.buttons.ok;

    actions.append(okButton);
    form.append(heading, body, actions);
    dialog.append(form);
    this.root.append(dialog);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      dialog.close("ok");
    });
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    try {
      dialog.showModal();
    } catch (error) {
      console.error("Failed to show error dialog.", error);
      dialog.remove();
      return;
    }

    okButton.focus();
  }
}

type SaveTabResult = "saved" | "cancelled" | "failed";
interface SaveTabOptions {
  protectedTabIds?: ReadonlySet<string>;
}
type UnsavedChangeContext = "tab" | "window";
type UnsavedChangeDecision = "save" | "discard" | "cancel";
type SaveConflictDecision = "reload" | "save-as" | "overwrite" | "cancel";

interface OpenPathError {
  path: string;
  message: string;
}

interface OpenDocumentsAtPathsOptions {
  droppedPaths?: boolean;
}

interface ActiveDocumentStatsCache {
  tabId: string;
  contentVersion: number;
  stats: DocumentStats;
}

interface ActiveDocumentStatsRefreshTarget {
  tabId: string;
  contentVersion: number;
}

interface ActiveDocumentStatsScan {
  tabId: string;
  contentVersion: number;
  state: DocumentStatsScanState;
}

interface ActiveDocumentStatsMarkdownChange {
  previousMarkdown: string | null;
  previousStats: DocumentStats | null;
}

interface ActiveDocumentStatsCompletedScan {
  tabId: string;
  completedAt: number;
}

interface SavedMarkdownComparisonScan {
  tabId: string;
  contentVersion: number;
  markdown: string;
  lastSavedMarkdown: string;
  index: number;
}

function getPendingDocumentStats(markdown: string): DocumentStats {
  return {
    lines: 1,
    words: 0,
    characters: markdown.length,
  };
}

let nextDialogId = 1;

function nextDialogElementId(prefix: string): string {
  const id = `${prefix}-${nextDialogId}`;
  nextDialogId += 1;
  return id;
}

function waitForNextSavedMarkdownComparisonChunk(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function getUnsavedChangeDecision(value: string): UnsavedChangeDecision {
  if (value === "save" || value === "discard" || value === "cancel") {
    return value;
  }

  return "cancel";
}

function getSaveConflictDecision(value: string): SaveConflictDecision {
  if (
    value === "reload" ||
    value === "save-as" ||
    value === "overwrite" ||
    value === "cancel"
  ) {
    return value;
  }

  return "cancel";
}

function getSaveConflictMessage(
  tab: EditorTab,
  conflict: MarkdownFileSaveConflict,
  copy: AppCopy,
): string {
  return copy.dialogs.saveConflictMessage(tab.title, conflict.reason);
}

function getToolbarActionErrorTitle(action: ToolbarAction, copy: AppCopy): string {
  if (action === "open") {
    return copy.errors.openFailed;
  }

  if (action === "save" || action === "save-as") {
    return copy.errors.saveFailed;
  }

  if (action === "about") {
    return copy.errors.aboutFailed;
  }

  return copy.errors.taskFailed;
}

function getDetachedDocumentToken(search: string): string | null {
  const token = new URLSearchParams(search).get(DETACHED_DOCUMENT_QUERY_KEY);

  return token && token.trim().length > 0 ? token : null;
}

function createDetachedWindowHandoffToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `detached-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createDetachedWindowBroadcastHandoff(
  token: string,
  document: DetachedWindowDocumentTransfer,
): DetachedWindowBroadcastHandoff | null {
  const channel = createDetachedWindowBroadcastChannel();
  if (!channel) {
    return null;
  }

  let settled = false;
  let cleanupHandoff: () => void = () => {};
  const consumed = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("New window did not receive the document."));
    }, DETACHED_WINDOW_HANDOFF_CONSUMPTION_TIMEOUT_MS);

    const handleMessage = (event: MessageEvent<unknown>): void => {
      const message = parseDetachedWindowHandoffMessage(event.data);
      if (!message || message.token !== token) {
        return;
      }

      if (message.type === DETACHED_WINDOW_HANDOFF_REQUEST_MESSAGE) {
        channel.postMessage({
          type: DETACHED_WINDOW_HANDOFF_RESPONSE_MESSAGE,
          token,
          document,
        } satisfies DetachedWindowHandoffResponseMessage);
        return;
      }

      if (message.type === DETACHED_WINDOW_HANDOFF_CONSUMED_MESSAGE) {
        cleanup();
        resolve();
      }
    };

    const cleanup = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      channel.removeEventListener("message", handleMessage);
      channel.close();
    };
    cleanupHandoff = cleanup;

    channel.addEventListener("message", handleMessage);
  });

  return {
    consumed,
    dispose: () => cleanupHandoff(),
  };
}

async function requestDetachedWindowDocument(
  token: string,
): Promise<DetachedWindowDocument | null> {
  const channel = createDetachedWindowBroadcastChannel();
  if (!channel) {
    return null;
  }

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, DETACHED_WINDOW_HANDOFF_REQUEST_TIMEOUT_MS);

    const handleMessage = (event: MessageEvent<unknown>): void => {
      const message = parseDetachedWindowHandoffMessage(event.data);
      if (
        !message ||
        message.type !== DETACHED_WINDOW_HANDOFF_RESPONSE_MESSAGE ||
        message.token !== token
      ) {
        return;
      }

      channel.postMessage({
        type: DETACHED_WINDOW_HANDOFF_CONSUMED_MESSAGE,
        token,
      } satisfies DetachedWindowHandoffConsumedMessage);
      cleanup();
      resolve(createDetachedWindowDocumentFromTransfer(message.document));
    };

    const cleanup = (): void => {
      window.clearTimeout(timeout);
      channel.removeEventListener("message", handleMessage);
      channel.close();
    };

    channel.addEventListener("message", handleMessage);
    channel.postMessage({
      type: DETACHED_WINDOW_HANDOFF_REQUEST_MESSAGE,
      token,
    } satisfies DetachedWindowHandoffRequestMessage);
  });
}

function createDetachedWindowBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") {
    return null;
  }

  return new BroadcastChannel(DETACHED_WINDOW_HANDOFF_CHANNEL_NAME);
}

function parseDetachedWindowHandoffMessage(
  value: unknown,
): DetachedWindowHandoffMessage | null {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.token !== "string") {
    return null;
  }

  if (value.type === DETACHED_WINDOW_HANDOFF_REQUEST_MESSAGE) {
    return {
      type: DETACHED_WINDOW_HANDOFF_REQUEST_MESSAGE,
      token: value.token,
    };
  }

  if (value.type === DETACHED_WINDOW_HANDOFF_CONSUMED_MESSAGE) {
    return {
      type: DETACHED_WINDOW_HANDOFF_CONSUMED_MESSAGE,
      token: value.token,
    };
  }

  if (
    value.type === DETACHED_WINDOW_HANDOFF_RESPONSE_MESSAGE &&
    isDetachedWindowDocumentTransfer(value.document)
  ) {
    return {
      type: DETACHED_WINDOW_HANDOFF_RESPONSE_MESSAGE,
      token: value.token,
      document: value.document,
    };
  }

  return null;
}

function isDetachedWindowDocumentTransfer(
  value: unknown,
): value is DetachedWindowDocumentTransfer {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    (typeof value.filePath === "string" || value.filePath === null) &&
    typeof value.markdown === "string" &&
    typeof value.dirty === "boolean" &&
    hasValidDetachedWindowLastSavedMarkdown(value) &&
    typeof value.saveTargetDetached === "boolean"
  );
}

function hasValidDetachedWindowLastSavedMarkdown(
  value: Record<string, unknown>,
): boolean {
  if (value.lastSavedMarkdownMatchesMarkdown === true) {
    return (
      value.lastSavedMarkdown === undefined ||
      typeof value.lastSavedMarkdown === "string"
    );
  }

  return typeof value.lastSavedMarkdown === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return fallback;
}

function formatOpenPathErrors(errors: OpenPathError[], copy: AppCopy): string {
  const visibleErrors = errors.slice(0, 5).map((error) => {
    return `${getPathLabel(error.path)}: ${error.message}`;
  });
  const hiddenCount = errors.length - visibleErrors.length;
  const suffix = hiddenCount > 0 ? copy.errors.moreErrorsSuffix(hiddenCount) : "";

  return `${visibleErrors.join(" / ")}${suffix}`;
}

function getPathLabel(path: string): string {
  const trimmedPath = path.replace(/[\\/]+$/u, "");
  const segments = trimmedPath.split(/[\\/]/u);

  return segments[segments.length - 1] || path;
}

function createEditorContextMenuItems(
  hasSelection: boolean,
  copy: AppCopy["editorContextMenu"],
): EditorContextMenuEntry[] {
  return [
    { type: "item", action: "undo", label: copy.undo, shortcut: "Ctrl+Z" },
    { type: "item", action: "redo", label: copy.redo, shortcut: "Ctrl+Y" },
    { type: "separator" },
    {
      type: "item",
      action: "cut",
      label: copy.cut,
      shortcut: "Ctrl+X",
      disabled: !hasSelection,
    },
    {
      type: "item",
      action: "copy",
      label: copy.copy,
      shortcut: "Ctrl+C",
      disabled: !hasSelection,
    },
    { type: "item", action: "paste", label: copy.paste, shortcut: "Ctrl+V" },
    { type: "item", action: "select-all", label: copy.selectAll, shortcut: "Ctrl+A" },
    { type: "separator" },
    { type: "item", action: "bold", label: copy.bold, shortcut: "Ctrl+B" },
    { type: "item", action: "italic", label: copy.italic, shortcut: "Ctrl+I" },
    { type: "item", action: "inline-code", label: copy.inlineCode },
  ];
}

function isMarkdownEditorContextCommand(action: string): action is MarkdownEditorContextCommand {
  return MARKDOWN_EDITOR_CONTEXT_COMMANDS.includes(action as MarkdownEditorContextCommand);
}
