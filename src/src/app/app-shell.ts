import { StatusBar } from "../components/StatusBar";
import { TabBar } from "../components/TabBar";
import { Toolbar, type ToolbarAction } from "../components/Toolbar";
import {
  getMarkdownEditorTheme,
  type MarkdownEditorThemeId,
} from "../components/milkdown-themes";
import type { DocumentStats, EditorTab } from "./document-state";
import type { AppCopy, UiLanguage } from "./i18n";

export type { ToolbarAction };

export interface AppChromeOptions {
  activeTab: EditorTab;
  tabs: EditorTab[];
  activeTabId: string;
  themeId: MarkdownEditorThemeId;
  languageId: UiLanguage;
  copy: AppCopy;
  stats: DocumentStats;
  onToolbarAction: (action: ToolbarAction) => void;
  onThemeChange: (themeId: MarkdownEditorThemeId) => void;
  onLanguageChange: (languageId: UiLanguage) => void;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onTabContextMenu: (tabId: string, x: number, y: number) => void;
}

export interface AppShellOptions extends AppChromeOptions {
  editorElement: HTMLElement;
}

export interface AppChromeElements {
  toolbarElement: HTMLElement;
  tabBarElement: HTMLElement;
  statusBarElement: HTMLElement;
}

export interface AppShellElements extends AppChromeElements {
  shellElement: HTMLElement;
}

export interface AppStatusBarOptions {
  activeTab: EditorTab;
  tabCount: number;
  stats: DocumentStats;
  copy: AppCopy["status"];
}

export function createAppShell(options: AppShellOptions): AppShellElements {
  const shellElement = document.createElement("main");
  shellElement.className = "app-shell";
  shellElement.dataset.editorThemeId = options.themeId;
  shellElement.dataset.editorThemeMode = getMarkdownEditorTheme(options.themeId).isDark
    ? "dark"
    : "light";

  const chrome = createAppChrome(options);
  shellElement.append(
    chrome.toolbarElement,
    chrome.tabBarElement,
    options.editorElement,
    chrome.statusBarElement,
  );

  return {
    shellElement,
    ...chrome,
  };
}

export function createAppChrome(options: AppChromeOptions): AppChromeElements {
  return {
    toolbarElement: createAppToolbar(options),
    tabBarElement: createAppTabBar(options),
    statusBarElement: createAppStatusBar({
      activeTab: options.activeTab,
      tabCount: options.tabs.length,
      stats: options.stats,
      copy: options.copy.status,
    }),
  };
}

export function createAppStatusBar(options: AppStatusBarOptions): HTMLElement {
  return StatusBar({
    activeTab: options.activeTab,
    tabCount: options.tabCount,
    stats: options.stats,
    copy: options.copy,
  });
}

function createAppToolbar(options: AppChromeOptions): HTMLElement {
  return Toolbar({
    hasActiveTab: Boolean(options.activeTab),
    themeId: options.themeId,
    languageId: options.languageId,
    copy: options.copy.toolbar,
    onAction: options.onToolbarAction,
    onThemeChange: options.onThemeChange,
    onLanguageChange: options.onLanguageChange,
  });
}

function createAppTabBar(options: AppChromeOptions): HTMLElement {
  return TabBar({
    tabs: options.tabs,
    activeTabId: options.activeTabId,
    onSelect: options.onSelectTab,
    onClose: options.onCloseTab,
    onContextMenu: ({ tabId, x, y }) => options.onTabContextMenu(tabId, x, y),
    copy: options.copy.tabBar,
  });
}
