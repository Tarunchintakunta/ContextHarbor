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

## Skeleton deployment (owner request, not a TASKS.md item; see D08)

- Date: 2 October 2026. Commits e7a0950 (backend) and d20cf95 (frontend). Repository: https://github.com/Tarunchintakunta/ContextHarbor (branch `main`).
- Backend: `pnpm test` -> 1 pass, 0 fail (health response and exact-origin CORS). Railway project `c80bacad-b747-4618-b637-56d65edb75d4`, service `d5f12489-e016-4823-9065-4525c01aa3b1`, region us-west2. First deployment FAILED because it ran before the root directory was set. Deployment `14c0f791-2223-4fbe-84bc-a16e5fb4ae70` reached SUCCESS. `curl https://backend-production-8f32.up.railway.app/health` with Origin `https://contextharbor.vercel.app` -> HTTP 200, `{"status":"ok","service":"contextharbor-api","stage":"skeleton","commit":"d20cf95"}`, and `access-control-allow-origin` echoed only for that origin.
- Frontend: `pnpm build` (Next.js 16.3.8) passes locally. Vercel project `prj_864ybi1SDbXRshJAWX880ejvcK1t` is linked to the GitHub repo with root directory `frontend` and Node 24.x. Deployment `contextharbor-5nhccrvpu` is Ready and aliased to https://contextharbor.vercel.app (HTTP 200). In a real browser, the status line read "API: reachable (build d20cf95)" after the client-side fetch.
- Housekeeping: `.omc/` (a local plugin state file that holds no secrets) was committed in T01/T02 by mistake. It is now untracked and ignored.

## Owner brief: desktop assistant (D09; not a TASKS.md item)

- Date: 2–3 October 2026. Commits from 7763445 onward on `main`.
- Changed files: apps/desktop/{src/core,src/app,src/eval,static,config,scripts,demo,README.md}, frontend/, docs/DECISIONS.md (D09), STATUS.md.
- Commands run and results:
  - `cd apps/desktop && pnpm test` -> 24 pass, 0 fail. Covers:
    - Week folders and time hints.
    - Retrieval with per-user isolation, using two users with the same file names and contradictory facts.
    - Integration: another user's canary never reaches a prompt.
    - Question detection, the format validator (including secret redaction and fake-source rejection), and the fallback chain.
    - Budget assembly.
    - 52 weekly meetings plus a 3-hour meeting: all requests under budget, early-week facts retrieved, retrieval 7–9 ms.
    - Encryption, retention, the recording policy, meeting detection, display placement, VAD and settings validation.
  - `cd backend && pnpm test` -> 1 pass.
  - `node dist/eval/run.js --rounds 3 ...`: per-model results are in apps/desktop/README.md. Reports in evidence/eval/.
  - `node dist/eval/run.js --chain --rounds 3 --models qwen2.5:7b,gemma3:12b` -> 114/114 pass, fallback used 3 times. Report: evidence/eval/chain-*.json.
  - `./scripts/demo.sh` -> the pipeline ran end to end with **simulated** audio (a WAV generated by macOS `say`):
    - whisper base.en produced "varish. When does the payments migration launch?"
    - The question was detected as directed at the user.
    - Retrieval took 27 ms; qwen2.5:7b produced the first token in 683 ms; the full answer took 1,622 ms.
    - The overlay was shown and not focused.
    - The app exited cleanly in about 12 s.
    - Evidence: evidence/demo/demo-run.json and .png.
  - The settings screen was rendered: evidence/demo/settings.png.
  - `pnpm package` -> out/ContextHarbor-darwin-arm64/ContextHarbor.app, ad-hoc signed, with `NSAudioCaptureUsageDescription` present in Info.plist.
  - `electron dist/app/exclusion-test.js` -> BLOCKED. The error was `screencapture ... could not create image from rect` because this environment has no Screen Recording permission. Evidence: evidence/exclusion/macos-screencapture.json.
- Bug found and fixed: quitting during a meeting hung the app. A late IPC message from the capture window called `refresh()` on a tray that had already been destroyed, and the native call deadlocked. Fixed by nulling and guarding the tray, plus a `quitting` flag. A quit during a meeting now saves the meeting as pending, and it is summarized on the next launch.
- Not yet proven (real-device evidence still required):
  - Live system-audio loopback with a real call.
  - Receiver-side screen-share invisibility.
  - Anything on Windows or an Intel Mac.
  - Hosted LLM providers.
  - Notarized and signed installers.

## Capture-exclusion test (owner granted Screen Recording, 3 October 2026)

- Environment: Apple M5 Pro, macOS 27.0 (26A428), Electron 44.5.1. The protected window uses `setContentProtection(true)` and has a magenta background. The control window is unprotected and green. Both are always-on-top, side by side at (80,153) and (380,153).
- First rerun: INCONCLUSIVE. The test windows were shown before they had rendered, so neither was in the capture. Fixed by waiting for `ready-to-show` and showing the windows at screen-saver level.
- A pixel-matching bug was also fixed. ScreenCaptureKit returns colour-managed pixels (pure green comes back near #77FF4F), so the check now matches by hue instead of exact RGB.
- Results:
  - `electron dist/app/exclusion-test.js .../macos-screencapture` -> `controlVisible: 1, protectedVisible: 0, PASS (excluded)`.
  - `CH_CAPTURE_METHOD=sck electron dist/app/exclusion-test.js .../macos-chromium-sck` (separate process, Chromium desktopCapturer / ScreenCaptureKit) -> `controlVisible: 1, protectedVisible: 0, PASS (excluded)`.
- Evidence: evidence/exclusion/macos-screencapture.{json,png} and evidence/exclusion/macos-chromium-sck.{json,png}.
- Limits: this is local capture only, not a meeting receiver's view. Native Teams, Zoom and Slack may use other capture paths. COMPATIBILITY rows stay NOT TESTED until a second device confirms them. T04 and T05 remain open.

## Web login/logout (owner request, 3 October 2026; partially covers T07–T10, T13)

- Backend (`backend/`): Postgres schema created at boot (`users`, `workspaces`, `sessions`, `invitations`, `audit_events`).
  - The database rejects a second admin (`users_single_admin` index), and each member has exactly one workspace (`unique workspace_id` plus a role check).
  - Passwords are hashed with Node scrypt. Session tokens are stored only as SHA-256 hashes and sent in an HttpOnly, SameSite=Lax cookie (Secure in production).
  - Mutating requests must carry the `x-ch-csrf` header. Login is rate-limited (5 attempts per 15 minutes).
  - Disabling or resetting a member bumps `session_version`, which revokes their live sessions immediately.
- Frontend (`frontend/`): `/login`, `/setup` (one-time first admin), `/invite` (set password), `/dashboard` (member), `/admin` (members). The header on every page shows "Log in", or the account plus "Log out". `/api/*` is proxied to the backend so the session cookie is first-party.
- `cd backend && NODE_ENV=test pnpm test` (local PostgreSQL 18.4) -> 3 pass, 0 fail. The tests check:
  - CSRF rejection; the one-time setup link; login and logout (session dead after logout).
  - Single-use invitations; two members whose workspaces are kept separate.
  - Members get 403 on admin routes; disabling a member revokes their session at once; reset invalidates sessions.
  - The sole admin cannot be disabled; a second admin is rejected by the database; the rate limit triggers.
- Local browser end-to-end (API on :4000, Next on :3123, throwaway database `ch_e2e`): setup -> /admin -> add member "Outstar" -> invite link shown -> log out (`/v1/me` 401, `/admin` redirects) -> accept invite -> /dashboard "Outstar" (admin API 403) -> log out -> wrong password shows "Email or password is incorrect." -> correct login reaches /dashboard.
- Production:
  - Neon project `lingering-tree-35221842` (aws-us-west-2, Postgres 17).
  - Railway variables `DATABASE_URL`, `APP_ORIGIN` and `NODE_ENV` set; values not logged.
  - Backend `/health` -> `"stage":"auth","commit":"ec2c7b4"`.
  - On Vercel: `/api/health` proxied OK; `/dashboard` and `/admin` -> 307 to `/login`; a bad login -> `{"error":"invalid_credentials"}`.
  - A one-time admin setup invitation was inserted (only its hash), expiring 2026-10-04 06:32 UTC.
- Not done:
  - MFA for the admin (T08).
  - Password reset by email: no email provider, so admins issue a new login link instead.
  - A production browser login has not been run yet; it needs the owner to use the setup link.

## Document upload on the member dashboard (3 October 2026; partially covers T14–T17)

- Commit 03f6099.
- Flow: the dashboard asks for a single-use, 5-minute upload ticket through the cookie-authenticated proxy. It then sends the file with `PUT /v1/uploads` directly to the API (CORS allows only `APP_ORIGIN`).
- Checks before anything is stored:
  - File signature: `%PDF-`; a ZIP containing `word/document.xml` for .docx; UTF-8 with no NUL bytes for .md. The extension must match the content.
  - .docx files containing `vbaProject.bin` (macros) are rejected.
  - Limits: 25 MiB per file, 20 files and 500 MiB per workspace.
  - A file with the same SHA-256 as an existing one returns that document instead of a new copy.
- Extraction runs in a `worker_threads` worker with a 384 MB memory cap and a 30 s timeout:
  - PDF: text keeps `[page N]` markers. Pages with no text are listed; the document is marked "needs review" until the member accepts the limitation. A PDF with no text at all fails. More than 200 pages fails.
  - DOCX: headings become Markdown headings; tables become `cell | cell` rows; images are reported as unread.
- Storage: originals go to the private Railway bucket `documents` (credentials passed as `${{documents.*}}` variable references); extracted text goes to Postgres.
- Delete: tombstones the row, clears its text, then removes the stored original. Every query is scoped to the member's own workspace; the admin has no route to document content.
- `cd backend && NODE_ENV=test pnpm test` -> 4 pass, 0 fail. The new test covers:
  - md ready; pdf needs_review with page-2 warning and page-1 preview; docx heading and table preview.
  - scanned PDF fails; fake PDF -> 415; .exe -> 415; macro docx -> 415; 25 MiB + 1 byte -> 413.
  - Duplicate re-upload; ticket single use (second PUT 401); foreign Origin 403.
  - Another member and the admin can't list, read or delete the documents.
  - Delete removes the stored original and clears the text.
- Local browser end-to-end (UI file input): .md -> Ready; .pdf -> "Needs your review", with preview `[page 1] Checkout p95 latency 182 ms…`, then Accept -> Ready; .exe -> "Only .md, .pdf and .docx files are supported."; Delete -> removed, usage 1 of 20.
- Production:
  - Backend `/health` shows commit 03f6099.
  - OPTIONS preflight returns 204 with allow-origin `https://contextharbor.vercel.app`; a bogus ticket returns `upload_expired`; unauthenticated `/api/v1/documents` returns 401.
  - Vercel production serves deployment `kz06n0d44` (commit 03f6099).
- Not yet verified: a real upload into the production bucket. No production accounts exist yet; it needs the owner's admin setup and a member.
