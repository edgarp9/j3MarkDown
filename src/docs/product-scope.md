# Product Scope

This document is the canonical source for product scope. `docs/canonical-sources.md` maps the product scope topic to this file. Other documents may link here, but must not restate these requirements as an equal source of truth.

## Scope Decision

The product goal is a Tauri 2 based Windows desktop Markdown editor.

The editor uses Milkdown as the Markdown editing surface.

## MVP

- Run as a Windows desktop app built with Tauri 2.
- Edit Markdown content through Milkdown.
- Open local `.md` and `.markdown` files.
- Keep multiple opened Markdown files in tabs.
- Let the user switch between tabs without losing each tab's content or dirty state.
- Open a tab's Markdown document snapshot in a separate app window from the tab context menu.
- Open `.md` and `.markdown` files by drag and drop.
- When a file is opened again, activate the existing tab for that file instead of creating a duplicate tab.
- Save the active tab to its current file path.
- Save the active tab to a new file path with Save As.
- Close tabs.
- If a tab has unsaved changes, show a modal confirmation before closing it or replacing the app state.
- Treat popup UI as modal UI for MVP workflows.
- Keep core editing, opening, saving, tab management, and close-confirmation behavior offline-first, without adding network dependencies.

## Non-Scope

- App-owned note catalog storage is not required for this Markdown editor MVP.
- Network sync, collaboration, accounts, cloud file storage, and remote plugin loading are not core features.
- Export formats beyond Markdown file save are not required.
- Rich document management features such as global search, tags, backlinks, and workspace indexing are not required.
- Cross-platform behavior is secondary to correct Windows desktop behavior.

## User Flows

### Open Markdown File

1. The user opens a local `.md` or `.markdown` file.
2. The app creates a tab for the file when it is not already open.
3. The app loads the file content into Milkdown.
4. The tab title reflects the file name.

### Drag And Drop Markdown File

1. The user drops one or more `.md` or `.markdown` files onto the app.
2. The app opens each supported file in a tab.
3. Unsupported dropped files are ignored or rejected through modal feedback.
4. Files already open activate their existing tabs instead of creating duplicates.

### Edit And Save

1. The user edits Markdown content in Milkdown.
2. The tab becomes dirty after an unsaved change.
3. Save writes the active tab content to its current file path.
4. A successful save clears the tab's dirty state.

### Save As

1. The user chooses Save As for the active tab.
2. The app asks for a destination path with a modal file dialog or modal app flow.
3. The app writes the current Markdown content to that path.
4. The tab is associated with the saved path and its dirty state is cleared.

### Close Tab With Unsaved Changes

1. The user closes a dirty tab.
2. The app shows a modal confirmation.
3. The user can save, discard changes, or cancel the close.
4. Cancel leaves the tab open and unchanged.

### Open Tab In New Window

1. The user opens a tab's context menu.
2. The user chooses the new-window action.
3. The app opens a separate app window containing one tab initialized from that tab's current in-memory Markdown snapshot.
4. After the new window opens, the source tab closes in the original window.
5. If only one tab is open in the original window, the new-window action is unavailable.
6. Unsaved state is preserved in the new window, and later edits in either window are independent until a save writes to the associated file path.

## Completion Criteria

- The app launches as a Tauri 2 Windows desktop app.
- Milkdown is the active Markdown editing surface.
- At least two local `.md` or `.markdown` files can be open in separate tabs.
- Dragging and dropping a supported Markdown file opens it.
- Opening the same file twice activates the existing tab and does not create a duplicate.
- Editing marks only the affected tab as dirty.
- The tab context menu can open its target document in a separate app window.
- Save writes the current tab content to disk and clears its dirty state.
- Save As writes the current tab content to the chosen path, updates the tab's file association, and clears its dirty state.
- Closing a dirty tab shows a modal confirmation with save, discard, and cancel outcomes.
- Popup workflows used by the MVP are modal.
- Core MVP features work without network access.
