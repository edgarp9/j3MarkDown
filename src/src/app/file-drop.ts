import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export interface FileDropListenerOptions {
  onDropPaths: (paths: string[]) => void | Promise<void>;
  onDragStateChange?: (isDragging: boolean) => void;
  onUnhandledError?: (error: unknown) => void;
}

const APPROVED_FILE_DROP_EVENT = "j3markdown://approved-file-drop";

export async function listenForDroppedFiles({
  onDropPaths,
  onDragStateChange,
  onUnhandledError,
}: FileDropListenerOptions): Promise<() => void> {
  const unlistenCallbacks: Array<() => void> = [];

  try {
    const approvedDropUnlisten = await listen<string[]>(APPROVED_FILE_DROP_EVENT, (event) => {
      onDragStateChange?.(false);
      void Promise.resolve(onDropPaths(event.payload)).catch((error: unknown) => {
        onUnhandledError?.(error);
      });
    });
    unlistenCallbacks.push(approvedDropUnlisten);

    const dragStateUnlisten = await getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;

      if (payload.type === "over") {
        onDragStateChange?.(true);
        return;
      }

      logDragDropPayload(payload);

      onDragStateChange?.(false);
    });
    unlistenCallbacks.push(dragStateUnlisten);
  } catch (error) {
    unlistenCallbacks.forEach((unlisten) => unlisten());
    throw error;
  }

  return () => {
    unlistenCallbacks.forEach((unlisten) => unlisten());
  };
}

function logDragDropPayload(payload: { type: string; paths?: string[]; position?: unknown }): void {
  console.info("[file-drop] drag event", payload);
}
