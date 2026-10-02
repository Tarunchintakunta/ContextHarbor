# Desktop feasibility harness (T02)

Pinned: Electron 44.5.1, TypeScript 7.0.2. Generated marker content only, no client data.

```bash
pnpm install && node node_modules/electron/install.js   # pnpm 10 skips Electron's postinstall; T06 fixes this at workspace level
pnpm start          # overlay + tray (macOS menu bar shows "CH ●")
pnpm selftest       # writes evidence/t02-selftest.json and t02-overlay.png, then quits
```

Shortcuts: Cmd/Ctrl+Alt+H show/hide, Cmd/Ctrl+Alt+P pause/resume, Cmd/Ctrl+Alt+Q quit.

`CH_CLICKTEST=1` with `swift scripts/click.swift 142 371` sends a real OS mouse click to the Pause button.
Posting the click needs macOS Accessibility permission for the calling terminal. The owner grants this; Claude does not.
