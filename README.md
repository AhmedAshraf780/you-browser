# UniBrowser — web + notes in one tab bar

Electron (Chromium) shell where `youtube`, `cache.md`, `test.excalidraw`, `doc.pdf`
live as equal tabs next to each other.

## Run

```bash
npm install   # downloads Electron binary (needs access to github releases)
npm run dev   # Vite HMR + Electron
npm run build # out/main + out/preload + out/renderer
```

If `electron --version` says "failed to install correctly" in a sandbox,
run `node node_modules/electron/install.js` once with network, then retry.

## How it works

- `src/main/index.ts` — BrowserWindow with `webviewTag: true`, vault IPC.
  Vault = any folder you pick via **Open folder** in the sidebar (native dialog),
  persisted in `userData/settings.json`. Watched with chokidar — edits from
  VSCode/Obsidian/file manager refresh the sidebar live. Traversal outside the
  vault is rejected.
- `src/renderer/components/FileExplorer.tsx` — folder tree (dirs first, alpha
  sort, dotfiles hidden). Filter box, active-tab highlight, flash on
  newly created nodes. Right-click any node (or empty space) for
  New note / New drawing / New folder / Rename / Delete. Rename and delete
  retarget/close affected tabs automatically. New tabs via the `+ New tab`
  button (opens a web tab).
- Adblocking (`@ghostery/adblocker-electron` in `src/main/index.ts`) —
  uBlock-compatible filter lists (EasyList + tracking) enforced at the
  session level for all web tabs. Engine downloads once on first run, cached
  in `userData/adblock-engine.bin`. Toggle in the toolbar, persisted in
  `settings.json`. YouTube is exempted from network blocking (it stalls the
  player and trips the anti-adblock wall) and is handled instead by an
  in-page skipper (`src/renderer/adskip.ts`, injected from `WebTab.tsx`):
  pre-rolls seek to end + mute, skip buttons auto-click, ad chrome hidden.
- Minimal single-bar UI (`src/renderer/App.tsx` + `styles.css`): one 40px top
  bar holds the sidebar toggle, tabs, `+`, reload and omnibox — everything
  else is content. Activity rail (Vault, Board, Cal, Settings) switches the
  side panel; clicking the active icon collapses it. Prefs persist.
- 5 themes × dark/light (`ThemePicker.tsx`, CSS vars in `styles.css`):
  Black Metal · Immortal, Rosé Pine, Catppuccin, Gruvbox, Tokyo Night.
  Markdown preview and the Excalidraw canvas follow the mode. Theme choice
  persists in localStorage. Picker lives in Settings now.
- Kanban board (`KanbanTab.tsx`, persisted `ub.kanban`): full-page horizontal
  board (Backlog, To Do, In Progress, Done) with per-column ticket input +
  round add button, drag-and-drop between columns, inline add/edit, column
  add/rename/delete. Opened from the rail; reuses the existing tab.
- Calendar (`CalendarPanel.tsx`): month grid with vault-activity dots (from
  file mtimes), per-day modified files, one-click daily notes into
  `journal/YYYY-MM-DD.md`.
- Settings panel (`SettingsPanel.tsx`): appearance, adblock toggle, vault
  switcher, clear-history, shortcuts, about.
- All tabs stay mounted (`App.tsx`): switching tabs hides instead of
  destroying, so web media keeps playing in the background and editors keep
  undo/scroll state.
- `Ctrl+T` quick-open palette (`QuickOpen.tsx`): floating fuzzy finder over
  open tabs, vault files, URLs and web search. Intercepted in the main
  process (`before-input-event` on host + guest contents), so it fires even
  when a video page has focus. `Ctrl+B` travels the same path (skipped
  inside pages so Docs bold keeps working).
- Markdown editor (`MarkdownTab.tsx`): CodeMirror 6 with md highlighting and
  a single var-driven theme covering all 5 palettes × dark/light, live
  preview via `marked`, 600ms autosave.
- Home dashboard (`HomeTab.tsx`, opened with `+`): live clock + greeting,
  recent sites (from persisted browsing history), recent notes (by file
  mtime, live from the watcher), local scratchpad (autosaved, no file),
  and a persisted to-do list. Fully themed.
- Scrollbars: thin themed overlay-style bars on every in-app surface
  (explorer, tabs content, editors, home, popups) via global
  `::-webkit-scrollbar` + `scrollbar-*` rules. Web pages keep their own —
  guest documents can't be styled from the host.
- `src/preload/index.ts` — `window.vault` bridge (contextIsolation safe).
- `src/renderer/` — React shell:
  - `tabs.ts` — `Tab = web | markdown | excalidraw | pdf`, `target` = URL or vault path
  - `store.ts` — zustand tab state, seed: youtube + cache.md + test.excalidraw
  - `components/WebTab.tsx` — `<webview partition="persist:unibrowser">`
  - `components/MarkdownTab.tsx` — textarea + `marked` preview, 600ms autosave
  - `components/ExcalidrawTab.tsx` — `@excalidraw/excalidraw`, JSON autosave every 1s
  - `components/PdfTab.tsx` — iframe (URL or vault base64 blob)
  - `App.tsx` — tab strip + omnibox (URL, search, or `cache.md` path) + vault sidebar
- `vault/` — your files. Drop `.md`, `.excalidraw`, `.pdf` here, they appear in sidebar.

## Next steps

1. Back/forward/reload buttons wired to webview ref, per-tab history.
2. Split view (two active tabs), `[[wiki-links]]` between md files.
3. Persist open tabs to `electron-store`, add `Cmd+T` fuzzy finder over history + vault.
4. Adblock (`@cliqz/adblocker-electron`), downloads handler, `window.open` → new web tab.
