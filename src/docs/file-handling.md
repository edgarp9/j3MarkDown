# File Handling

This document is the canonical source for persistence and file-handling behavior. `docs/canonical-sources.md` maps the persistence/file handling topic to this file.

## Markdown Files

- The app supports opening multiple Markdown documents at the same time through tabs.
- External Markdown file access must go through Tauri commands implemented in the Rust backend.
- The frontend must not read or write local Markdown files directly through browser filesystem APIs.
- Supported Markdown file extensions are `.md` and `.markdown`, matched case-insensitively.
- Unsupported file extensions must be rejected before reading or writing.
- Markdown files are treated as UTF-8 text.
- Opening a Markdown file creates a tab for that path, loads its content into that tab, and activates it.
- If the selected file path is already open, opening it again activates the existing tab and does not create a duplicate tab.
- New unsaved documents are represented as untitled tabs with `filePath` set to `null`.
- Saving writes the active tab's Markdown content back to its current `filePath` and clears that tab's dirty state after a successful write.
- Saving a path-backed tab must compare the current target file fingerprint against the tab's last known saved/opened fingerprint before writing. If the target file was changed or deleted outside the app, the normal save must not overwrite it without an explicit modal user decision.
- The save conflict modal must keep the tab's in-memory Markdown intact unless the user explicitly chooses to reload the external file. It must offer cancel, reload from disk, Save As, and overwrite choices.
- Choosing overwrite in a save conflict modal writes the current tab Markdown to the same target path, updates the tab's file fingerprint from the written file, and clears the tab's dirty state only after a successful write.
- Choosing reload in a save conflict modal reads the current external file through the backend Markdown open command path, replaces the tab content with that file content, updates the tab's file fingerprint, and clears the tab's dirty state.
- Choosing Save As in a save conflict modal uses the normal Save As destination picker and writes the current tab Markdown to the selected target without discarding the tab content.
- Save As prompts for a destination path, writes the active tab's Markdown content, stores the destination path in that tab, updates its title from the saved file name, and clears its dirty state after a successful write.
- Failed open or save operations must be shown to the user in a modal dialog.
- The bottom status area must show the active document file path when available.
- File paths must be passed as strings through the frontend command boundary and handled safely for Windows paths by the Rust backend.

## Markdown File Drag and Drop

- Windows Explorer file drops onto the app window are an external Markdown open workflow.
- Dropping one or more supported Markdown files opens each file in its own tab and activates the last newly opened or selected dropped file.
- Dropping a file path that is already open activates the existing tab and must not create a duplicate tab.
- The frontend may receive dropped file paths from the official Tauri webview drag-and-drop API, but file content must still be read through an existing Markdown Tauri command path.
- Dropped file paths must be validated before reading. Supported extensions remain `.md` and `.markdown`, matched case-insensitively.
- Unsupported dropped file extensions must be reported in a modal dialog and must not block supported Markdown files from the same drop.
- Folder drops are not supported in the MVP. Dropped folders must be reported in a modal dialog and must not be opened as documents.
- Drag-and-drop open behavior must not introduce browser-side direct filesystem reads.

## Command-Line Markdown Open

- Launch arguments are an external Markdown open workflow, matching the Windows Notepad pattern of starting the program with one or more file paths.
- When the executable is started with file path arguments, the app opens each supported Markdown file in its own tab during startup and activates the last successfully opened or already-open file.
- Launch paths must be collected by the Rust backend and passed to the frontend through a typed Tauri command.
- The frontend must not read command-line target files directly through browser filesystem APIs; file content must still be read through the existing Markdown Tauri command path.
- Launch paths must be validated before reading. Supported extensions remain `.md` and `.markdown`, matched case-insensitively.
- Unsupported launch path extensions, folders, unreadable files, or missing files must be reported in a modal dialog and must not block supported Markdown files from the same launch.
- Duplicate launch paths must activate the existing tab and must not create duplicate tabs.

## Application Configuration

- The app-owned configuration file must be stored in the same directory as the running program executable.
- The configuration file name must be derived from the executable file name with the extension replaced by `.toml`.
  - Example: `j3markdown.exe` stores configuration in `j3markdown.toml`.
- If the configuration file does not exist, the Rust backend must create it automatically during app startup with valid default TOML content.
- If the configuration file cannot be resolved or created during app startup, startup must fail with that error instead of continuing without configuration.
- If the configuration file already exists, startup must preserve the existing file content.
- The frontend must not read or write the configuration file directly through browser filesystem APIs.
- The configuration file stores application settings for editor theme and UI language.
- The default UI language setting is `en`.
- Supported UI language setting values are `en` and `ko`.

## App-Owned Structured Persistence

- The current Markdown editor MVP does not require an app-owned structured content store.
- External Markdown file open/save behavior must remain independent from any future structured storage decision.
