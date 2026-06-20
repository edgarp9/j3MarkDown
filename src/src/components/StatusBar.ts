import type { DocumentStats, EditorTab } from "../app/document-state";
import type { AppCopy } from "../app/i18n";

export interface StatusBarProps {
  activeTab: EditorTab;
  tabCount: number;
  stats: DocumentStats;
  copy: AppCopy["status"];
}

export function StatusBar({
  activeTab,
  tabCount,
  stats,
  copy,
}: StatusBarProps): HTMLElement {
  const status = document.createElement("footer");
  status.className = "status-bar";
  status.setAttribute("data-region", "status");

  const fileLabel = activeTab.filePath ?? copy.untitled;
  const dirtyLabel = activeTab.dirty ? copy.dirty : copy.saved;
  const updatedAt = activeTab.updatedAt.toLocaleTimeString(copy.timeLocale, {
    hour: "2-digit",
    minute: "2-digit",
  });

  status.append(
    createStatusItem(fileLabel),
    createStatusItem(copy.tabs(tabCount)),
    createStatusItem(dirtyLabel),
    createStatusItem(copy.lines(stats.lines)),
    createStatusItem(copy.words(stats.words)),
    createStatusItem(copy.characters(stats.characters)),
    createStatusItem(copy.modified(updatedAt)),
  );

  return status;
}

function createStatusItem(text: string): HTMLElement {
  const item = document.createElement("span");
  item.className = "status-bar__item";
  item.textContent = text;
  return item;
}
