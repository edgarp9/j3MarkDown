# AGENTS.md

## Project Goal
- Build a Windows desktop Markdown editor with `Tauri 2`.
- The app must let users open, edit, and save local Markdown files inside the program.
- The app must support multiple open Markdown documents through tabs.
- The app must protect unsaved document changes with modal confirmation flows.

## Document-Driven Development and SSOT
- Develop this project with Document-Driven Development.
- Repository-wide product and engineering rules must use this `AGENTS.md` as the canonical document.
- Topic-to-canonical-document mapping must be maintained only in `docs/canonical-sources.md`.
- Each major topic must have one and only one canonical document.
  - Examples: product scope, architecture, data contract, storage format, UI behavior
- Before implementing a non-trivial change, confirm which document is the canonical source for that topic.
- If a requirement changes, update the canonical document first, then update code.
- Reflect requirement changes in one authoritative location only. Do not edit the same rule in multiple files as if they were equal sources.
- Duplicate documents are not allowed.
- Summary documents are allowed only when they clearly link to the canonical source and are labeled as non-canonical.
- If two documents conflict, the canonical document wins and the duplicate or stale document must be corrected or removed.
- Do not treat scattered notes, comments, TODO text, or chat transcripts as source-of-truth documentation unless they are explicitly promoted to a canonical document.

## Core Stack
- Desktop shell: `Tauri 2`
- Markdown editor surface: Milkdown
- Frontend package manager: `pnpm` (use `corepack pnpm` when a global `pnpm` install is unavailable)
- The app should be offline-first. Do not add network dependencies for core features.

## Persistence Rules
- External Markdown file persistence is the only required content persistence for the current app.
- Markdown file open and save behavior is defined in `docs/file-handling.md`.
- App-owned configuration is stored beside the executable as defined in `docs/file-handling.md`.
- Do not add an app-owned structured storage layer unless the canonical product scope and data contract are updated first.

## Data Rules
- Markdown document content must be stored as UTF-8 text when written to external files.
- Local file paths must be treated as opaque Windows-safe strings across the frontend/backend command boundary.
- Unsaved tab state is in-memory UI state and must not be treated as a durable storage format.

## Required Features
- Users must be able to create untitled Markdown tabs.
- Users must be able to open local `.md` and `.markdown` files.
- Users must be able to edit Markdown content with the shared WYSIWYG editor.
- Users must be able to save and Save As through backend file commands.
- Users must be able to close tabs.
- Any popup UI must be modal.
- Unsaved changes must trigger a modal confirmation before data loss.

## Tauri File Rules
- Handle Markdown file reads and writes in Rust service logic behind Tauri commands.
- Keep frontend calls typed and explicit.
- Do not let the frontend read or write local Markdown files through browser-only file APIs.
- Final command naming should follow the canonical file-handling contract.

## UI Direction
- Prioritize a Windows desktop workflow.
- Default copy can be Korean in the product UI, but code and file formats should stay robust on Windows.
- All popups must be modal dialogs.
- Use modal dialogs for file picker, confirmation, and settings flows when those actions are presented as popup UI.
- The main workflow should prioritize editor space, tab switching, toolbar actions, and status feedback.
- Full document editing should support long content and scrolling.

## Empty Repo Bootstrap
- If the repo is still empty, scaffold a `Tauri 2` app at the repository root.
- Prefer a TypeScript frontend.
- Use `pnpm` for frontend dependency installation and script execution. On Windows, `corepack pnpm` is the fallback when a global `pnpm` shim is unavailable.
- Initial implementation order:
  - app boot
  - Markdown editor rendering
  - file open
  - file save
  - tab state
  - unsaved-change protection

## Guardrails
- Do not add an app-owned structured storage layer without updating canonical docs first.
- Keep Tauri file commands behind shared validated Rust service logic.
- Do not bypass the Markdown editor component boundary and scatter raw editor APIs across unrelated frontend modules without a canonical architecture update.
- Do not add `npm` or `yarn` lockfiles; keep `pnpm-lock.yaml` as the JavaScript lockfile.
- Optimize first for working Windows behavior, not cross-platform abstraction.

## Excluded Paths and Patterns
추가 제외 경로/패턴:

`node_modules/`, `.pnpm-store/`, `.debug/`, `.git/`, `.my/`, `.idea/`, `.vscode/`, `dist/`, `coverage/`, `playwright-report/`, `test-results/`, `.tmp*/`, `target/`, `src-tauri/target/`, `*.rlib`, `*.rmeta`, `*.profraw`, `*.profdata`, `*.pdb`, `*.ilk`, `*.log`, `*.tmp`, `*.bak`, `.DS_Store`, `Thumbs.db`, `Desktop.ini`, `*~`, `*.swp`, `*.swo`

By default, matching files, directories, and all descendants are excluded from reading, searching, candidate discovery, evidence citation, edit planning, and instruction generation. Do not create, modify, delete, move, rename, or format inside them.

If the user explicitly asks to work inside an excluded path or pattern, those operations are allowed only within that stated scope.

## Minimum Manual Checks
- The app launches on Windows.
- The app creates the executable-local configuration file when needed.
- The app can open supported Markdown files.
- The app can save supported Markdown files.
- Save As updates the active tab file association.
- Drag and drop opens supported Markdown files.
- Closing a dirty tab shows a modal confirmation.
- Tab state stays isolated while switching between open documents.


## 과도한 설계 피하기

깔끔하고 읽기 쉽고 유지보수하기 쉬운 코드를 작성하되, 불필요한 설계는 피하십시오.

중복, 실제 변경 압박, 테스트 용이성 또는 기존 프로젝트 패턴으로 정당화되기 전까지는 단순하고 구체적인 구현을 우선하십시오.

미래에 필요할 수도 있다는 이유만으로 인터페이스, 팩토리, 전략 패턴, 제네릭 레이어, 래퍼, 설정 기반 구조를 도입하지 마십시오.

모든 추상화는 현재 코드베이스 안에서 구체적인 이유가 있어야 하며, 추가할 경우 최소한으로 유지하고 주변 코드와 일관되게 작성하십시오.
