import { invoke } from "@tauri-apps/api/core";

export interface AboutInfo {
  version: string;
  githubUrl: string;
}

type AppInfoIpcContract = {
  get_about_info: IpcCommandEntry<AboutInfo>;
  open_about_link: IpcCommandEntry<void>;
};

type IpcCommandEntry<Response, Args = undefined> = {
  args: Args;
  response: Response;
};

type AppInfoCommandName = keyof AppInfoIpcContract;
type AppInfoCommandArgs<Command extends AppInfoCommandName> =
  AppInfoIpcContract[Command]["args"];
type AppInfoInvokeArgs<Command extends AppInfoCommandName> =
  AppInfoCommandArgs<Command> extends undefined
    ? []
    : [args: AppInfoCommandArgs<Command>];
type TauriInvokeArgs = Parameters<typeof invoke>[1];

const ipcCommands = {
  get_about_info: "get_about_info",
  open_about_link: "open_about_link",
} as const satisfies { [Command in AppInfoCommandName]: Command };

export function getAboutInfo(): Promise<AboutInfo> {
  return invokeAppInfoCommand(ipcCommands.get_about_info);
}

export function openAboutLink(): Promise<void> {
  return invokeAppInfoCommand(ipcCommands.open_about_link);
}

function invokeAppInfoCommand<Command extends AppInfoCommandName>(
  command: Command,
  ...args: AppInfoInvokeArgs<Command>
): Promise<AppInfoIpcContract[Command]["response"]> {
  return invoke<AppInfoIpcContract[Command]["response"]>(
    command,
    args[0] as TauriInvokeArgs,
  );
}
