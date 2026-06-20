export interface EditorContextMenuItem {
  type: "item";
  action: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
}

export interface EditorContextMenuSeparator {
  type: "separator";
}

export type EditorContextMenuEntry = EditorContextMenuItem | EditorContextMenuSeparator;

export interface EditorContextMenuProps {
  items: EditorContextMenuEntry[];
  x: number;
  y: number;
  ariaLabel?: string;
  className?: string;
  onAction: (action: string) => void | Promise<void>;
  onDismiss: () => void;
}

export interface EditorContextMenuHandle {
  element: HTMLElement;
  focusFirstItem: () => void;
  positionInViewport: () => void;
}

export function EditorContextMenu({
  items,
  x,
  y,
  ariaLabel = "Edit menu",
  className,
  onAction,
  onDismiss,
}: EditorContextMenuProps): EditorContextMenuHandle {
  const menu = document.createElement("div");
  menu.className = "editor-context-menu";
  if (className) {
    menu.classList.add(...className.split(/\s+/u).filter(Boolean));
  }
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", ariaLabel);
  menu.tabIndex = -1;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  for (const entry of items) {
    if (entry.type === "separator") {
      const separator = document.createElement("div");
      separator.className = "editor-context-menu__separator";
      separator.setAttribute("role", "separator");
      menu.append(separator);
      continue;
    }

    const item = document.createElement("button");
    item.type = "button";
    item.className = "editor-context-menu__item";
    item.dataset.contextAction = entry.action;
    item.disabled = Boolean(entry.disabled);
    item.setAttribute("role", "menuitem");

    const label = document.createElement("span");
    label.className = "editor-context-menu__label";
    label.textContent = entry.label;
    item.append(label);

    if (entry.shortcut) {
      const shortcut = document.createElement("span");
      shortcut.className = "editor-context-menu__shortcut";
      shortcut.textContent = entry.shortcut;
      item.append(shortcut);
    }

    item.addEventListener("click", () => {
      if (item.disabled) {
        return;
      }

      onDismiss();
      void Promise.resolve()
        .then(() => onAction(entry.action))
        .catch((error: unknown) => {
          console.error("Editor context menu action failed.", error);
        });
    });

    menu.append(item);
  }

  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onDismiss();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "Tab") {
      event.preventDefault();
      focusMenuItem(menu, event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItem(menu, -1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusMenuItemAt(menu, 0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusMenuItemAt(menu, -1);
    }
  });

  menu.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!menu.contains(document.activeElement)) {
        onDismiss();
      }
    }, 0);
  });

  return {
    element: menu,
    focusFirstItem: () => focusMenuItemAt(menu, 0),
    positionInViewport: () => positionMenuInViewport(menu, x, y),
  };
}

function getEnabledMenuItems(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>(".editor-context-menu__item")).filter(
    (item) => !item.disabled,
  );
}

function focusMenuItem(menu: HTMLElement, direction: 1 | -1): void {
  const items = getEnabledMenuItems(menu);

  if (items.length === 0) {
    menu.focus({ preventScroll: true });
    return;
  }

  const activeIndex = items.findIndex((item) => item === document.activeElement);
  const currentIndex = activeIndex >= 0 ? activeIndex : direction > 0 ? -1 : 0;
  const nextIndex = (currentIndex + direction + items.length) % items.length;
  items[nextIndex].focus({ preventScroll: true });
}

function focusMenuItemAt(menu: HTMLElement, index: number): void {
  const items = getEnabledMenuItems(menu);
  const item = index < 0 ? items[items.length - 1] : items[index];
  item?.focus({ preventScroll: true });
}

function positionMenuInViewport(menu: HTMLElement, x: number, y: number): void {
  const margin = 6;
  const rect = menu.getBoundingClientRect();
  const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin));
  const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin));

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}
