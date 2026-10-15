# Security

## Reporting a vulnerability
Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting (the repository's Security tab, "Report a vulnerability") with a description and steps to reproduce.

## What to know
- Artemis can read and write files, run terminal commands and control the screen (macOS) when you allow it. Writes, deletes, the terminal and computer control ask for approval. The terminal blocklist is **not** a sandbox.
- Web pages, files and screenshots are treated as untrusted input, but prompt injection is an open problem: review approval cards before accepting.
- API keys and tokens are encrypted with the OS keychain (Electron `safeStorage`). Where the OS has no encryption they are stored in plain text in the app data folder.
- The optional MCP server listens on 127.0.0.1 only and requires a bearer token.
- Releases are unsigned.
