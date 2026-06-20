import {
  isMarkdownEditorThemeId,
  markdownEditorThemes,
  type MarkdownEditorThemeId,
} from "./milkdown-themes";
import {
  isUiLanguage,
  supportedUiLanguages,
  type AppCopy,
  type UiLanguage,
} from "../app/i18n";

export type ToolbarAction = "new" | "open" | "save" | "save-as" | "about";

export interface ToolbarProps {
  hasActiveTab: boolean;
  themeId: MarkdownEditorThemeId;
  languageId: UiLanguage;
  copy: AppCopy["toolbar"];
  onAction: (action: ToolbarAction) => void | Promise<void>;
  onThemeChange: (themeId: MarkdownEditorThemeId) => void;
  onLanguageChange: (languageId: UiLanguage) => void;
}

const documentToolbarActionIds: ToolbarAction[] = [
  "new",
  "open",
  "save",
  "save-as",
];

export function Toolbar({
  hasActiveTab,
  themeId,
  languageId,
  copy,
  onAction,
  onThemeChange,
  onLanguageChange,
}: ToolbarProps): HTMLElement {
  const toolbar = document.createElement("header");
  toolbar.className = "toolbar";
  toolbar.setAttribute("data-region", "toolbar");

  const group = document.createElement("div");
  group.className = "toolbar__group";

  for (const actionId of documentToolbarActionIds) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toolbar__button";
    button.textContent = getToolbarActionLabel(actionId, copy);
    button.dataset.action = actionId;
    button.disabled = !hasActiveTab && actionId !== "new";
    button.addEventListener("click", () => {
      void Promise.resolve(onAction(actionId)).catch((error: unknown) => {
        console.error("Toolbar action failed.", error);
      });
    });
    group.append(button);
  }

  const settingsGroup = document.createElement("div");
  settingsGroup.className = "toolbar__settings";

  const themeLabel = document.createElement("label");
  themeLabel.className = "toolbar__setting-label toolbar__theme-label";
  themeLabel.textContent = copy.themeLabel;

  const themeSelect = document.createElement("select");
  themeSelect.className = "toolbar__setting-select toolbar__theme-select";
  themeSelect.setAttribute("aria-label", copy.themeAriaLabel);
  themeSelect.dataset.editorThemeSelector = "true";

  for (const theme of markdownEditorThemes) {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.label;
    option.selected = theme.id === themeId;
    themeSelect.append(option);
  }

  themeSelect.addEventListener("change", () => {
    const nextThemeId = themeSelect.value;

    if (isMarkdownEditorThemeId(nextThemeId)) {
      onThemeChange(nextThemeId);
    }
  });

  const languageLabel = document.createElement("label");
  languageLabel.className = "toolbar__setting-label toolbar__language-label";
  languageLabel.textContent = copy.languageLabel;

  const languageSelect = document.createElement("select");
  languageSelect.className = "toolbar__setting-select toolbar__language-select";
  languageSelect.setAttribute("aria-label", copy.languageAriaLabel);
  languageSelect.dataset.uiLanguageSelector = "true";

  for (const language of supportedUiLanguages) {
    const option = document.createElement("option");
    option.value = language.id;
    option.textContent = language.label;
    option.selected = language.id === languageId;
    languageSelect.append(option);
  }

  languageSelect.addEventListener("change", () => {
    const nextLanguageId = languageSelect.value;

    if (isUiLanguage(nextLanguageId)) {
      onLanguageChange(nextLanguageId);
    }
  });

  settingsGroup.append(themeLabel, themeSelect, languageLabel, languageSelect);

  const aboutButton = document.createElement("button");
  aboutButton.type = "button";
  aboutButton.className = "toolbar__button";
  aboutButton.textContent = copy.actions.about;
  aboutButton.dataset.action = "about";
  aboutButton.addEventListener("click", () => {
    void Promise.resolve(onAction("about")).catch((error: unknown) => {
      console.error("Toolbar action failed.", error);
    });
  });

  const actionsAndSettings = document.createElement("div");
  actionsAndSettings.className = "toolbar__right";
  actionsAndSettings.append(settingsGroup, aboutButton);

  toolbar.append(group, actionsAndSettings);
  return toolbar;
}

function getToolbarActionLabel(action: ToolbarAction, copy: AppCopy["toolbar"]): string {
  if (action === "new") {
    return copy.actions.new;
  }

  if (action === "open") {
    return copy.actions.open;
  }

  if (action === "save") {
    return copy.actions.save;
  }

  if (action === "save-as") {
    return copy.actions.saveAs;
  }

  return copy.actions.about;
}
