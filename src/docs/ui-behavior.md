# UI Behavior

This document is the canonical source for UI behavior. `docs/canonical-sources.md` maps the UI behavior topic to this file. Product scope remains canonical in `docs/product-scope.md`.

## App Shell

- The initial screen must be the Markdown editor app, not a marketing or landing page.
- The main app window must open at 600 x 500 by default.
- The default layout has four stable regions:
  - top toolbar
  - tab bar
  - central editing area
  - bottom status bar
- The layout should prioritize Windows desktop use with dense, predictable controls.
- Default product UI copy may be Korean.

## Keyboard Shortcuts

- `Ctrl+S` must save the active tab through the same Save workflow as the toolbar Save action. If the active tab has no file path, it must use the Save As workflow defined in `docs/file-handling.md`.
- `Ctrl+W` must close the active tab through the same tab-close workflow as the tab close button. Dirty tabs must still use the unsaved-change modal workflow defined in this document.
- `Escape` must dismiss open app-owned context menus. When an app-owned modal dialog is open, `Escape` must resolve that dialog through its existing cancel behavior.
- App-level document shortcuts must not bypass modal workflows, save conflict decisions, file picker ownership, or unsaved-change protection.

## UI Copy

- User-visible copy should use short, plain words.
- Dialog headings and button labels should be easy to scan.
- Error messages should state what failed and what the user can do, without long explanations.
- The application UI must support English and Korean.
- English is the default UI language.
- The selected UI language is an application setting, not tab or document state, and must apply to every open Markdown document.
- Changing the selected UI language must keep open tabs, active Markdown content, and dirty state intact.
- User-visible app chrome, modal dialog, tab/menu, and status bar copy should follow the selected UI language.

## Toolbar

- The toolbar contains direct document actions for new document, open, save, and save as.
- The toolbar must include an About action at the far right that opens an app-owned modal About dialog.
- Controls may be disabled when their action is unavailable.
- Toolbar actions must not navigate away from the editor shell.
- The toolbar must expose the program-wide Milkdown theme setting.
- The toolbar must expose the program-wide UI language setting.
- The language setting must let the user switch between English and Korean.
- The theme setting must let the user switch between the supported bundled Crepe themes: Classic, Classic Dark, and Nord Dark.
- Frame and Frame Dark must not be shown as selectable editor themes.
- The theme setting may also include application-provided Milkdown theme variants that reuse bundled Crepe theme styles with app-owned color overrides.
- Application-provided theme variants must be listed in the same program-wide theme setting and follow the same persistence and active-document preservation rules as bundled Crepe themes.
- The selected theme is an application setting, not tab or document state, and must apply to every open Markdown document.
- The selected theme should persist across app restarts.
- Changing the selected theme must keep open tabs, active Markdown content, and dirty state intact.
- Nord Dark must also apply the `@milkdown/theme-nord` Milkdown configuration so direct Milkdown Nord styling is active with the Crepe Nord palette.

## Tabs

- Open Markdown documents are represented as tabs.
- The active tab controls the editor content and status bar metadata.
- Dirty tabs should show a visible unsaved state.
- Each tab stores `id`, `title`, `filePath`, `markdown`, `dirty`, and `lastSavedMarkdown`.
- A new document is represented as an untitled tab with `filePath` set to `null`.
- Opening a file path that is already open must activate the existing tab instead of creating another tab.
- The tab title displays the file name for saved files, an untitled label for new files, and a visible dirty marker when `dirty` is true.
- Hovering a tab for a saved file must show the full `filePath` in an app-owned tab tooltip; untitled tabs may use the displayed tab title as the tooltip. Long tooltip paths must wrap within the viewport instead of overflowing or relying on an unwrapped native browser tooltip.
- Right-clicking a tab must open an app-owned tab context menu with open-in-new-window and close-other-tabs actions, labeled in the selected UI language.
- The open-in-new-window tab context action must be disabled when only one tab is open.
- Choosing open-in-new-window must open that tab's current in-memory Markdown snapshot in a separate app window.
- After the separate window consumes the transferred snapshot, the source tab must close in the original window without showing an unsaved-change confirmation because the new window owns the snapshot.
- If the separate window cannot consume the transferred snapshot, the source tab must remain open and keep its current dirty state.
- A document opened in a separate window must preserve its title, `filePath`, Markdown content, saved baseline, and dirty state as an independent tab snapshot.
- After the new window opens, edits in the source window and the new window are independent in-memory tab states. Saving either window writes through that tab's current file association when one exists.
- The close-other-tabs tab context action must be disabled when only one tab is open.
- Choosing close-other-tabs must keep the clicked tab open and attempt to close every other open tab.
- Dirty tabs closed by close-other-tabs must use the same unsaved-change modal workflow as ordinary tab close.
- If the user cancels or a save fails while closing other tabs, the app must stop closing additional tabs and keep the remaining tabs open.
- Tab switching must replace the Milkdown editor document with the selected tab's `markdown` value without losing the previous tab's unsaved content.
- Tab switching must preserve each open tab's editor scroll position as in-memory UI state while the tab remains open.
- The tab bar has a stable height, horizontal overflow handling, and tab labels must truncate instead of overflowing outside tab or button bounds.
- Closing a dirty tab must be protected by the unsaved-change modal workflow defined in this document.

## Editor Area

- The editor area is the canonical Markdown WYSIWYG editing surface and must render a Milkdown-based editor.
- The initial editor document must come from the active tab's Markdown content. If no file is loaded, the Untitled tab provides the initial Markdown value.
- Editor value changes must update the active tab's Markdown state through an explicit application callback.
- App-level document state and future file IO logic must not depend on Milkdown internals directly; Milkdown-specific lifecycle and APIs stay behind the editor component boundary.
- The editing region should fill the available center space, support long document content, and keep a quiet Windows desktop editing style.
- The Milkdown editor must expose Crepe block editing controls so users can insert Markdown blocks from the left-side add handle and move blocks from the adjacent drag handle.

## Editor Context Menu

- The app must suppress the WebView/browser default context menu so right-click never exposes web navigation, page, source, print, inspect, image, link, or search-provider actions.
- Right-clicking inside the Markdown editor opens an app-owned editor context menu focused on local document editing.
- The editor context menu may include undo, redo, cut, copy, paste, select all, and compact Markdown formatting commands such as bold, italic, and inline code.
- The editor context menu must not include global document actions such as New, Open, Save, Save As, app settings, or destructive workflow choices; those remain in the toolbar or modal workflows.
- Right-clicking outside the Markdown editor must not show a browser-style fallback menu.
- The editor context menu is a transient desktop context menu for direct commands only. It must dismiss on Escape, outside pointer interaction, command selection, focus loss, or editor rerender, and it must not be used for confirmations or multi-step choices.

## Drag and Drop

- The app window accepts Windows Explorer drops for Markdown document open workflows defined in `docs/file-handling.md`.
- Drag-over and drop feedback must not change the shell's region sizes, shift tabs, or move editor content.
- Unsupported dropped files and MVP-unsupported folder drops must be explained through a modal dialog.
- Supported files from the same drop should still open when unsupported files or folders are also present.

## Status Bar

- The status bar shows compact document state, such as active file label, dirty state, line count, word count, and editor readiness.

## Modal Workflows

- Popup workflows used for confirmation, unsupported file feedback, open/save choices, or tab close decisions must be modal.
- Native Markdown file dialogs for Open and Save As, including Save on an untitled document, must be owned by the main app window so Windows presents them centered over that window.
- The About dialog must be modal, show the app version, display the bundled `about.txt` content, and include `https://github.com/edgarp9` at the bottom.
- Activating the About dialog's `https://github.com/edgarp9` link must open that URL in the user's default browser through a desktop app command.

## Unsaved Change Protection

- When the user attempts to close a dirty tab, the app must show a modal dialog before closing the tab.
- The dirty-tab close dialog must offer exactly three outcomes: save, discard, and cancel.
- Choosing save must save that tab and close it only after the save succeeds.
- If the tab has no `filePath`, choosing save must use the Save As workflow defined in `docs/file-handling.md`.
- Choosing discard must close the tab without saving it.
- Choosing cancel must stop the close action and keep the tab open.
- App exit and window close attempts must apply the same dirty-document protection before the app is allowed to close.
- If multiple dirty tabs must be protected during app exit or window close, the app must resolve them one at a time and stop the close attempt immediately when the user cancels or a save error occurs.
- Save errors during unsaved-change protection must be shown in a modal error dialog and must not close the tab or app window.
- Unsaved-change protection dialogs must set a sensible default keyboard focus and support Escape as cancel.
