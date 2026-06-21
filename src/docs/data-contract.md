# Data Contract

This document is the canonical source for app-owned structured data contracts.

## Current Scope

The current Markdown editor MVP has no app-owned structured content store and no persisted structured data schema.

Markdown document persistence is file-based and is governed by `docs/file-handling.md`.

## Command Payloads

The only durable content command payloads in scope are Markdown file open/save request and response shapes exposed through Tauri commands.

Markdown file open responses must include:

- `path`: canonical Windows-safe path string for the opened file.
- `title`: display file name.
- `content`: UTF-8 Markdown text.
- `fileFingerprint`: opaque fingerprint string for the file content state that was read. The current fingerprint is computed by the Rust backend from the target file's content bytes and stable metadata such as byte length. The frontend must store and return this value as an opaque string and must not parse it.

Markdown file save requests for an existing path-backed tab must include:

- `path`: target Markdown path string.
- `content`: UTF-8 Markdown text to write.
- `expectedFileFingerprint`: the tab's last known saved/opened `fileFingerprint`, or `null` when the tab has no known baseline for the target.
- `allowExternalOverwrite`: `true` only after an explicit user overwrite decision or for Save As flows where the user has selected a destination path and no target baseline is being protected.

Markdown file save responses must be typed results:

- `status: "saved"` with `file` containing the saved `path`, `title`, and new `fileFingerprint`.
- `status: "conflict"` with `conflict` containing the target `path` and a `reason` of `"modified"` or `"deleted"` when the target file's current fingerprint no longer matches `expectedFileFingerprint`.

Opening a tab in a new app window may pass a non-durable document snapshot through Tauri commands. That snapshot contains only the tab title, optional `filePath`, current Markdown text, saved Markdown baseline, dirty state, and save-target-detached state needed to recreate the tab in the destination window. The snapshot is in-memory handoff data, not app-owned structured persistence.

The About dialog may read non-durable application metadata through a Tauri command. The response contains the app `version` and fixed `githubUrl`; it is not an app-owned content persistence contract. Opening the About link uses a no-argument command that opens only the fixed project URL. Bundled `about.txt` text is a release resource exposed through a no-argument text command with embedded fallback text; it is not app-owned structured persistence.

Future app-owned structured storage must update this document before implementation.
