import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const defaultCapability = JSON.parse(
  readFileSync("src-tauri/capabilities/default.json", "utf8"),
);
const vscodeLaunch = JSON.parse(readFileSync(".vscode/launch.json", "utf8"));
const vscodeTasks = JSON.parse(readFileSync(".vscode/tasks.json", "utf8"));

test("hidden startup window is allowed to show after first frontend render", () => {
  const mainWindow = tauriConfig.app.windows.find((window) => window.label === "main");

  assert.ok(mainWindow, "main Tauri window should be configured");
  assert.equal(mainWindow.visible, false);
  assert.equal(mainWindow.backgroundColor, "#f8fafc");
  assert.ok(
    defaultCapability.permissions.includes("core:window:allow-show"),
    "hidden startup requires the frontend window.show permission",
  );
});

test("window close guard destroy permission stays available", () => {
  assert.ok(
    defaultCapability.permissions.includes("core:window:allow-destroy"),
    "window close guard requires the frontend window.destroy permission",
  );
});

test("release bundle includes required license and about resources", () => {
  assert.deepEqual(
    tauriConfig.bundle.resources,
    {
      "../LICENSE": "LICENSE",
      "../THIRD_PARTY_NOTICES.txt": "THIRD_PARTY_NOTICES.txt",
      "../about.txt": "about.txt",
    },
  );
});

test("VS Code F5 launch uses the owned Tauri dev lifecycle cleanup", () => {
  const launchConfig = vscodeLaunch.configurations.find(
    (configuration) => configuration.name === "Run j3Markdown",
  );
  const stopTask = vscodeTasks.tasks.find((task) => task.label === "Stop j3Markdown Dev");
  const startScript = readFileSync("scripts/start-vscode-tauri-dev.ps1", "utf8");
  const stopScript = readFileSync("scripts/stop-vscode-tauri-dev.ps1", "utf8");

  assert.ok(launchConfig, "Run j3Markdown launch config should exist");
  assert.match(launchConfig.command, /start-vscode-tauri-dev\.ps1/u);
  assert.doesNotMatch(
    launchConfig.command,
    /pnpm run tauri:dev/u,
    "launch.json should not run tauri dev without the lifecycle wrapper",
  );
  assert.equal(launchConfig.postDebugTask, "Stop j3Markdown Dev");

  assert.ok(stopTask, "Stop j3Markdown Dev task should exist");
  assert.equal(stopTask.command, "powershell.exe");
  assert.ok(
    stopTask.args.includes("${workspaceFolder}\\scripts\\stop-vscode-tauri-dev.ps1"),
    "post debug task should invoke the stop script",
  );

  assert.match(startScript, /tauri-dev\.pid\.json/u);
  assert.match(startScript, /corepack pnpm run tauri:dev/u);
  assert.match(stopScript, /taskkill\.exe \/PID/u);
  assert.match(stopScript, /\/T \/F/u);
});
