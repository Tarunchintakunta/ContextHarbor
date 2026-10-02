# Implementation evidence

No engineering tasks have been completed yet. The pack itself is a planning deliverable, not evidence that any runtime behavior works.

Append a record for each completed task:

## Task ID and title

- Date and implementation commit, if available:
- Changed files:
- Acceptance criteria checked:
- Commands actually run and results:
- Environment and fixture/live-provider distinction:
- Evidence artifact paths:
- Known limitations and follow-up task IDs:
- Next task:

For manual hardware tests include exact device, OS, app/runtime versions and receiver observation. For API tests include redacted provider request IDs, cost and model/price version. Never store secrets, client documents or live confidential transcripts in this log.

## T01 — Confirm implementation environment and scope

- Date and implementation commit: 2 October 2026; first commit of the local Git repository created in this session.
- Changed files: extracted pack files into repository root (original `ContextHarbor-Claude-Pack.zip` kept unchanged); STATUS.md, TASKS.md, docs/DECISIONS.md (D07), docs/EVIDENCE.md, .gitignore.
- Acceptance criteria checked:
  - STATUS.md identifies exact gaps: yes, see "Missing owner inputs" and "Hardware gaps".
  - Existing user files preserved: the repository held only the zip; extraction used `cp -Rn` (no overwrite) and the zip is untouched.
  - No secrets printed: environment variables were listed with values replaced by `<set, redacted>`.
- Commands actually run and results:
  - `sw_vers; uname -m` -> macOS 27.0 (26A428), arm64, Apple M5 Pro.
  - Tool versions -> node v25.9.0 (Homebrew), npm 11.12.1, pnpm 10.33.0, git 2.53.0, gh 2.92.0, python3 3.13.9, Xcode 27.0 (27A266a), Docker CLI 29.4.1 (daemon not running), psql 18.4 with local server accepting connections on /tmp:5432. yarn and bun absent.
  - `security find-identity -v -p codesigning` -> 0 valid identities.
  - `system_profiler SPAudioDataType` -> MacBook Pro Microphone, MacBook Pro Speakers, iPhone Microphone (Continuity), HDMI Audio output.
  - `system_profiler SPBluetoothDataType` -> three paired Bluetooth headphones (AirPods models).
  - `system_profiler SPDisplaysDataType` -> built-in 3024x1964 display plus one external 1920x1080 display (useful for the unshared-display fallback).
  - `env | grep` for ANTHROPIC/DEEPGRAM/NEON/VERCEL/RAILWAY/DATABASE_URL -> no project provider keys; only Claude Code's own `ANTHROPIC_BASE_URL` (not a project credential).
  - `npm view electron dist-tags` -> latest 44.5.1, engines node >= 22.12.0.
  - Connectors (read-only): Neon `list_projects search=contextharbor` -> none; Railway `list-projects` -> 3 unrelated projects, none for ContextHarbor (not touched); Vercel `list_teams` -> no teams. No external resource was created or modified.
- Environment and fixture/live-provider distinction: inventory only; no providers called.
- Evidence artifact paths: this entry.
- Known limitations and follow-up task IDs: no Windows device (T03), no Intel Mac (T04), no second receiver device (T03/T04/T41), no signing identities (T39/T40), no provider keys (T19, T25, T27, T36), no hosting decision (T38), Node 25 is EOL (T06).
- Next task: T02.

## T02 — Bootstrap the smallest desktop feasibility harness

- Date and implementation commit: 2 October 2026; see `git log` for the T02 commit.
- Changed files: apps/desktop/{package.json,tsconfig.json,pnpm-lock.yaml,README.md,src/main.ts,src/preload.ts,static/overlay.html,static/overlay.js,scripts/click.swift}; evidence/t02/*.
- Acceptance criteria checked:
  - Window works without taking presentation focus: PASS (programmatic plus frontmost-app check). The overlay is a macOS non-activating panel (`type: "panel"`, `focusable: false`), shown with `showInactive()`. Self-test reports `overlayNotFocused`, `noFocusedAppWindow` and `overlayNotFocusable` all true. `lsappinfo front` reported Google Chrome as the frontmost app both before launch and after the overlay was shown.
  - Quit releases all acquired resources: PASS. Released list `shortcuts:3,tray,overlay,capture:none-acquired`. `globalShortcut.isRegistered` is false for all three shortcuts after quit. `pgrep` found 0 leftover Electron processes. The process exited with code 0.
  - Show/hide and pause are independent: PASS (`pausedIndependentOfVisibility`, `hideDidNotChangePause`).
- Commands actually run and results:
  - `pnpm install` then `node node_modules/electron/install.js` -> Electron v44.5.1. pnpm 10 skipped Electron's postinstall by default.
  - `pnpm build` (tsc 7.0.2) -> no errors.
  - `CH_SELFTEST=1 CH_EVIDENCE_DIR=<repo>/evidence/t02 electron .` -> evidence/t02/t02-selftest.json (all checks true) and evidence/t02/t02-overlay.png (marker CH-MARKER-7DA9E3, status text, Pause/Hide/Quit controls).
  - A real-mouse click test (`CH_CLICKTEST=1` plus `swift scripts/click.swift 142 371`) gave `osClickToggledPause: false`. macOS dropped the synthetic click because the terminal has no Accessibility permission, and System Settings opened a permission prompt. Claude did not grant it. The overlay stayed unfocused (`overlayNotFocusedAfterClick: true`).
- Environment and fixture/live-provider distinction: Apple M5 Pro, macOS 27.0 (26A428), Electron 44.5.1 development build launched from a terminal. No providers. Fixture marker content only.
- Evidence artifact paths: evidence/t02/t02-selftest.json, evidence/t02/t02-overlay.png.
- Known limitations and follow-up task IDs:
  - Not yet tested: a physical mouse click on overlay buttons while a presentation app is frontmost. This needs a manual click or an Accessibility grant from the owner. It moves to T30 (no-focus-theft acceptance) and the T03/T04 receiver sessions.
  - Content protection is only requested, not verified on a receiver (T03/T04/T41).
  - Not tested on Windows.
  - Not tested as a packaged app (T04).
- Next task: T06. T03 and T04 need hardware or receiver access; see STATUS.md. The macOS Apple Silicon audio spike for T04 can start locally.
