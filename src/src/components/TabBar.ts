import {
  getTabDisplayTitle,
  getTabTooltipText,
  type EditorTab,
} from "../app/document-state";
import type { AppCopy } from "../app/i18n";

const TAB_TOOLTIP_VIEWPORT_MARGIN_PX = 8;
const TAB_TOOLTIP_OFFSET_PX = 6;

let nextTabTooltipId = 1;

export interface TabBarProps {
  tabs: EditorTab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void | Promise<void>;
  onCloseError?: (error: unknown) => void;
  onContextMenu: (request: TabContextMenuRequest) => void;
  copy: AppCopy["tabBar"];
}

export interface TabContextMenuRequest {
  tabId: string;
  x: number;
  y: number;
}

export function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCloseError,
  onContextMenu,
  copy,
}: TabBarProps): HTMLElement {
  const tabBar = document.createElement("nav");
  tabBar.className = "tab-bar";
  tabBar.setAttribute("data-region", "tabs");
  tabBar.setAttribute("aria-label", copy.ariaLabel);

  let tooltipElement: HTMLDivElement | null = null;
  let tooltipTarget: HTMLButtonElement | null = null;

  const hideTooltip = (): void => {
    tooltipTarget?.removeAttribute("aria-describedby");
    tooltipTarget = null;
    tooltipElement?.remove();
    tooltipElement = null;
  };

  const showTooltip = (tabButton: HTMLButtonElement): void => {
    const tooltipText = tabButton.dataset.tooltipText;
    if (!tooltipText) {
      hideTooltip();
      return;
    }

    if (!tooltipElement) {
      tooltipElement = document.createElement("div");
      tooltipElement.id = `tab-tooltip-${nextTabTooltipId}`;
      nextTabTooltipId += 1;
      tooltipElement.className = "tab-bar__tooltip";
      tooltipElement.setAttribute("role", "tooltip");
      tabBar.append(tooltipElement);
    }

    if (tooltipTarget !== tabButton) {
      tooltipTarget?.removeAttribute("aria-describedby");
      tooltipTarget = tabButton;
      tabButton.setAttribute("aria-describedby", tooltipElement.id);
    }

    tooltipElement.textContent = tooltipText;
    tooltipElement.hidden = false;
    positionTabTooltip(tabButton, tooltipElement);
  };

  tabBar.addEventListener("pointerover", (event) => {
    const tabButton = getTabTooltipTarget(event.target, tabBar);
    if (tabButton) {
      showTooltip(tabButton);
    }
  });

  tabBar.addEventListener("pointerout", (event) => {
    if (!tooltipTarget) {
      return;
    }

    if (event.relatedTarget instanceof Node && tooltipTarget.contains(event.relatedTarget)) {
      return;
    }

    const tabButton = getTabTooltipTarget(event.target, tabBar);
    if (tabButton === tooltipTarget) {
      hideTooltip();
    }
  });

  tabBar.addEventListener("focusin", (event) => {
    const tabButton = getTabTooltipTarget(event.target, tabBar);
    if (tabButton) {
      showTooltip(tabButton);
    }
  });

  tabBar.addEventListener("focusout", (event) => {
    if (event.target === tooltipTarget) {
      hideTooltip();
    }
  });

  tabBar.addEventListener("scroll", () => hideTooltip());
  tabBar.addEventListener("contextmenu", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const tabItem = target.closest<HTMLElement>(".tab-bar__item");
    if (!tabItem || !tabBar.contains(tabItem) || !tabItem.dataset.tabId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    hideTooltip();
    onContextMenu({
      tabId: tabItem.dataset.tabId,
      x: event.clientX,
      y: event.clientY,
    });
  });
  tabBar.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const closeButton = target.closest<HTMLButtonElement>(".tab-bar__close");
    if (closeButton && tabBar.contains(closeButton)) {
      event.stopPropagation();
      hideTooltip();
      const tabId = closeButton.closest<HTMLElement>(".tab-bar__item")?.dataset.tabId;
      if (tabId) {
        try {
          void Promise.resolve(onClose(tabId)).catch((error: unknown) => {
            onCloseError?.(error);
          });
        } catch (error) {
          onCloseError?.(error);
        }
      }
      return;
    }

    const tabButton = target.closest<HTMLButtonElement>(".tab-bar__tab");
    if (tabButton && tabBar.contains(tabButton) && tabButton.dataset.tabId) {
      onSelect(tabButton.dataset.tabId);
    }
  });

  for (const tab of tabs) {
    const tabItem = document.createElement("div");
    tabItem.className = "tab-bar__item";
    tabItem.dataset.tabId = tab.id;

    const tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.className = "tab-bar__tab";
    tabButton.dataset.tabId = tab.id;
    tabButton.setAttribute("aria-selected", String(tab.id === activeTabId));
    tabButton.dataset.tooltipText = getTabTooltipText(tab);
    tabButton.textContent = getTabDisplayTitle(tab);
    if (tab.id === activeTabId) {
      tabButton.classList.add("is-active");
    }
    if (tab.dirty) {
      tabButton.classList.add("is-dirty");
    }

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "tab-bar__close";
    closeButton.setAttribute("aria-label", copy.closeTabAriaLabel(tab.title));
    closeButton.textContent = "x";

    tabItem.append(tabButton, closeButton);
    tabBar.append(tabItem);
  }

  return tabBar;
}

function getTabTooltipTarget(
  target: EventTarget | null,
  tabBar: HTMLElement,
): HTMLButtonElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const tabButton = target.closest<HTMLButtonElement>(".tab-bar__tab");
  return tabButton && tabBar.contains(tabButton) ? tabButton : null;
}

function positionTabTooltip(
  tabButton: HTMLButtonElement,
  tooltipElement: HTMLElement,
): void {
  const buttonRect = tabButton.getBoundingClientRect();
  const tooltipRect = tooltipElement.getBoundingClientRect();
  const maxRight = window.innerWidth - TAB_TOOLTIP_VIEWPORT_MARGIN_PX;
  const maxBottom = window.innerHeight - TAB_TOOLTIP_VIEWPORT_MARGIN_PX;
  let left = buttonRect.left;
  let top = buttonRect.bottom + TAB_TOOLTIP_OFFSET_PX;

  if (left + tooltipRect.width > maxRight) {
    left = Math.max(TAB_TOOLTIP_VIEWPORT_MARGIN_PX, maxRight - tooltipRect.width);
  }

  if (top + tooltipRect.height > maxBottom) {
    top = Math.max(
      TAB_TOOLTIP_VIEWPORT_MARGIN_PX,
      buttonRect.top - tooltipRect.height - TAB_TOOLTIP_OFFSET_PX,
    );
  }

  tooltipElement.style.left = `${Math.round(left)}px`;
  tooltipElement.style.top = `${Math.round(top)}px`;
}
