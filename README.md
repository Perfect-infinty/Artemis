# Artemis

A desktop AI chat app built with **Electron + React + Vite**: chat, files, projects, notes and memory. Open source (MIT) and not affiliated with Anthropic or any model provider.
Backend: any OpenAI-compatible provider you add in Settings → Providers (`/v1/chat/completions`, streaming + tool calling).

## Run
Requires Node.js 20+ and [pnpm](https://pnpm.io).
```
pnpm install
pnpm dev         # development (Vite + Electron, hot reload)
pnpm start       # build and run the production bundle
pnpm dist        # package a macOS arm64 .dmg (unsigned)
pnpm test        # unit tests (plain Node scripts, no Electron needed)
```

## Providers
Settings (Cmd/Ctrl+,) → Providers → Add provider (OpenRouter, Cloudflare, OpenAI, Ollama, any OpenAI-compatible server). Keys are stored encrypted. Image and video models are picked in Settings → General from the same providers.

## Features
- **Chat**: streaming, Markdown, tables, code highlighting, copy, regenerate, search, rename (double-click).
- **Models**: whatever your providers offer; add model IDs in Settings → Providers.
- **Projects**: each has a name, instructions and a folder; chats attach to a project.
- **File tools** (confined to the project folder): list_dir, read_file, search_files, write_file, edit_file, create_folder, move_file, delete_file.
- **Excel / CSV**: reads and writes `.xlsx .xls .ods .csv .tsv` (`write_spreadsheet`, `update_cells`, `=formula` support). Reads Word (`.docx`) and PDF.
- **Attachments**: 📎, drag & drop or paste — Excel, CSV, Word, PDF, text/code, images.
- **Approvals**: writes, edits, moves and deletes show an approval card. Writes can be auto-approved in Settings; deletes always ask.
- **Notes**: a folder of Markdown files shown in the sidebar (folders, search, `[[wiki links]]`). A note opens like a chat: in the current tab, in a new tab (⌘/Ctrl-click) or next to a chat in split view. Artemis can search and read notes when you allow it.
- **Tabs and split view**: chats and notes open in tabs; right-click a tab or a sidebar item and choose "Open in split view".
- **Memory**: the assistant saves durable facts via `memory_save`; edit them in the Memory panel; they are added to every chat's system prompt.

## Layout
```
electron/  main.js (window, wiring) · ipc/ (IPC handlers) · agent.js (tool loop) · tools.js · files.js · preload.js
src/       React UI (App.jsx, components/, lib/)
scripts/   tests
```
Data is stored locally as JSON under `userData`. API keys and tokens are encrypted with the OS keychain (Electron `safeStorage`). If the OS offers no encryption (some Linux setups) they are stored in plain text in that folder.

## Web, terminal and computer control

- **Web**: `web_search` (DuckDuckGo, falls back to a search model on your endpoint) and `web_fetch` (blocks local/private addresses).
- **Terminal**: `run_command` runs in your real shell. A small blocklist stops obvious disasters (sudo, `rm -rf /`, shutdown…) but it is **not a sandbox**.
- **Computer (macOS only)**: screenshots, mouse and keyboard. Grant **Screen Recording** and **Accessibility** to the app that launches Artemis (Terminal/iTerm/Electron) in System Settings → Privacy & Security. Check with `npm run selftest:computer`.
- **Safety**: terminal and computer ask for approval **once per task**. While the computer is controlled the window minimizes; press **Cmd/Ctrl+Shift+Esc** (or Stop) to abort. Web pages, files and screenshots are treated as untrusted. Each can be turned off in Settings.

## Tray, quick chat and shortcuts

- A tray / menu-bar icon opens a small floating **quick chat** (click it, or press the shortcut, default `Cmd/Ctrl+Shift+Space`; change it in Settings → General). Esc hides it; "Open in the main window" moves the conversation into the app.
- Closing the main window keeps Artemis running in the tray (needed for the Telegram bot). Quit from the tray menu. Turn this off or enable "start at login" in Settings → General.
- During computer control the main window minimizes and a small always-on-top panel shows progress; `Cmd/Ctrl+Shift+Esc` stops everything.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Artemis can run commands, edit files and control the computer when you allow it, so read the approval cards before accepting.

## License

[MIT](LICENSE) © 2026 Orbix Labs

## Upgrading from Ares

Earlier builds were called Ares and kept data in `~/.ares`, `Documents/Ares Notes` and `<project>/.ares`. Quit the app, then run:

```bash
pnpm migrate:ares            # dry run, prints what it would do
pnpm migrate:ares -- --apply # moves everything to the Artemis names
```
