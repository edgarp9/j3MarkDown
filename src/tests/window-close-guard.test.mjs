import assert from "node:assert/strict";
import test from "node:test";

import { startWindowCloseGuard } from "../.test-output/src/app/window-close-guard.js";

test("clean window close requests are prevented before manual destroy", async () => {
  const harness = createCloseGuardHarness({ dirty: false });

  await harness.guard.ready;
  const event = harness.triggerCloseRequest();
  await flushAsyncWork();

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(harness.calls, ["listen", "flush", "hasDirtyTabs", "destroy"]);
});

test("clean window close waits for async pending flush before destroying the window", async () => {
  const pendingFlush = createDeferred();
  const harness = createCloseGuardHarness({ dirty: false, pendingFlush });

  await harness.guard.ready;
  const event = harness.triggerCloseRequest();
  await flushAsyncWork();

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(harness.calls, ["listen", "flush"]);

  pendingFlush.resolve();
  await flushAsyncWork();

  assert.deepEqual(harness.calls, ["listen", "flush", "hasDirtyTabs", "destroy"]);
});

test("synchronous pending flush failures are reported after preventing native close", async () => {
  const harness = createCloseGuardHarness({
    dirty: false,
    flushError: new Error("serialize failed"),
  });

  await harness.guard.ready;
  const event = harness.triggerCloseRequest();
  await flushAsyncWork();

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(harness.calls, ["listen", "flush", "closeError:serialize failed"]);
});

test("dirty window close cancellation prevents native close without destroying the window", async () => {
  const harness = createCloseGuardHarness({ dirty: true, closeDecision: false });

  await harness.guard.ready;
  const event = harness.triggerCloseRequest();
  await flushAsyncWork();

  assert.equal(event.defaultPrevented, true);
  assert.equal(harness.calls.includes("resolveCloseRequest"), true);
  assert.equal(harness.calls.includes("destroy"), false);
  assert.equal(harness.calls.includes("close"), false);
});

test("confirmed dirty window close resumes through destroy instead of close", async () => {
  const harness = createCloseGuardHarness({ dirty: true, closeDecision: true });

  await harness.guard.ready;
  const event = harness.triggerCloseRequest();
  await flushAsyncWork();

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(
    harness.calls.filter((call) => call === "destroy" || call === "close"),
    ["destroy"],
  );

  const repeatedCloseRequest = harness.triggerCloseRequest();
  await flushAsyncWork();

  assert.equal(repeatedCloseRequest.defaultPrevented, false);
  assert.equal(countCalls(harness.calls, "resolveCloseRequest"), 1);
});

test("concurrent close requests are prevented while the first dirty close is resolving", async () => {
  const closeDecision = createDeferred();
  const harness = createCloseGuardHarness({ dirty: true, closeDecision });

  await harness.guard.ready;
  const firstEvent = harness.triggerCloseRequest();
  const secondEvent = harness.triggerCloseRequest();
  await flushAsyncWork();

  assert.equal(firstEvent.defaultPrevented, true);
  assert.equal(secondEvent.defaultPrevented, true);
  assert.equal(countCalls(harness.calls, "resolveCloseRequest"), 1);
  assert.equal(harness.calls.includes("destroy"), false);

  closeDecision.resolve(true);
  await flushAsyncWork();

  assert.equal(countCalls(harness.calls, "destroy"), 1);
});

test("window acquisition failures use the modal close flow from the fallback guard", async () => {
  const calls = [];
  const beforeUnload = createBeforeUnloadTarget(calls);
  const guard = startWindowCloseGuard(
    createOptions({ calls, dirty: true, closeDecision: true }),
    () => {
      throw new Error("missing window");
    },
    () => beforeUnload.target,
  );

  await guard.ready;

  assert.deepEqual(calls, ["beforeUnloadListen", "registrationError:missing window"]);

  const event = beforeUnload.triggerBeforeUnload();
  await flushAsyncWork();

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.returnValue, "");

  guard.stop();

  assert.deepEqual(calls, [
    "beforeUnloadListen",
    "registrationError:missing window",
    "flush",
    "hasDirtyTabs",
    "resolveCloseRequest",
    "fallbackClose",
    "beforeUnloadUnlisten",
  ]);
  assert.equal(beforeUnload.hasListener(), false);
});

test("listener registration failures use the modal close flow from the fallback guard", async () => {
  const calls = [];
  const beforeUnload = createBeforeUnloadTarget(calls);
  const harness = createCloseGuardHarness({
    calls,
    dirty: true,
    closeDecision: true,
    registrationError: new Error("listen failed"),
    beforeUnloadTarget: beforeUnload.target,
  });

  await harness.guard.ready;

  assert.deepEqual(harness.calls, [
    "beforeUnloadListen",
    "listen",
    "registrationError:listen failed",
  ]);

  const event = beforeUnload.triggerBeforeUnload();
  await flushAsyncWork();

  assert.equal(event.defaultPrevented, true);
  assert.equal(event.returnValue, "");
  assert.deepEqual(harness.calls, [
    "beforeUnloadListen",
    "listen",
    "registrationError:listen failed",
    "flush",
    "hasDirtyTabs",
    "resolveCloseRequest",
    "destroy",
  ]);
});

test("successful listener registration removes the beforeunload fallback guard", async () => {
  const calls = [];
  const beforeUnload = createBeforeUnloadTarget(calls);
  const harness = createCloseGuardHarness({
    calls,
    beforeUnloadTarget: beforeUnload.target,
  });

  await harness.guard.ready;

  assert.equal(beforeUnload.hasListener(), false);
  assert.deepEqual(harness.calls, [
    "beforeUnloadListen",
    "listen",
    "beforeUnloadUnlisten",
  ]);
});

test("destroy failures are reported and leave the guard retryable", async () => {
  let destroyFailures = 1;
  const harness = createCloseGuardHarness({
    dirty: true,
    closeDecision: true,
    destroyImplementation: async () => {
      if (destroyFailures > 0) {
        destroyFailures -= 1;
        throw new Error("destroy failed");
      }
    },
  });

  await harness.guard.ready;
  const firstEvent = harness.triggerCloseRequest();
  await flushAsyncWork();

  assert.equal(firstEvent.defaultPrevented, true);
  assert.equal(harness.calls.includes("closeError:destroy failed"), true);
  assert.equal(countCalls(harness.calls, "destroy"), 1);

  const secondEvent = harness.triggerCloseRequest();
  await flushAsyncWork();

  assert.equal(secondEvent.defaultPrevented, true);
  assert.equal(countCalls(harness.calls, "destroy"), 2);
});

test("stopping before listener registration resolves still unlistens the late listener", async () => {
  const calls = [];
  const listenerRegistration = createDeferred();
  const guard = startWindowCloseGuard(createOptions({ calls }), () => ({
    onCloseRequested: () => {
      calls.push("listen");
      return listenerRegistration.promise;
    },
    destroy: async () => {
      calls.push("destroy");
    },
  }));

  guard.stop();
  listenerRegistration.resolve(() => {
    calls.push("unlisten");
  });
  await guard.ready;

  assert.deepEqual(calls, ["listen", "unlisten"]);
});

function createCloseGuardHarness({
  calls = [],
  dirty = true,
  closeDecision = true,
  pendingFlush = null,
  flushError = null,
  registrationError = null,
  destroyImplementation = async () => {},
  beforeUnloadTarget = null,
} = {}) {
  let closeRequestedHandler = null;

  const target = {
    onCloseRequested: async (handler) => {
      calls.push("listen");

      if (registrationError) {
        throw registrationError;
      }

      closeRequestedHandler = handler;
      return () => {
        calls.push("unlisten");
      };
    },
    destroy: async () => {
      calls.push("destroy");
      await destroyImplementation();
    },
    close: async () => {
      calls.push("close");
    },
  };

  const options = createOptions({
    calls,
    dirty,
    closeDecision,
    pendingFlush,
    flushError,
  });
  const guard = beforeUnloadTarget
    ? startWindowCloseGuard(options, () => target, () => beforeUnloadTarget)
    : startWindowCloseGuard(options, () => target);

  return {
    calls,
    guard,
    triggerCloseRequest() {
      assert.ok(closeRequestedHandler, "close-requested handler should be registered");
      const event = createCloseRequestedEvent();
      closeRequestedHandler(event);
      return event;
    },
  };
}

function createOptions({
  calls,
  dirty = false,
  closeDecision = false,
  pendingFlush = null,
  flushError = null,
}) {
  return {
    flushPendingChanges: () => {
      calls.push("flush");
      if (flushError) {
        throw flushError;
      }
      if (pendingFlush) {
        return pendingFlush.promise;
      }
    },
    hasDirtyTabs: () => {
      calls.push("hasDirtyTabs");
      return dirty;
    },
    resolveCloseRequest: async () => {
      calls.push("resolveCloseRequest");

      if (isDeferred(closeDecision)) {
        return await closeDecision.promise;
      }

      return closeDecision;
    },
    onRegistrationError: (error) => {
      calls.push(`registrationError:${getErrorMessage(error)}`);
    },
    onCloseError: (error) => {
      calls.push(`closeError:${getErrorMessage(error)}`);
    },
  };
}

function createCloseRequestedEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

function createBeforeUnloadTarget(calls) {
  let beforeUnloadHandler = null;

  return {
    target: {
      addEventListener(type, handler) {
        assert.equal(type, "beforeunload");
        calls.push("beforeUnloadListen");
        beforeUnloadHandler = handler;
      },
      removeEventListener(type, handler) {
        assert.equal(type, "beforeunload");
        assert.equal(handler, beforeUnloadHandler);
        calls.push("beforeUnloadUnlisten");
        beforeUnloadHandler = null;
      },
      close() {
        calls.push("fallbackClose");
      },
    },
    triggerBeforeUnload() {
      assert.ok(beforeUnloadHandler, "beforeunload handler should be registered");
      const event = createBeforeUnloadEvent();
      beforeUnloadHandler(event);
      return event;
    },
    hasListener() {
      return Boolean(beforeUnloadHandler);
    },
  };
}

function createBeforeUnloadEvent() {
  return {
    defaultPrevented: false,
    returnValue: undefined,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function isDeferred(value) {
  return value && typeof value === "object" && "promise" in value;
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function countCalls(calls, expectedCall) {
  return calls.filter((call) => call === expectedCall).length;
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
