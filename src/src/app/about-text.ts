import { invoke } from "@tauri-apps/api/core";

const ipcCommands = {
  get_about_text: "get_about_text",
} as const;

export async function getAboutText(): Promise<string> {
  return invoke<string>(ipcCommands.get_about_text);
}
