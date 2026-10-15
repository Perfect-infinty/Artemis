# Contributing to Artemis

Thanks for helping. Artemis is a plain-JavaScript Electron + React app; there is no TypeScript and no linter.

## Setup
```
pnpm install
pnpm dev
pnpm test
```

## Guidelines
- Everything in the repo is English: code, comments, UI text, tests and docs.
- Tests are plain Node scripts in `scripts/` (`assert`, no framework). A new `scripts/test-*.js` file must also be added to the `test` script in `package.json`.
- Modules in `electron/` take Electron objects by injection instead of requiring `electron` at the top level, so they can be tested without Electron.
- File tools must go through `resolveSafe` (see `electron/tools.js`). Never bypass it.
- A new IPC channel needs three edits: `ipcMain.handle` in `electron/main.js`, a method in `electron/preload.js`, and the caller in `src/`.
- Keep pull requests small and describe what you tested.

See `agents.md` for an architecture overview.

By contributing you agree that your work is released under the MIT license.
