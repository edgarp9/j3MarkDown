import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Window as TauriWindow } from "@tauri-apps/api/window";

type UnlistenFn = () => void;

interface BeforeUnloadGuardTarget {
  addEventListener: (
    type: "beforeunload",
    listener: (event: BeforeUnloadEvent) => void,
  ) => void;
  removeEventListener: (
    type: "beforeunload",
    listener: (event: BeforeUnloadEvent) => void,
  ) => void;
  close?: () => void;
}

export interface WindowCloseGuardOptions {
  flushPendingChanges: () => Promise<void> | void;
  hasDirtyTabs: () => boolean;
  resolveCloseRequest: () => Promise<boolean>;
  onRegistrationError: (error: unknown) => void;
  onCloseError: (error: unknown) => void;
}

export interface WindowCloseGuard {
  ready: Promise<void>;
  stop: () => void;
}

export type WindowCloseTarget = Pick<TauriWindow, "onCloseRequested" | "destroy">;
export type GetWindowCloseTarget = () => WindowCloseTarget;
export type GetBeforeUnloadGuardTarget = () => BeforeUnloadGuardTarget | null;

export function startCurrentWindowCloseGuard(
  options: WindowCloseGuardOptions,
): WindowCloseGuard {
  return startWindowCloseGuard(options, getCurrentWindow, getCurrentBeforeUnloadTarget);
}

export function startWindowCloseGuard(
  options: WindowCloseGuardOptions,
  getWindow: GetWindowCloseTarget,
  getBeforeUnloadTarget: GetBeforeUnloadGuardTarget = getCurrentBeforeUnloadTarget,
): WindowCloseGuard {
  const fallbackGuard = createBeforeUnloadFallbackGuard(options, getBeforeUnloadTarget);
  fallbackGuard.start();

  let targetWindow: WindowCloseTarget;

  try {
    targetWindow = getWindow();
  } catch (error) {
    options.onRegistrationError(error);
    return createFallbackOnlyWindowCloseGuard(fallbackGuard);
  }

  fallbackGuard.setCloseWindow(() => targetWindow.destroy());

  return registerWindowCloseGuard(options, targetWindow, fallbackGuard);
}

function registerWindowCloseGuard(
  options: WindowCloseGuardOptions,
  targetWindow: WindowCloseTarget,
  fallbackGuard: BeforeUnloadFallbackGuard,
): WindowCloseGuard {
  let isStopped = false;
  let isResolvingClose = false;
  let isCloseConfirmed = false;
  let unlisten: UnlistenFn | null = null;

  const ready = targetWindow
    .onCloseRequested((event) => {
      if (isStopped) {
        return;
      }

      if (isCloseConfirmed) {
        return;
      }

      event.preventDefault();

      const pendingChangesFlush = flushPendingChanges(options);

      if (isResolvingClose) {
        return;
      }

      isResolvingClose = true;
      void resolveWindowCloseAfterPendingFlush(
        options,
        targetWindow,
        pendingChangesFlush,
        null,
      )
        .then((closed) => {
          if (closed) {
            isCloseConfirmed = true;
          }
        })
        .catch((error: unknown) => {
          isCloseConfirmed = false;
          if (!isStopped) {
            options.onCloseError(error);
          }
        })
        .finally(() => {
          isResolvingClose = false;
        });
    })
    .then((registeredUnlisten) => {
      fallbackGuard.stop();

      if (isStopped) {
        registeredUnlisten();
        return;
      }

      unlisten = registeredUnlisten;
    })
    .catch((error: unknown) => {
      if (!isStopped) {
        options.onRegistrationError(error);
      }
    });

  return {
    ready,
    stop: () => {
      isStopped = true;
      fallbackGuard.stop();
      unlisten?.();
      unlisten = null;
    },
  };
}

function flushPendingChanges(options: WindowCloseGuardOptions): Promise<void> | null {
  try {
    const flushResult = options.flushPendingChanges();
    return isPromiseLike(flushResult) ? Promise.resolve(flushResult) : null;
  } catch (error) {
    return Promise.reject(error);
  }
}

async function resolveWindowCloseAfterPendingFlush(
  options: WindowCloseGuardOptions,
  targetWindow: WindowCloseTarget,
  pendingChangesFlush: Promise<void> | null,
  hasKnownDirtyTabs: boolean | null,
): Promise<boolean> {
  await pendingChangesFlush;

  const hasDirtyTabs = hasKnownDirtyTabs ?? options.hasDirtyTabs();
  if (!hasDirtyTabs) {
    await targetWindow.destroy();
    return true;
  }

  return await resolveProtectedWindowClose(options, targetWindow);
}

async function resolveProtectedWindowClose(
  options: WindowCloseGuardOptions,
  targetWindow: WindowCloseTarget,
): Promise<boolean> {
  const canClose = await options.resolveCloseRequest();

  if (!canClose) {
    return false;
  }

  await targetWindow.destroy();
  return true;
}

interface BeforeUnloadFallbackGuard {
  setCloseWindow: (closeWindow: () => Promise<void>) => void;
  start: () => void;
  stop: () => void;
}

function createBeforeUnloadFallbackGuard(
  options: WindowCloseGuardOptions,
  getTarget: GetBeforeUnloadGuardTarget,
): BeforeUnloadFallbackGuard {
  let target: BeforeUnloadGuardTarget | null = null;
  let isListening = false;
  let isStopped = false;
  let isResolvingClose = false;
  let isCloseConfirmed = false;
  let closeWindow: (() => Promise<void>) | null = null;

  const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    const pendingChangesFlush = flushPendingChanges(options);

    if (isCloseConfirmed) {
      return;
    }

    let hasKnownDirtyTabs: boolean | null = null;
    if (!pendingChangesFlush) {
      hasKnownDirtyTabs = options.hasDirtyTabs();
      if (!hasKnownDirtyTabs) {
        return;
      }
    }

    event.preventDefault();
    event.returnValue = "";

    if (isResolvingClose) {
      return;
    }

    isResolvingClose = true;
    void resolveFallbackCloseAfterPendingFlush(
      options,
      () => !isStopped,
      () => {
        isCloseConfirmed = true;
      },
      () => closeWindow?.() ?? closeFallbackTarget(target),
      pendingChangesFlush,
      hasKnownDirtyTabs,
    )
      .then((closed) => {
        if (closed) {
          isCloseConfirmed = true;
        }
      })
      .catch((error: unknown) => {
        isCloseConfirmed = false;
        if (!isStopped) {
          options.onCloseError(error);
        }
      })
      .finally(() => {
        isResolvingClose = false;
      });
  };

  return {
    setCloseWindow: (nextCloseWindow) => {
      closeWindow = nextCloseWindow;
    },
    start: () => {
      if (isListening) {
        return;
      }

      isStopped = false;
      target = getTarget();
      if (!target) {
        return;
      }

      target.addEventListener("beforeunload", handleBeforeUnload);
      isListening = true;
    },
    stop: () => {
      isStopped = true;

      if (!isListening || !target) {
        return;
      }

      target.removeEventListener("beforeunload", handleBeforeUnload);
      target = null;
      isListening = false;
    },
  };
}

async function resolveFallbackCloseAfterPendingFlush(
  options: WindowCloseGuardOptions,
  shouldClose: () => boolean,
  confirmClose: () => void,
  closeWindow: () => Promise<void>,
  pendingChangesFlush: Promise<void> | null,
  hasKnownDirtyTabs: boolean | null,
): Promise<boolean> {
  await pendingChangesFlush;

  if (!shouldClose()) {
    return false;
  }

  const hasDirtyTabs = hasKnownDirtyTabs ?? options.hasDirtyTabs();
  if (!hasDirtyTabs) {
    confirmClose();
    await closeWindow();
    return true;
  }

  return await resolveProtectedFallbackClose(
    options,
    shouldClose,
    confirmClose,
    closeWindow,
  );
}

async function resolveProtectedFallbackClose(
  options: WindowCloseGuardOptions,
  shouldClose: () => boolean,
  confirmClose: () => void,
  closeWindow: () => Promise<void>,
): Promise<boolean> {
  const canClose = await options.resolveCloseRequest();

  if (!canClose || !shouldClose()) {
    return false;
  }

  confirmClose();
  await closeWindow();
  return true;
}

async function closeFallbackTarget(
  target: BeforeUnloadGuardTarget | null,
): Promise<void> {
  target?.close?.();
}

function createFallbackOnlyWindowCloseGuard(
  fallbackGuard: BeforeUnloadFallbackGuard,
): WindowCloseGuard {
  return {
    ready: Promise.resolve(),
    stop: () => {
      fallbackGuard.stop();
    },
  };
}

function getCurrentBeforeUnloadTarget(): BeforeUnloadGuardTarget | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window;
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return Boolean(
    value &&
      typeof value === "object" &&
      "then" in value &&
      typeof value.then === "function",
  );
}
