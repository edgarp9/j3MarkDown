import { invoke } from "@tauri-apps/api/core";
import {
  defaultMarkdownEditorThemeId,
  isMarkdownEditorThemeId,
  type MarkdownEditorThemeId,
} from "../components/milkdown-themes";
import { defaultUiLanguage, isUiLanguage, type UiLanguage } from "./i18n";
import { startStartupSpan } from "./startup-profile";

type AppSettingsIpcContract = {
  read_editor_theme_setting: IpcCommandEntry<string>;
  save_editor_theme_setting: IpcCommandEntry<void, { themeId: MarkdownEditorThemeId }>;
  read_ui_language_setting: IpcCommandEntry<string>;
  save_ui_language_setting: IpcCommandEntry<void, { languageId: UiLanguage }>;
};

type IpcCommandEntry<Response, Args = undefined> = {
  args: Args;
  response: Response;
};

type AppSettingsCommandName = keyof AppSettingsIpcContract;
type AppSettingsStringReadCommandName = {
  [Command in AppSettingsCommandName]: AppSettingsIpcContract[Command]["response"] extends string
    ? Command
    : never;
}[AppSettingsCommandName];
type AppSettingsCommandArgs<Command extends AppSettingsCommandName> =
  AppSettingsIpcContract[Command]["args"];
type AppSettingsInvokeArgs<Command extends AppSettingsCommandName> =
  AppSettingsCommandArgs<Command> extends undefined
    ? []
    : [args: AppSettingsCommandArgs<Command>];
type TauriInvokeArgs = Parameters<typeof invoke>[1];

const ipcCommands = {
  read_editor_theme_setting: "read_editor_theme_setting",
  save_editor_theme_setting: "save_editor_theme_setting",
  read_ui_language_setting: "read_ui_language_setting",
  save_ui_language_setting: "save_ui_language_setting",
} as const satisfies { [Command in AppSettingsCommandName]: Command };

export async function loadEditorThemeSetting(): Promise<MarkdownEditorThemeId> {
  const finishEditorThemeRead = startStartupSpan("read editor theme setting IPC");
  try {
    return await loadValidatedAppSetting(
      ipcCommands.read_editor_theme_setting,
      isMarkdownEditorThemeId,
      defaultMarkdownEditorThemeId,
      "Editor theme setting could not be loaded.",
    );
  } finally {
    finishEditorThemeRead();
  }
}

export async function saveEditorThemeSetting(
  themeId: MarkdownEditorThemeId,
): Promise<void> {
  await invokeAppSettingsCommand(ipcCommands.save_editor_theme_setting, { themeId });
}

export async function loadUiLanguageSetting(): Promise<UiLanguage> {
  const finishUiLanguageRead = startStartupSpan("read UI language setting IPC");
  try {
    return await loadValidatedAppSetting(
      ipcCommands.read_ui_language_setting,
      isUiLanguage,
      defaultUiLanguage,
      "UI language setting could not be loaded.",
    );
  } finally {
    finishUiLanguageRead();
  }
}

export async function saveUiLanguageSetting(languageId: UiLanguage): Promise<void> {
  await invokeAppSettingsCommand(ipcCommands.save_ui_language_setting, { languageId });
}

async function loadValidatedAppSetting<Setting extends string>(
  command: AppSettingsStringReadCommandName,
  isValidSetting: (value: string) => value is Setting,
  defaultSetting: Setting,
  warningMessage: string,
): Promise<Setting> {
  try {
    const storedSetting = await invokeAppSettingsCommand(command);

    if (storedSetting && isValidSetting(storedSetting)) {
      return storedSetting;
    }
  } catch (error) {
    console.warn(warningMessage, error);
  }

  return defaultSetting;
}

function invokeAppSettingsCommand<Command extends AppSettingsCommandName>(
  command: Command,
  ...args: AppSettingsInvokeArgs<Command>
): Promise<AppSettingsIpcContract[Command]["response"]> {
  return invoke<AppSettingsIpcContract[Command]["response"]>(
    command,
    args[0] as TauriInvokeArgs,
  );
}
