# j3Markdown

j3Markdown is a Windows desktop Markdown editor built with Tauri 2, TypeScript, and Milkdown.

It is designed for editing local `.md` and `.markdown` files in a simple tabbed desktop workflow.

## Project Status

This project was created as an in-house tool with help from AI. Test coverage and manual QA are still limited, so treat the application as experimental and keep backups of important Markdown files.

## Features

- Create and edit Markdown documents with a Milkdown-based editor.
- Open local `.md` and `.markdown` files.
- Work with multiple documents through tabs.
- Drag and drop supported Markdown files into the app.
- Save existing files or use Save As for new file paths.
- Protect unsaved changes with modal confirmation flows.
- Open a tab snapshot in a separate app window.
- Keep core editing, opening, saving, and tab behavior offline-first.

## Tech Stack

- Tauri 2 for the Windows desktop shell
- TypeScript and Vite for the frontend
- Milkdown / Crepe for the Markdown editing surface
- Rust for Tauri commands and file handling
- pnpm for JavaScript package management

## Development

The app source lives in the `src/` directory.

```powershell
cd src
corepack pnpm install
corepack pnpm tauri:dev
```

Useful checks:

```powershell
cd src
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm tauri:build
```

## Repository Layout

- `src/src/` - TypeScript frontend source
- `src/src/app/` - app orchestration, document state, file commands, and shell behavior
- `src/src/components/` - reusable UI and editor components
- `src/src-tauri/` - Tauri and Rust desktop backend
- `src/docs/` - project scope, architecture, behavior, and manual check documents
- `src/tests/` - Node and Playwright-based regression checks
- `src/THIRD-PARTY-NOTICES.txt` - generated runtime dependency notices

## License

This project is distributed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.

Third-party dependency notices are maintained in [src/THIRD-PARTY-NOTICES.txt](src/THIRD-PARTY-NOTICES.txt).

## Icon Notice

This project uses icons from [Google Fonts Icons](https://fonts.google.com/icons), including Material Symbols / Material Icons by Google, which are made available under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

Thank you to Google Fonts and the Material Design icon team for making these icons available.
