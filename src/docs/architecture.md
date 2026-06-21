# Architecture

This document is the canonical source for architecture. `docs/canonical-sources.md` maps the architecture topic to this file. Product scope remains canonical in `docs/product-scope.md`.

## Desktop Shell

- The app is a Tauri 2 Windows desktop application.
- The frontend is a Vite-powered TypeScript application served by Tauri during development and bundled into `dist/` for production.
- The JavaScript package manager is `pnpm`; do not add npm or Yarn lockfiles.
- Core editor features must work offline after installation and must not depend on network runtime services.
- The Windows executable and main application window use `src-tauri/icons/icon.ico`, which must stay synchronized with the repository-root `icon.ico` asset.
- VS Code F5 development launch must run through the repository-owned VS Code Tauri dev lifecycle scripts. The start script records the launch root PID, and the stop task must terminate that recorded Windows process tree so Shift+F5 also cleans up Tauri CLI, Vite, Cargo, Rust compiler, and app child processes.

## Frontend Structure

- Keep the startup entry in `src/main.ts`.
- Keep app orchestration in `src/app/`.
- Keep reusable UI regions in `src/components/`.
- Keep editor-specific code behind a `MarkdownEditor` component so Crepe can evolve without changing the app shell.
- Keep state helpers separate from rendering code when behavior grows beyond the scaffold.
- Keep desktop drag-and-drop event registration and dropped-path normalization in a focused app helper or adapter instead of distributing raw Tauri drag event handling across UI components.
- Keep tab context menu rendering in the tab bar/app shell boundary, with tab actions flowing through explicit callbacks instead of direct document state mutation inside reusable tab UI.

## Editor Integration

- `@milkdown/crepe` is the Markdown WYSIWYG editing surface for the MVP defined in `docs/product-scope.md`.
- Keep the Crepe instance, lifecycle, theme imports, feature configuration, and Markdown serialization behind the `MarkdownEditor` component boundary.
- Editor content changes should flow through explicit component callbacks rather than direct cross-module DOM mutation.
- Editor change callbacks must identify the document/tab instance that produced the change so late editor lifecycle events cannot be applied to the wrong active tab.
- App-level state may update tab records by editor-owned document identity, but Crepe and Milkdown-specific lifecycle and serialization details must remain behind the `MarkdownEditor` component boundary.

## Backend Boundary

- Rust code owns the Tauri application bootstrapping and future filesystem or OS integrations.
- Rust code owns process launch argument collection and exposes launch file paths to the frontend through typed Tauri commands.
- Rust code owns runtime app-window creation for opening a tab snapshot in a separate window.
- Runtime document-window creation must use an in-memory Rust handoff keyed by a launch token. The handoff is consumed by the destination window and must not become durable app-owned document storage.
- Frontend code should call typed Tauri commands or official Tauri APIs for desktop capabilities instead of using browser-only assumptions.
- Dropped file opening must not be triggered from the raw JavaScript `tauri://drag-drop` event because Tauri emits that event before app-level drag-drop handlers run. For the main `WebviewWindow`, Rust must handle `WindowEvent::DragDrop`, approve dropped paths first, then emit an app-owned dropped-file event for the frontend to open.
