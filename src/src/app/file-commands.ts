import { invoke } from "@tauri-apps/api/core";

type IpcCommandEntry<Response, Args = undefined> = {
  args: Args;
  response: Response;
};

export interface OpenedMarkdownFile {
  path: string;
  title: string;
  content: string;
  fileFingerprint: string;
}

export interface SavedMarkdownFile {
  path: string;
  title: string;
  fileFingerprint: string;
}

export type SaveConflictReason = "modified" | "deleted";

export interface MarkdownFileSaveConflict {
  path: string;
  reason: SaveConflictReason;
}

export type MarkdownFileSaveResult =
  | {
      status: "saved";
      file: SavedMarkdownFile;
      conflict: null;
    }
  | {
      status: "conflict";
      file: null;
      conflict: MarkdownFileSaveConflict;
    };

type MarkdownFileSaveCommandResponse =
  | MarkdownFileSaveResult
  | SavedMarkdownFile;

export interface SaveMarkdownFileOptions {
  expectedFileFingerprint?: string | null;
  allowExternalOverwrite?: boolean;
}

export interface DetachedWindowDocument {
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

export interface OpenedMarkdownFileAtPathResult {
  path: string;
  file: OpenedMarkdownFile | null;
  error: string | null;
}

export type MarkdownFileIpcContract = {
  get_launch_paths: IpcCommandEntry<string[]>;
  open_markdown_file: IpcCommandEntry<OpenedMarkdownFile | null>;
  open_markdown_file_at_path: IpcCommandEntry<OpenedMarkdownFile, { path: string }>;
  open_markdown_files_at_paths: IpcCommandEntry<
    OpenedMarkdownFileAtPathResult[],
    { paths: string[]; droppedPaths?: boolean }
  >;
  open_markdown_document_in_new_window: IpcCommandEntry<
    void,
    { document: DetachedWindowDocument }
  >;
  complete_detached_window_broadcast_handoff: IpcCommandEntry<
    void,
    { token: string }
  >;
  take_detached_window_document: IpcCommandEntry<
    DetachedWindowDocument | null,
    { token: string }
  >;
  save_markdown_file: IpcCommandEntry<
    MarkdownFileSaveCommandResponse,
    {
      path: string;
      content: string;
      expectedFileFingerprint: string | null;
      allowExternalOverwrite?: boolean;
    }
  >;
  select_markdown_save_path: IpcCommandEntry<
    string | null,
    { suggestedPath: string | null }
  >;
  save_markdown_file_as: IpcCommandEntry<
    MarkdownFileSaveCommandResponse | null,
    {
      suggestedPath: string | null;
      content: string;
      expectedFileFingerprint: string | null;
      allowExternalOverwrite?: boolean;
    }
  >;
};

type AppCommandName = keyof MarkdownFileIpcContract;
type AppCommandArgs<Command extends AppCommandName> =
  MarkdownFileIpcContract[Command]["args"];
type AppInvokeArgs<Command extends AppCommandName> =
  AppCommandArgs<Command> extends undefined
    ? []
    : [args: AppCommandArgs<Command>];
type TauriInvokeArgs = Parameters<typeof invoke>[1];

const ipcCommands = {
  get_launch_paths: "get_launch_paths",
  open_markdown_file: "open_markdown_file",
  open_markdown_file_at_path: "open_markdown_file_at_path",
  open_markdown_files_at_paths: "open_markdown_files_at_paths",
  open_markdown_document_in_new_window: "open_markdown_document_in_new_window",
  complete_detached_window_broadcast_handoff:
    "complete_detached_window_broadcast_handoff",
  take_detached_window_document: "take_detached_window_document",
  save_markdown_file: "save_markdown_file",
  select_markdown_save_path: "select_markdown_save_path",
  save_markdown_file_as: "save_markdown_file_as",
} as const satisfies { [Command in AppCommandName]: Command };

function invokeAppCommand<Command extends AppCommandName>(
  command: Command,
  ...args: AppInvokeArgs<Command>
): Promise<MarkdownFileIpcContract[Command]["response"]> {
  return invoke<MarkdownFileIpcContract[Command]["response"]>(
    command,
    args[0] as TauriInvokeArgs,
  );
}

export function getLaunchPaths(): Promise<string[]> {
  return invokeAppCommand(ipcCommands.get_launch_paths);
}

export function openMarkdownFile(): Promise<OpenedMarkdownFile | null> {
  return invokeAppCommand(ipcCommands.open_markdown_file);
}

export function openMarkdownFileAtPath(path: string): Promise<OpenedMarkdownFile> {
  return invokeAppCommand(ipcCommands.open_markdown_file_at_path, { path });
}

export function openMarkdownFilesAtPaths(
  paths: string[],
  options: { droppedPaths?: boolean } = {},
): Promise<OpenedMarkdownFileAtPathResult[]> {
  return invokeAppCommand(ipcCommands.open_markdown_files_at_paths, {
    paths,
    droppedPaths: options.droppedPaths,
  });
}

export function openMarkdownDocumentInNewWindow(
  document: DetachedWindowDocument,
): Promise<void> {
  return invokeAppCommand(ipcCommands.open_markdown_document_in_new_window, { document });
}

export function completeDetachedWindowBroadcastHandoff(
  token: string,
): Promise<void> {
  return invokeAppCommand(ipcCommands.complete_detached_window_broadcast_handoff, {
    token,
  });
}

export function takeDetachedWindowDocument(
  token: string,
): Promise<DetachedWindowDocument | null> {
  return invokeAppCommand(ipcCommands.take_detached_window_document, { token });
}

export function saveMarkdownFile(
  path: string,
  content: string,
  options: SaveMarkdownFileOptions = {},
): Promise<MarkdownFileSaveResult> {
  return invokeAppCommand(ipcCommands.save_markdown_file, {
    path,
    content,
    expectedFileFingerprint: options.expectedFileFingerprint ?? null,
    allowExternalOverwrite: options.allowExternalOverwrite,
  }).then(normalizeMarkdownFileSaveResult);
}

export function selectMarkdownSavePath(
  suggestedPath: string | null,
): Promise<string | null> {
  return invokeAppCommand(ipcCommands.select_markdown_save_path, { suggestedPath });
}

export function saveMarkdownFileAs(
  suggestedPath: string | null,
  content: string,
  options: SaveMarkdownFileOptions = {},
): Promise<MarkdownFileSaveResult | null> {
  return invokeAppCommand(ipcCommands.save_markdown_file_as, {
    suggestedPath,
    content,
    expectedFileFingerprint: options.expectedFileFingerprint ?? null,
    allowExternalOverwrite: options.allowExternalOverwrite,
  }).then((response) => {
    return response ? normalizeMarkdownFileSaveResult(response) : null;
  });
}

function normalizeMarkdownFileSaveResult(
  response: MarkdownFileSaveCommandResponse,
): MarkdownFileSaveResult {
  if (isMarkdownFileSaveResult(response)) {
    return response;
  }

  return {
    status: "saved",
    file: response,
    conflict: null,
  };
}

function isMarkdownFileSaveResult(
  value: MarkdownFileSaveCommandResponse,
): value is MarkdownFileSaveResult {
  return (
    typeof (value as MarkdownFileSaveResult).status === "string" &&
    ((value as MarkdownFileSaveResult).status === "saved" ||
      (value as MarkdownFileSaveResult).status === "conflict")
  );
}
