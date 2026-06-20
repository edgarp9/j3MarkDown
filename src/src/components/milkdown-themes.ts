import classicThemeUrl from "@milkdown/crepe/theme/classic.css?url";
import classicDarkThemeUrl from "@milkdown/crepe/theme/classic-dark.css?url";
import nordDarkThemeUrl from "@milkdown/crepe/theme/nord-dark.css?url";

export interface MarkdownEditorTheme {
  id: MarkdownEditorThemeId;
  label: string;
  cssUrl: string;
  isDark: boolean;
  useMilkdownNord: boolean;
  cssVariables?: ThemeCssVariables;
}

type ThemeCssVariables = Readonly<Record<`--${string}`, string>>;

export type MarkdownEditorThemeId =
  | "classic"
  | "classic-dark"
  | "nord-dark"
  | "lagoon"
  | "lagoon-dark"
  | "berry"
  | "berry-dark";

export const markdownEditorThemes: readonly MarkdownEditorTheme[] = [
  {
    id: "classic",
    label: "Classic",
    cssUrl: classicThemeUrl,
    isDark: false,
    useMilkdownNord: false,
  },
  {
    id: "classic-dark",
    label: "Classic Dark",
    cssUrl: classicDarkThemeUrl,
    isDark: true,
    useMilkdownNord: false,
  },
  {
    id: "nord-dark",
    label: "Nord Dark",
    cssUrl: nordDarkThemeUrl,
    isDark: true,
    useMilkdownNord: true,
  },
  {
    id: "lagoon",
    label: "Lagoon",
    cssUrl: classicThemeUrl,
    isDark: false,
    useMilkdownNord: false,
    cssVariables: {
      "--crepe-color-background": "#f5fbfb",
      "--crepe-color-on-background": "#152527",
      "--crepe-color-surface": "#ffffff",
      "--crepe-color-surface-low": "#e8f4f5",
      "--crepe-color-on-surface": "#152527",
      "--crepe-color-on-surface-variant": "#526367",
      "--crepe-color-outline": "#b7c8cc",
      "--crepe-color-primary": "#087f8c",
      "--crepe-color-on-primary": "#ffffff",
      "--crepe-color-secondary": "#6b5b95",
      "--crepe-color-on-secondary": "#ffffff",
      "--crepe-color-inverse": "#203436",
      "--crepe-color-on-inverse": "#edfafa",
      "--crepe-color-inline-code": "#136f63",
      "--crepe-color-error": "#b42318",
      "--crepe-color-hover": "#e2f1f2",
      "--crepe-color-selected": "#cce8eb",
    },
  },
  {
    id: "lagoon-dark",
    label: "Lagoon Dark",
    cssUrl: classicDarkThemeUrl,
    isDark: true,
    useMilkdownNord: false,
    cssVariables: {
      "--crepe-color-background": "#0e1718",
      "--crepe-color-on-background": "#e3f2f3",
      "--crepe-color-surface": "#162426",
      "--crepe-color-surface-low": "#213235",
      "--crepe-color-on-surface": "#e3f2f3",
      "--crepe-color-on-surface-variant": "#b5cace",
      "--crepe-color-outline": "#435a5f",
      "--crepe-color-primary": "#58b6bf",
      "--crepe-color-on-primary": "#062225",
      "--crepe-color-secondary": "#d68ac8",
      "--crepe-color-on-secondary": "#2b0c26",
      "--crepe-color-inverse": "#edfafa",
      "--crepe-color-on-inverse": "#102426",
      "--crepe-color-inline-code": "#91d6cf",
      "--crepe-color-error": "#ffb4ab",
      "--crepe-color-hover": "#223538",
      "--crepe-color-selected": "#2e474c",
    },
  },
  {
    id: "berry",
    label: "Berry",
    cssUrl: classicThemeUrl,
    isDark: false,
    useMilkdownNord: false,
    cssVariables: {
      "--crepe-color-background": "#fff7fa",
      "--crepe-color-on-background": "#2a1a1f",
      "--crepe-color-surface": "#ffffff",
      "--crepe-color-surface-low": "#faedf2",
      "--crepe-color-on-surface": "#2a1a1f",
      "--crepe-color-on-surface-variant": "#69565d",
      "--crepe-color-outline": "#d3b9c2",
      "--crepe-color-primary": "#be3455",
      "--crepe-color-on-primary": "#ffffff",
      "--crepe-color-secondary": "#4d7c89",
      "--crepe-color-on-secondary": "#ffffff",
      "--crepe-color-inverse": "#3a2b31",
      "--crepe-color-on-inverse": "#fff1f5",
      "--crepe-color-inline-code": "#a33d67",
      "--crepe-color-error": "#b42318",
      "--crepe-color-hover": "#f6e4eb",
      "--crepe-color-selected": "#efcfdb",
    },
  },
  {
    id: "berry-dark",
    label: "Berry Dark",
    cssUrl: classicDarkThemeUrl,
    isDark: true,
    useMilkdownNord: false,
    cssVariables: {
      "--crepe-color-background": "#1d1317",
      "--crepe-color-on-background": "#f8e8ed",
      "--crepe-color-surface": "#281a20",
      "--crepe-color-surface-low": "#34232a",
      "--crepe-color-on-surface": "#f8e8ed",
      "--crepe-color-on-surface-variant": "#d6bcc6",
      "--crepe-color-outline": "#644b55",
      "--crepe-color-primary": "#e0718b",
      "--crepe-color-on-primary": "#3b0715",
      "--crepe-color-secondary": "#79b8c6",
      "--crepe-color-on-secondary": "#06242b",
      "--crepe-color-inverse": "#fff1f5",
      "--crepe-color-on-inverse": "#2b171e",
      "--crepe-color-inline-code": "#f2aac7",
      "--crepe-color-error": "#ffb4ab",
      "--crepe-color-hover": "#3a252d",
      "--crepe-color-selected": "#51333e",
    },
  },
] as const;

export const defaultMarkdownEditorThemeId: MarkdownEditorThemeId = "classic";

let activeThemeLink: HTMLLinkElement | null = null;
let activeThemeStyle: HTMLStyleElement | null = null;

export function getMarkdownEditorTheme(themeId: MarkdownEditorThemeId): MarkdownEditorTheme {
  const theme = markdownEditorThemes.find((candidate) => candidate.id === themeId);

  if (!theme) {
    return markdownEditorThemes[0];
  }

  return theme;
}

export function isMarkdownEditorThemeId(value: string): value is MarkdownEditorThemeId {
  return markdownEditorThemes.some((theme) => theme.id === value);
}

export function applyMilkdownThemeStyles(themeId: MarkdownEditorThemeId): void {
  const theme = getMarkdownEditorTheme(themeId);

  if (!activeThemeLink) {
    activeThemeLink = document.createElement("link");
    activeThemeLink.rel = "stylesheet";
    activeThemeLink.dataset.milkdownTheme = "true";
    document.head.append(activeThemeLink);
  }

  if (activeThemeLink.href !== new URL(theme.cssUrl, document.baseURI).href) {
    activeThemeLink.href = theme.cssUrl;
  }

  if (!activeThemeStyle) {
    activeThemeStyle = document.createElement("style");
    activeThemeStyle.dataset.milkdownThemeOverrides = "true";
    document.head.append(activeThemeStyle);
  }

  activeThemeStyle.textContent = createThemeOverrideCss(theme);
}

function createThemeOverrideCss(theme: MarkdownEditorTheme): string {
  if (!theme.cssVariables) {
    return "";
  }

  const variableDeclarations = Object.entries(theme.cssVariables)
    .map(([property, value]) => `  ${property}: ${value};`)
    .join("\n");
  const selector = [
    `.markdown-editor[data-editor-theme-id="${theme.id}"]`,
    `.markdown-editor[data-editor-theme-id="${theme.id}"] .milkdown`,
    `.markdown-editor[data-editor-theme-id="${theme.id}"] .ProseMirror`,
  ].join(",\n");

  return `${selector} {\n${variableDeclarations}\n}`;
}
