## What and why

<!-- What does this change do, and why is it needed? -->

## How I tested it

<!-- `pnpm test` result, plus what you tried by hand (especially UI changes). -->

## Checklist

- [ ] `pnpm test` passes
- [ ] New tests are added to the `test` script in `package.json`
- [ ] File access goes through `resolveSafe`, and risky actions still ask for approval
- [ ] A new IPC channel is in `main.js` or `electron/ipc/`, in `preload.js` and in `src/`
- [ ] README or `agents.md` updated if behavior or architecture changed
- [ ] No secrets, local data or build output committed
