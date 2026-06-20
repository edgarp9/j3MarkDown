# Manual Checks

This document records manual verification procedure and results for the Markdown editor. It is not a product requirements source.

Canonical sources:

- Product scope: `docs/product-scope.md`
- File handling: `docs/file-handling.md`
- UI behavior: `docs/ui-behavior.md`
- Architecture: `docs/architecture.md`

## Latest Full Menu Function Audit Recheck

Date: 2026-06-18
Environment: Windows development workspace at `C:\_my\src\j3MarkDown`

Status: completed with Linux runtime unavailable

Canonical sources checked before implementation:

- UI behavior: `docs/ui-behavior.md`
- File handling: `docs/file-handling.md`
- Architecture boundary: `docs/architecture.md`
- Data contract: `docs/data-contract.md`

Finding:

- No product-menu source defect was found while re-running the toolbar, tab, tab context menu, editor context menu, modal, file, state, and setting flows.
- The default `cargo test --manifest-path src-tauri\Cargo.toml` initially failed because stale generated output under `src-tauri/target` still referenced the old workspace path `C:\Users\dolco\Desktop\src\j3MarkDown`.
- Removing only the stale generated `src-tauri/target` directory fixed the default Cargo test/build environment; the default target was regenerated successfully.
- Rust build logs also showed three `dead_code` warnings for helpers that are used only by tests.

Fix applied:

- Removed the stale generated `src-tauri/target` directory after verifying the resolved path was exactly under this workspace.
- Marked test-only Rust helpers with `#[cfg(test)]`:
  - `src-tauri/src/markdown_files.rs`: `reserve_markdown_save_ticket`
  - `src-tauri/src/markdown_files/service.rs`: `save_markdown_file_as_path`, `save_markdown_file_to_path`

Menu and interaction results:

| Menu | Function | Windows behavior | Linux existing behavior | Problem | Cause | Fix | Recheck result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Toolbar | `새 글` | Click creates a new untitled tab; repeated execution keeps tab state isolated. | Not run; frontend state path is platform-neutral. | No | Covered by e2e and focused menu audit. | None | Pass |
| Toolbar | `열기` | Click invokes typed Tauri open command; opened Markdown tab becomes active and remains clean. | Not run; Rust validation is platform-neutral except dialog ownership. | No | Covered by e2e and Rust file tests. | None | Pass |
| Toolbar | `저장` | Click saves active path-backed content and clears dirty state only after successful write. | Not run; Rust write path has Windows and non-Windows atomic branches. | No | Covered by e2e and Rust file tests. | None | Pass |
| Toolbar | `새 이름 저장` | Click selects a save target, writes content, updates tab path/title, and clears dirty state. | Not run; Rust save-path normalization is platform-neutral. | No | Covered by e2e and Rust file tests. | None | Pass |
| Toolbar | Theme selector | Options display correctly; theme applies to shell/editor and persists through reload. | Not run; config command contract is platform-neutral. | No | Covered by e2e. | None | Pass |
| Tab bar | Select tab | Click switches active editor, status, dirty marker, and scroll state without mixing documents. | Not run; frontend path is platform-neutral. | No | Covered by e2e and large-editor-cache scenario. | None | Pass |
| Tab bar | Close tab | Clean tabs close directly; dirty tabs show modal save/discard/cancel protection. | Not run; frontend path is platform-neutral. | No | Covered by unsaved e2e. | None | Pass |
| Tab context menu | `새 창에서 열기` | Right-click menu opens; action transfers in-memory snapshot and closes source tab after consumption. | Not run; Tauri handoff contract covered by Rust tests. | No | Covered by e2e and Rust handoff tests. | None | Pass |
| Tab context menu | `다른 탭 닫기` | Action closes other tabs, stops on dirty-tab cancel/save failure, and keeps target tab. | Not run; frontend path is platform-neutral. | No | Covered by e2e. | None | Pass |
| Editor context menu | Undo, redo, cut, copy, paste, select all, bold, italic, inline code | Every item was clicked in a focused Playwright audit; selection, clipboard, formatting, undo/redo, dismissal, and dirty state behaved correctly. | Not run; browser/WebView editing path is mostly platform-neutral, clipboard permissions vary by runtime. | No | Focused audit with clipboard permissions. | None | Pass |
| Modal dialogs | Unsaved and error dialogs | Modal backdrop, `aria-modal`, default focus, Escape cancel, and button decisions verified. | Not run; native dialog rendering is runtime-dependent. | No | Covered by unsaved e2e. | None | Pass |
| Drag and drop | Approved Markdown drop flow | Raw Tauri drop does not open before Rust-approved event; approved Markdown paths open; unsupported paths show modal. | Not run; Rust approval/event ordering is platform-sensitive and statically reviewed. | No | Covered by e2e and Rust tests. | None | Pass |
| Build/test environment | Default Cargo test/build | Initial default Cargo test failed, then passed after generated target cleanup. Tauri debug build and executable launch passed. | Not run; WSL unavailable and `rustup` unavailable on PATH. | Yes | Stale generated Tauri permission output under `src-tauri/target` referenced an old workspace path. | Removed stale generated target directory; regenerated with default Cargo/Tauri commands. | Pass on Windows |
| Logs/warnings | Build/runtime logs | Browser e2e captured no page errors or console warnings/errors; Rust dead-code warnings removed. Node e2e process still reports `DEP0190`. | Not run. | Partly | Node warning comes from test process spawning with `shell: true` on Windows. | No dependency or source runtime fix applied; warning is test harness-only. | Pass with noted warning |

Command results:

| Command/check | Result | Notes |
| --- | --- | --- |
| `corepack pnpm typecheck` | Pass | `tsc --noEmit` completed successfully. |
| `corepack pnpm test:unit` | Pass | 41 unit tests passed. |
| `corepack pnpm test:unsaved` | Pass | 13 unsaved-change e2e checks passed. |
| `corepack pnpm test:flow` | Pass | Full Markdown user-flow e2e passed and wrote screenshots under `.test-output\markdown-user-flow`. |
| `J3MARKDOWN_E2E_SCENARIO=large-editor-cache corepack pnpm test:flow` | Pass | Large editor cache/tab switching scenario passed. |
| Focused inline Playwright menu audit | Pass | Clicked all editor context menu commands plus toolbar/theme/tab context menu positioning. |
| `corepack pnpm test` | Pass | Unit, unsaved e2e, and full flow e2e passed sequentially. |
| Initial `cargo test --manifest-path src-tauri\Cargo.toml` | Fail | Blocked by stale generated `src-tauri/target` output pointing at old workspace path. |
| `cargo test --manifest-path src-tauri\Cargo.toml` after target cleanup | Pass | 64 Rust tests passed with no Rust warnings after the helper scope fix. |
| `corepack pnpm build` | Pass | Frontend production build completed. |
| `corepack pnpm tauri build --debug --no-bundle` | Pass | Debug app built at `src-tauri\target\debug\j3markdown.exe`. |
| Debug executable launch | Pass | Process stayed alive for 5 seconds and created executable-local `j3markdown.toml` with default config. |
| `wsl.exe --status` | Blocked | WSL/Linux is not installed. |
| `rustup target list --installed` | Blocked | `rustup` is not available on PATH. |

Residual risks:

- Linux behavior could not be executed in this Windows environment because WSL is not installed and `rustup` is unavailable on PATH. Linux notes are based on platform-neutral frontend tests, Rust unit coverage, and static review of `#[cfg(windows)]` / `#[cfg(not(windows))]` branches.
- Native Windows Open/Save As OS dialog clicking was represented by controlled e2e command results and Rust dialog-backed command tests rather than manual mouse operation inside the OS dialog.
- Node's `DEP0190` warning remains in e2e process output; it does not appear in app runtime logs.

## Latest Full Menu Regression Check

Date: 2026-06-18
Environment: Windows development workspace at `C:\_my\src\j3MarkDown`

Status: completed with Linux runtime unavailable

Canonical sources checked before implementation:

- UI behavior: `docs/ui-behavior.md`
- File handling: `docs/file-handling.md`
- Architecture boundary: `docs/architecture.md`

Finding:

- The local `node_modules` directory existed but top-level package links were broken, so TypeScript could not resolve installed Tauri and Milkdown packages. Re-linking with the existing `pnpm-lock.yaml` restored the test/build environment without adding dependencies.
- Opening a saved Markdown file could become dirty without user input after Milkdown finished initialization. The editor component compared the first post-create serialized Markdown against the original file text instead of treating Milkdown's initial serialization as the editor baseline.
- The editor theme setting was saved through a debounced queue. Selecting a theme and immediately reloading or restarting could lose the selected theme before the debounce timer fired.
- The user-flow e2e expected an opened file to be dirty when using "새 창에서 열기"; that was stale after fixing the no-user-edit dirty state.
- Running `cargo test` with the default `src-tauri/target` failed because stale Tauri generated build output still referenced an old workspace path under `C:\Users\dolco\Desktop\src\j3MarkDown`. Re-running with a fresh temporary `CARGO_TARGET_DIR` passed.

Fix applied:

- `src/components/MarkdownEditor.ts` now synchronizes the initial Milkdown serialized Markdown as the editor's local flush baseline after `Crepe.create()` succeeds. This prevents initialization-only normalization from marking opened documents dirty.
- `src/app/App.ts` now flushes the pending editor-theme setting save immediately after a theme change, while preserving the existing error callback path.
- `tests/markdown-user-flow.e2e.mjs` now expects clean opened tabs to transfer as clean snapshots and validates the `lastSavedMarkdownMatchesMarkdown` handoff optimization.

Menu and interaction results:

| Menu | Function | Windows behavior | Linux existing behavior | Problem | Cause | Fix | Recheck result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Toolbar | `새 글` | Click creates an untitled tab and keeps tab state isolated. | Not run; frontend path is platform-neutral. | No | Covered by e2e. | None | Pass |
| Toolbar | `열기` | Click invokes the typed Tauri open command and opened files stay clean after Milkdown initialization. | Not run; backend path covered by Rust tests for platform-neutral validation. | Yes | Initial editor serialization was treated as a content edit. | Sync initial editor flush baseline. | Pass |
| Toolbar | `저장` | Click saves active path-backed content and clears dirty state only after successful backend write. | Not run; Rust service tests cover file writes and non-Windows atomic branch was statically reviewed. | No | Covered by e2e and Rust tests. | None | Pass |
| Toolbar | `새 이름 저장` | Click selects a save path, writes content, updates active tab path/title, and clears dirty state. | Not run; Rust service tests cover save-path normalization and write behavior. | No | Covered by e2e and Rust tests. | None | Pass |
| Toolbar | Theme select | Theme options display correctly, selection applies to shell/editor, and persists across reload. | Not run; persistence command contract is platform-neutral and config service is covered by Rust tests. | Yes | Debounced setting save could be lost before timer execution. | Flush setting save immediately after selection. | Pass |
| Tab bar | Select tab | Click switches active tab, editor content, status, and scroll position without mixing state. | Not run; frontend path is platform-neutral. | No | Covered by e2e. | None | Pass |
| Tab bar | Close tab | Click protects dirty tabs with modal save/discard/cancel and closes clean tabs without save. | Not run; frontend path is platform-neutral. | No | Covered by unsaved e2e. | None | Pass |
| Tab context menu | `새 창에서 열기` | Right-click menu opens, handoff snapshot is transferred, source tab closes after consumption. Clean opened files transfer as clean snapshots. | Not run; Tauri window command contract covered by Rust tests. | Yes | Test expected old false-dirty state. | Updated e2e expectation and handoff assertion. | Pass |
| Tab context menu | `다른 탭 닫기` | Right-click menu closes other tabs and stops on dirty-tab cancel/save failure. | Not run; frontend path is platform-neutral. | No | Covered by e2e. | None | Pass |
| Editor context menu | Undo/redo/cut/copy/paste/select-all/bold/italic/inline-code entries | Menu opens only inside editor, suppresses browser fallback, supports Escape/outside dismissal; bold command executes and marks tab dirty. | Not run; frontend path is platform-neutral. | No | Covered by e2e. | None | Pass |
| Modal dialogs | Error and unsaved confirmations | Modal backdrop, focus, Escape cancel, and button actions verified. | Not run; native `dialog` behavior is browser/WebView dependent. | No | Covered by e2e and screenshot review. | None | Pass |

Command results:

| Command/check | Result | Notes |
| --- | --- | --- |
| `corepack pnpm install --frozen-lockfile --ignore-scripts --config.confirmModulesPurge=false` | Pass | Re-linked existing locked dependencies; no new packages were added. |
| `corepack pnpm typecheck` | Pass | `tsc --noEmit` completed successfully. |
| `corepack pnpm test` | Pass | 41 unit tests, 13 unsaved e2e checks, and the full Markdown user-flow e2e passed. |
| `corepack pnpm build` | Pass | Frontend production build completed successfully. |
| `cargo test --manifest-path src-tauri\Cargo.toml` | Blocked by stale local target | Default `src-tauri/target` referenced an old workspace path in generated Tauri permission output. |
| `CARGO_TARGET_DIR=%TEMP%\j3markdown-cargo-target cargo test --manifest-path src-tauri\Cargo.toml` | Pass | 64 Rust tests passed. |
| `CARGO_TARGET_DIR=%TEMP%\j3markdown-cargo-target corepack pnpm tauri build --debug --no-bundle` | Pass | Debug app built at `%TEMP%\j3markdown-cargo-target\debug\j3markdown.exe`. |
| Debug executable launch | Pass | Process stayed alive for 5 seconds and created executable-local `j3markdown.toml` with default config. |
| `wsl.exe --status` | Blocked | WSL/Linux runtime is not installed in this Windows environment. |
| `rustup target list --installed` | Blocked | `rustup` is not available on PATH, so cross-target inventory was unavailable. |

Residual risks:

- Linux behavior could not be executed in this environment because WSL is not installed. Linux notes above are based on platform-neutral frontend tests, Rust unit coverage, and static review of `#[cfg(windows)]` / `#[cfg(not(windows))]` branches.
- The default checked-in `src-tauri/target` build output remains stale; using a fresh target directory verifies the source code. Removing or regenerating that ignored build directory outside this check should clear the default `cargo test` environment failure.
- E2E logs contained no browser `error` or `warning` console messages; Node printed a `DEP0190` deprecation warning from test process spawning.

## Latest Drag-Drop Approval Ordering Check

Date: 2026-05-26
Environment: Windows development workspace at `C:\Users\dolco\Desktop\src\j3MarkDown`

Status: completed with unrelated e2e dirty-state blocker noted

Canonical sources checked before implementation:

- File handling: `docs/file-handling.md`
- Architecture boundary: `docs/architecture.md`

Finding:

- Tauri 2.11.1 emits the JavaScript `tauri://drag-drop` event before app-level `Builder::on_webview_event` handlers run.
- The previous frontend opened dropped paths directly from the raw JavaScript drop event, so `open_markdown_files_at_paths(..., droppedPaths: true)` could run before Rust recorded the dropped path as approved.
- This produced a false "승인되지 않은 Markdown 파일 경로" modal for legitimate Windows Explorer drops.
- Follow-up finding on 2026-05-26: the main Tauri `WebviewWindow` receives native drops as synthesized `WindowEvent::DragDrop`, not `WebviewEvent::DragDrop`. Putting the approved-drop emit on `Builder::on_webview_event` therefore left the frontend waiting for an approved event that never arrived.

Fix applied:

- `src-tauri/src/lib.rs` now approves dropped paths in the Rust `WindowEvent::DragDrop` handler and then emits `j3markdown://approved-file-drop`.
- `src/app/file-drop.ts` keeps the raw Tauri drag event only for drag-state feedback; file opening now starts only from the app-owned approved-drop event.
- `tests/markdown-user-flow.e2e.mjs` now includes a regression check that raw `tauri://drag-drop` alone does not call the open command before the approved event.

Command results:

| Command/check | Result | Notes |
| --- | --- | --- |
| `cargo test` from `src-tauri/` | Pass | 34 Rust tests passed. |
| `pnpm typecheck` | Pass | `tsc --noEmit` completed successfully. |
| `pnpm test:state` | Pass | 15 document-state tests passed. |
| `pnpm build` | Pass | Frontend production build completed. |
| Focused Playwright drop-order check | Pass | Raw `tauri://drag-drop` did not open; `j3markdown://approved-file-drop` opened once with `droppedPaths: true`. |
| `pnpm test:flow` | Blocked | Fails before the drop scenario at `expectEditorContextMenuCommand`: active dirty tab timeout. |
| `pnpm test:unsaved` | Blocked | Fails before dirty-tab protection checks complete: active dirty tab timeout after editor input. |

Residual risks:

- Full e2e suites are currently blocked by an editor dirty-state test failure that occurs before the drag-drop scenario, so the drag-drop ordering fix was verified with a focused Playwright check instead.

## Latest Window Close Regression Check

Date: 2026-05-27
Environment: Windows development workspace at `C:\Users\dolco\Desktop\src\j3MarkDown`

Status: completed

Canonical sources checked before implementation:

- UI behavior: `docs/ui-behavior.md`
- Architecture boundary: `docs/architecture.md`

Finding:

- Native window close requests were already intercepted for dirty-document protection.
- The implementation had regressed to calling Tauri's `Window.close()` from the frontend after all dirty tabs were saved or discarded.
- Tauri 2 documents `Window.close()` as emitting another close-requested event, while `Window.destroy()` forces the window close after confirmation.
- Tauri 2's `core:window:default` permission does not include the `destroy` command, so the app capability must explicitly allow `core:window:allow-destroy`.
- The unsaved-change e2e also regressed to treating `Window.close()` as the successful post-confirmation command, so it no longer protected this failure mode.

Fix applied:

- `src/app/App.ts` now calls `getCurrentWindow().destroy()` after dirty-document protection is successfully resolved.
- `src-tauri/capabilities/default.json` now grants `core:window:allow-destroy` for the main window.
- Window close event registration, duplicate close-request suppression, and confirmed destroy continuation now live in `src/app/window-close-guard.ts`; `src/app/App.ts` remains responsible for resolving dirty tabs and showing modal errors.
- `tests/unsaved-protection.e2e.mjs` now asserts that the confirmed app-close path invokes the mocked Tauri destroy command only after every dirty tab is saved or discarded.
- `tests/unsaved-protection.e2e.mjs` now waits for the app shell on the close-listener failure path so cold Vite dependency loading does not fail before the app has mounted.
- `tests/window-close-guard.test.mjs` covers the close guard directly, including clean close pass-through, cancel, confirmed destroy, duplicate close requests while resolving, registration failure, destroy failure retry, and late unlisten cleanup.

Command results:

| Command/check | Result | Notes |
| --- | --- | --- |
| `corepack pnpm typecheck` | Pass | `tsc --noEmit` completed successfully. |
| `corepack pnpm test:unit` | Pass | 16 document-state checks and 8 window-close-guard checks passed. |
| `corepack pnpm test:unsaved` | Pass | 11 headless Chrome/CDP unsaved-change checks passed. |
| `corepack pnpm test` | Pass | State, unsaved protection, and Markdown user-flow e2e passed sequentially. |
| `corepack pnpm build` | Pass | TypeScript and Vite production build completed successfully. |
| `cargo test` in `src-tauri` | Pass | 37 Rust tests passed. |
| Native Tauri close check | Pass | After the refactor, `CloseMainWindow()` opened the dirty-close modal, choosing discard called the fixed destroy path and the window exited. |

Residual risks:

- The native check covered the Windows close-request path through `CloseMainWindow()` rather than a physical mouse click on the title-bar X.

## Latest Full Markdown Editor Regression Check

Date: 2026-05-13
Environment: Windows development workspace at `C:\Users\dolco\Desktop\j3MarkDown`

Status: completed

Canonical sources checked before implementation:

- Product scope: `docs/product-scope.md`
- File handling: `docs/file-handling.md`
- UI behavior: `docs/ui-behavior.md`
- Architecture: `docs/architecture.md`

Regression flow covered:

- App launch
- Markdown drag-and-drop open path through the frontend drop listener
- Multiple open tabs and tab switching
- Milkdown editing
- Save and Save As
- Dirty-tab close protection
- Unsupported file drop error modal
- Relaunch/reopen after saved content persisted in the e2e file fixture
- Native Tauri dev launch with real WebView rendering
- Native Tauri dev command-line open with real Rust file read path

Findings and fixes:

| Layer | Finding | Fix |
| --- | --- | --- |
| Verification script | `pnpm check` failed because no `check` script existed. | Added `check` as `pnpm typecheck`. |
| E2E coverage | No single regression covered the full user workflow end to end. | Added `tests/markdown-user-flow.e2e.mjs` using `playwright-core`; `pnpm test` now runs it after existing state and unsaved-change checks. |
| Console/runtime asset | Browser/WebView requested `/favicon.ico` and produced a 404 console error. | Added `<link rel="icon" href="/icon.ico" />` to `index.html`. |
| Windows package manager fallback | E2E dev-server bootstrap assumed `pnpm.cmd`; this workspace exposes `pnpm.ps1` and `corepack.cmd`. | Updated e2e bootstrap to use `corepack pnpm` on Windows and clean up spawned process trees. |
| Launch argument parsing | Native Tauri dev command-line open exposed `cargo run --color always`; `always` was treated as a Markdown path and produced a false unsupported-file modal. | Updated `src-tauri/src/launch_args.rs` to skip known switch values and added a Rust unit test for that path. |

Command results:

| Command/check | Result | Notes |
| --- | --- | --- |
| `pnpm check` | Pass | Runs `pnpm typecheck`; `tsc --noEmit` completed successfully. |
| `pnpm test` | Pass | 8 document-state tests, 10 unsaved-change e2e checks, and the full Markdown user-flow e2e passed. |
| `pnpm build` | Pass | Frontend production build completed and bundled the root icon asset. |
| `cargo check` from `src-tauri/` | Pass | Rust crate checked successfully. |
| `cargo test` from `src-tauri/` | Pass | 14 Rust tests passed. |
| `pnpm tauri build --debug --no-bundle` | Pass | Debug Tauri executable built at `src-tauri\target\debug\j3markdown.exe`. |
| Tauri dev launch with remote WebView check | Pass | Used the existing Vite server on `127.0.0.1:1420` and temporary remote-debug Tauri config; app rendered `Untitled.md`, Milkdown mounted, console/page errors were empty. |
| Native Tauri command-line open | Pass | Launched with two Markdown files; both opened as tabs, the last file was active, Rust logs showed cargo build/run, and no false unsupported-file dialog remained. |

Screenshots/logs:

- Playwright user-flow screenshots: `.test-output\markdown-user-flow\`
- Native Tauri launch screenshot/log: `.test-output\native-tauri-dev\`
- Native command-line open screenshot/log: `.test-output\native-tauri-launch-open\`
- Synthetic CDP drag attempt evidence: `.test-output\native-tauri-drag\`

Residual risks:

- The full drag-and-drop matrix is covered by the Playwright e2e through the app's Tauri API mock and by earlier physical Explorer evidence in this document. A new synthetic CDP drag event did not trigger Tauri's native WebView drag-drop API, so it was not used as proof of native drag behavior.
- Native Save As OS dialog interaction remains represented by controlled e2e command results and Rust save-path tests rather than manual dialog clicking in this pass.

## Latest Unsaved Change Protection Check

Date: 2026-05-13
Environment: Windows development workspace at `C:\Users\dolco\Desktop\j3MarkDown`

Status: completed

Canonical sources checked before implementation:

- UI behavior: `docs/ui-behavior.md`
- File handling: `docs/file-handling.md`
- Architecture boundary: `docs/architecture.md`

Finding:

- The dirty-tab close flow, save command result handling, and Tauri window close intercept were already routed through the expected state machine in `src/app/App.ts`.
- The unverified gap was regression coverage: previous automated tests did not exercise the actual modal DOM behavior, keyboard cancellation, save failure handling, or multi-dirty window close sequence.
- Tauri 2's official JavaScript API supports the current close guard shape through `getCurrentWindow().onCloseRequested(...)` and `event.preventDefault()`. `Window.close()` emits another close-requested event, so the existing confirmation flag remains necessary to avoid re-prompting after all dirty documents are resolved. Reference: https://tauri.app/reference/javascript/api/namespacewindow/#oncloserequested

Fix applied:

- Unsaved-change and error dialogs now explicitly set `aria-modal="true"` and `aria-describedby` while continuing to use native `dialog.showModal()`.
- Added `tests/unsaved-protection.e2e.mjs`, a headless Chrome/CDP e2e regression that mocks Tauri command outcomes and close-requested events without bypassing the app's modal, tab close, save, or window close paths.
- `pnpm test` now runs both the existing document-state tests and the unsaved-change e2e regression.

Scenario checks:

| Scenario | Result | Notes |
| --- | --- | --- |
| Dirty tab close, cancel button | Pass | Modal remained modal, default focus was `cancel`, dirty tab stayed open. |
| Dirty tab close, Escape | Pass | Escape cancelled the modal and preserved the dirty tab. |
| Dirty tab close, discard | Pass | Dirty tab closed without invoking save commands. |
| Dirty tab close, save | Pass | Path-backed tab invoked `save_markdown_file` and closed only after success. |
| Untitled dirty tab, save | Pass | Invoked `save_markdown_file_as` with `suggestedPath: null` and closed only after success. |
| Untitled dirty tab, Save As cancel | Pass | Dirty tab remained open. |
| Save failure during tab close | Pass | Modal error was shown; dirty tab stayed open. |
| Multiple dirty tabs during app close, cancel | Pass | Tabs were resolved one at a time; cancel stopped close. |
| Save failure during app close | Pass | App close was not invoked; dirty tab stayed open. |
| Multiple dirty tabs during app close, save/discard success | Pass | Window close was invoked only after every dirty tab was saved or discarded. |
| Native Tauri window close, dirty tab, Escape | Pass | Debug executable was launched with WebView2 remote debugging; `CloseMainWindow()` opened the unsaved modal, Escape cancelled it, and the dirty tab stayed open. |

Command results:

| Command/check | Result | Notes |
| --- | --- | --- |
| `pnpm test:unsaved` | Pass | 10 headless Chrome/CDP e2e checks passed. |
| Native Tauri close check | Pass | `src-tauri/target/debug/j3markdown.exe` opened the dirty-close modal from a Windows close request. |
| `pnpm typecheck` | Pass | `tsc --noEmit` completed successfully. |
| `pnpm test` | Pass | 8 document-state tests and 10 unsaved-change e2e checks passed. |
| `pnpm build` | Pass | Frontend production build completed. |
| `cargo check` from `src-tauri/` | Pass | Rust crate checked successfully. |
| `cargo test` from `src-tauri/` | Pass | 13 Rust tests passed. |
| `pnpm tauri build --debug --no-bundle` | Pass | Debug desktop executable built successfully. |

Residual risks:

- The broad e2e matrix mocks Tauri command results and close-requested event delivery in the browser to isolate frontend behavior.
- A native debug executable check covered Windows close-request delivery for dirty-tab cancel/Escape behavior.
- Native Save As OS dialog interaction is represented by controlled `save_markdown_file_as` results, so manual Windows dialog verification remains useful before release.

## Latest Markdown Drag-and-Drop Regression Check

Date: 2026-05-13
Environment: Windows development workspace at `C:\Users\dolco\Desktop\j3MarkDown`

Status: completed

Canonical sources checked before implementation:

- File handling: `docs/file-handling.md`
- UI behavior: `docs/ui-behavior.md`
- Architecture boundary: `docs/architecture.md`

Finding:

- At the time of this check, the code used Tauri 2's `getCurrentWebview().onDragDropEvent` path, which matched the official WebView drag-and-drop API.
- Tauri drag-drop payloads reached the frontend and Rust `open_markdown_file_at_path` could read supported files.
- The root bug was tab state pollution before drop handling: Milkdown can emit blank Markdown during initial editor setup, and the app treated that blank normalization as a dirty edit on the pristine `Untitled.md` tab.
- Because `isPristineUntitledTab` then returned false, the first dropped file opened in a new tab instead of replacing the initial blank tab.

Fix applied:

- `src/app/document-state.ts` treats blank editor output and blank saved Markdown as equivalent for dirty-state comparison, preserving a pristine untitled tab as empty.
- `src/app/file-drop.ts` logs received drag-drop payloads to the console for event-path diagnosis.
- `src/app/App.ts` now surfaces file-drop listener initialization failure in a modal instead of only warning in the console.
- `tests/document-state.test.mjs` covers the blank editor normalization case.

Scenario checks:

| Scenario | Result | Notes |
| --- | --- | --- |
| Single `.md` file drop | Pass | `single.md` opened as the only tab and showed Markdown content. |
| Single `.markdown` file drop | Pass | `single.markdown` opened as the only tab and showed Markdown content. |
| Multiple Markdown files dropped together | Pass | `multi-one.md` and `multi-two.markdown` opened as two tabs; the last dropped file was active. |
| Already-open file re-drop | Pass | Re-dropping `single.md` activated the existing tab; tab count stayed at one. |
| Unsupported extension drop | Pass | `unsupported.txt` kept `Untitled.md` and showed a modal error. |
| Folder drop | Pass | `folder-drop` kept `Untitled.md` and showed a modal error. |
| Path containing spaces and Korean text | Pass | `공백 한글 경로\한글 파일.md` opened and displayed its content. |
| Mixed supported and unsupported drop | Pass | Supported file opened; unsupported file was reported in a modal. |

Command results:

| Command/check | Result | Notes |
| --- | --- | --- |
| `pnpm test` | Pass | 8 Node tests passed. |
| `pnpm typecheck` | Pass | `tsc --noEmit` completed successfully. |
| `cargo test` from `src-tauri/` | Pass | 13 Rust tests passed. |
| `pnpm build` | Pass | Frontend production build completed. |
| Tauri dev WebView check | Pass | Used the already-running Vite server at `http://127.0.0.1:1420` and a temporary remote-debug Tauri config. |
| Physical Explorer single `.md` drop | Pass | Selected `single.md` in Windows Explorer with UIAutomation and mouse-dragged it into the Tauri window; it opened as one active tab. |

Residual risks:

- The full scenario matrix used emitted Tauri WebView drag-drop events against the actual running Tauri WebView target to exercise the app/Rust command path.
- Physical Windows Explorer dragging was additionally verified for a single `.md` file, but not repeated for every unsupported and multi-file scenario.
- A PowerShell OLE drag simulation attempt was discarded because it failed even against a simple WinForms drop target, so it was not used as evidence.

## Latest Milkdown Editor Synchronization Check

Date: 2026-05-13
Environment: Windows development workspace at `C:\Users\dolco\Desktop\j3MarkDown`

Status: completed

Canonical sources checked before implementation:

- Architecture: `docs/architecture.md`
- UI behavior: `docs/ui-behavior.md`
- File handling: `docs/file-handling.md`

Data-flow finding:

- `MarkdownEditor` correctly kept Milkdown internals behind the component boundary, but editor change events only returned Markdown content.
- `MarkdownApp` therefore applied editor-origin changes to the currently active tab at callback time instead of the tab that produced the event.
- Normal browser testing did not reproduce visible stale content, but the ownership boundary allowed late editor lifecycle events to dirty or overwrite the wrong tab after tab switches or file-open renders.

Fix applied:

- `docs/architecture.md` now records that editor change callbacks must identify the source document/tab instance.
- `src/components/MarkdownEditor.ts` emits `{ tabId, markdown }` and marks the mounted editor region with `data-editor-tab-id`.
- `src/app/App.ts` updates tab records by source `tabId`, refreshes active chrome only when the changed tab is still active, and ignores late events for removed tabs.
- `src/app/document-state.ts` exposes `updateTabMarkdownById` for source-owned tab updates.
- `tests/document-state.test.mjs` covers rich Markdown dirty/save behavior and source-tab-only updates.

Regression checks:

| Scenario | Result | Notes |
| --- | --- | --- |
| App startup editor rendering | Pass | Headless Chrome loaded the Vite app and found `.ProseMirror` mounted for the active tab. |
| Markdown input updates app state | Pass | Korean text, headings, list syntax, links, and code block text made the active tab dirty and updated status counts. |
| Tab switching replaces editor content | Pass | Switching from tab 2 back to tab 1 restored tab 1 content and did not show tab 2 content. |
| File open reflects editor content | Pass | Tauri `open_markdown_file` was mocked in-browser; the opened tab became active and Milkdown displayed the opened Markdown. |
| Save aligns `lastSavedMarkdown` and dirty state | Pass | Mocked save received the current Markdown content, then the opened tab returned to `저장됨` with no dirty marker. |
| Source tab identity remains aligned | Pass | Browser check confirmed `data-editor-tab-id` matched the active tab ID through startup, edit, tab switch, file open, and save. |

Command results:

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm test` | Pass | 7 Node tests passed. |
| `pnpm typecheck` | Pass | `tsc --noEmit` completed successfully. |
| `pnpm build` | Pass | `tsc && vite build` completed successfully. |
| `cargo test` from `src-tauri/` | Pass | 13 Rust tests passed. |
| Headless Chrome CDP scenario | Pass | Used the already-running Vite server at `http://127.0.0.1:1420` with Tauri invoke mocks for open/save. |

Residual risks:

- The browser automation used a Tauri command mock for file open/save, so native OS dialogs were not exercised in this check.
- Browser Use's Node REPL control surface was not available in this session; local Chrome DevTools Protocol automation was used instead.
- Multi-line CDP text insertion can normalize extra blank lines through ProseMirror, so the browser check asserts content preservation and state synchronization rather than exact rendered line count.

## Latest Command Baseline

Date: 2026-05-13
Environment: Windows development workspace at `C:\Users\dolco\Desktop\j3MarkDown`

Status: completed with one environment-blocked dev-server check

Scope: automated command verification and source/config inventory. No implementation bug fix was applied because the only failing command was caused by an already-running local Vite process occupying the configured dev port.

## Current Implementation Inventory

| Area | Current state |
| --- | --- |
| Product scope | `docs/product-scope.md` defines the current app as a Tauri 2 Windows Markdown editor using Milkdown. App-owned note catalog storage is explicitly out of scope for this MVP. |
| Frontend stack | Vite + TypeScript with app startup in `src/main.ts`, orchestration in `src/app/`, and reusable UI in `src/components/`. |
| Markdown editor | Milkdown is used in `src/components/MarkdownEditor.ts`. |
| Rust/Tauri commands | Commands are registered in `src-tauri/src/lib.rs`: `get_launch_paths`, `open_markdown_file`, `open_markdown_file_at_path`, `save_markdown_file`, and `save_markdown_file_as`. |
| Tauri config | `src-tauri/tauri.conf.json` runs `pnpm dev` for dev, `pnpm build` before build, uses `http://127.0.0.1:1420`, and reads production assets from `../dist`. |
| JavaScript tests | No JS unit or e2e test script/config/files were found. |
| Rust tests | Unit tests exist in `src-tauri/src/launch_args.rs` and `src-tauri/src/markdown_files.rs`. |

## Latest Markdown File IO Regression Check

Date: 2026-05-13
Environment: Windows development workspace at `C:\Users\dolco\Desktop\j3MarkDown`

Status: completed

Canonical source checked before implementation:

- File handling: `docs/file-handling.md`
- Architecture boundary: `docs/architecture.md`

Call path:

- Frontend file operations are routed through `src/app/file-commands.ts` with Tauri `invoke`.
- Rust commands are registered in `src-tauri/src/lib.rs`.
- Markdown file IO service logic is implemented in `src-tauri/src/markdown_files.rs`.
- No browser-side direct Markdown file reads or writes were found in `src/`.

Automated Rust coverage added in `src-tauri/src/markdown_files.rs`:

| Scenario | Coverage |
| --- | --- |
| Open `.md` file | `opens_md_markdown_and_utf8_korean_files` |
| Open `.markdown` file | `opens_md_markdown_and_utf8_korean_files` |
| Open UTF-8 Korean Markdown file | `opens_md_markdown_and_utf8_korean_files` |
| Save after modification | `save_updates_existing_markdown_file_without_hiding_failures` |
| Save As | `save_as_adds_default_md_extension_and_writes_content` |
| Reject unsupported extension | `rejects_unsupported_extension_before_creating_or_overwriting_file` |
| Missing file path handling | `missing_supported_path_returns_clear_error` |
| Windows paths with spaces | `opens_md_markdown_and_utf8_korean_files`, `save_updates_existing_markdown_file_without_hiding_failures` |

Test files are created under `src-tauri/test-workspace/markdown-file-io`, which is not an excluded path. Each test uses a process-scoped child directory and removes that child directory at test teardown.

Fix applied:

- Factored shared save-path service logic so direct save and Save As both validate Markdown extensions before writing and return saved metadata only after a successful write.
- Replaced the generic read/write error text with specific not-found, permission, UTF-8, and write-location messages that include the affected path.
- The frontend save flow already updates title/path/dirty state only after the Rust save command resolves successfully; failed saves still show a modal error and do not call the success-state update path.

## Command Results

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm typecheck` | Pass | `tsc --noEmit` completed successfully. |
| `pnpm build` | Pass | `tsc && vite build` completed successfully. |
| `cargo check` from `src-tauri/` | Pass | Rust crate checked successfully. |
| `cargo test` from `src-tauri/` | Pass | 6 Rust unit tests passed. |
| `pnpm tauri info` | Pass | Tauri environment and package versions resolved successfully. |
| `pnpm tauri build --debug --no-bundle` | Pass | Frontend build and Rust debug Tauri build completed successfully without packaging bundles. |
| `pnpm tauri dev --help` | Pass | Dev command options were available. |
| `pnpm tauri dev --no-watch --no-dev-server-wait` | Fail | `beforeDevCommand` ran `pnpm dev`, and Vite failed because `127.0.0.1:1420` was already in use by an existing `node.exe` Vite process for this repository. |
| Existing JS unit/e2e tests | Not available | No package script or Vitest/Playwright config/test files were found. |

## Dev Failure Analysis

Reproduction:

1. Keep an existing Vite process listening on `127.0.0.1:1420`.
2. Run `pnpm tauri dev --no-watch --no-dev-server-wait`.
3. The Tauri CLI starts `beforeDevCommand` from `src-tauri/tauri.conf.json`, which invokes `pnpm dev`.
4. Vite exits with `Error: Port 1420 is already in use`, and Tauri reports that `beforeDevCommand` terminated with a non-zero status code.

Root cause:

- This is an environment conflict, not a source implementation bug.
- `vite.config.ts` intentionally pins the dev server to host `127.0.0.1`, port `1420`, with `strictPort: true`.
- `src-tauri/tauri.conf.json` points Tauri dev mode at the same `http://127.0.0.1:1420` URL and starts `pnpm dev`.
- At verification time, port `1420` was already held by PID `9400`, a `node.exe` process running Vite from this repository.

No source fix was applied for this failure. Re-run the dev check after stopping the existing dev server, or intentionally use a temporary Tauri config override when validating against a server that is already running.

## Previous Manual Windows Check

Date: 2026-05-13
Environment: Windows development workspace at `C:\Users\dolco\Desktop\j3MarkDown`

Status: completed

## Check Results

| Check | Result | Notes |
| --- | --- | --- |
| App launches | Pass | `pnpm tauri:dev` was run with a temporary Tauri config using Vite port `1421` because local port `1420` was already occupied by an existing `node.exe` process. The Tauri window opened as `j3Markdown`. |
| Open `.md` file | Pass | Opened `alpha.md` through the native Open dialog. The tab title, editor content, and status path updated. |
| Open `.md` file by drag and drop | Pass | Triggered the registered Tauri WebView drag-drop callback with `gamma.md`; it opened as a new active tab. |
| Multiple files open as multiple tabs | Pass | Opened `alpha.md`, `beta.markdown`, and dropped `gamma.md`; each file had its own tab. |
| Reopening or dropping same file does not create duplicate tab | Pass | Reopened `alpha.md` and dropped `gamma.md` again; existing tabs were activated and tab count did not increase. |
| Edit content in Milkdown editor | Pass | Inserted text into the actual `.ProseMirror` editing surface; the active tab became dirty and status changed to modified. |
| Save writes file content | Pass | Saved the edited `gamma.md`; file content on disk was updated and dirty state cleared. |
| Save As writes file content to another path | Pass | Saved the active document as `gamma-save-as.md`; the new file was created, active tab title/path updated, and dirty state stayed clear. |
| Closing dirty tab shows save/discard/cancel modal | Pass | Closing a dirty tab opened a modal with save, discard, and cancel actions. Cancel kept the tab open and dirty. |
| Dropping unsupported file shows modal error | Pass | Dropping `unsupported.txt` opened a modal error and did not add a tab. |
| Build/typecheck | Pass | `pnpm typecheck`, `pnpm build`, and `cargo test` passed. |

## Residual Risks

- Physical mouse drag from Windows Explorer was not performed by hand; the check used the actual registered Tauri WebView drag-drop listener with native-style dropped file paths.
- The default Tauri dev port `1420` was already occupied in this environment, so app launch was verified on port `1421` through a temporary Tauri config override.
- Release packaging with `pnpm tauri:build` was not run; verification covered Tauri dev launch, frontend production build, TypeScript typecheck, and Rust tests.
