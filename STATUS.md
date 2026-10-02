# Current implementation status

Updated: 2 October 2026.

State: the desktop assistant app from the owner's brief is built and runs locally (D09). The skeleton website and API are deployed (D08). The product is **not** release-complete: the release gates in TASKS.md (T05, T39–T44) are open.

Active task: model evaluation (owner brief, `<model_selection>`). Then T04: live macOS loopback test on the packaged build, which needs the owner to click the OS permission prompts.

Completed TASKS.md items: T01, T02. TASKS.md is authoritative.

## What exists now

- `apps/desktop`: the private meeting assistant.
  - Tray, hotkeys, meeting detection.
  - whisper.cpp speech-to-text, OCR, live context buffer.
  - Per-user hybrid RAG with week folders.
  - Pluggable LLM with a pinned fallback chain.
  - Capture-protected overlay, settings, encrypted vault, retention and wipe.
  - 24 passing tests. See apps/desktop/README.md.
- `frontend/`: product page at https://contextharbor.vercel.app (Vercel, deploys on push to `main`).
- `backend/`: health-check API at https://backend-production-8f32.up.railway.app/health (Railway, deploys on `backend/**` changes).
- Repository: https://github.com/Tarunchintakunta/ContextHarbor (`main`).

## Environment (T01, D07)

- One MacBook Pro: Apple M5 Pro, macOS 27.0, built-in display plus an external display, Bluetooth headphones.
- Ollama with local models; whisper-cpp 1.9.4; Node 25.9.0 (end of life; pin an LTS in T06); pnpm 10.33.0.

## Blockers (owner action needed)

- Screen Recording permission (System Settings → Privacy & Security → Screen & System Audio Recording) for the terminal and for the ContextHarbor app. Without it:
  - The capture-exclusion test cannot run (`could not create image from rect`).
  - Meeting window titles and OCR are unavailable.
  - Claude does not change security settings.
- Live system-audio test: open `apps/desktop/out/ContextHarbor-darwin-arm64/ContextHarbor.app` (ad-hoc signed), allow the audio and microphone prompts, and join a test call with headphones.
- No Windows device and no Intel Mac. Untested: Windows loopback, WDA capture exclusion, Intel build (T03, T04 Intel rows).
- No second device acting as receiver, so there is no receiver-side screen-share evidence yet.
- No hosted LLM API keys, so only local Ollama models were evaluated.
- No signing identities: builds are ad-hoc signed, not notarized (T39/T40).
- Original-pack inputs still open if the server product continues: admin email, policy reference, provider terms, storage and email providers.

## Known limitations

- Full-display sharing exclusion is not guaranteed, particularly on modern macOS. The app moves the panel to a secondary display or hides it while the user presents.
- Speakers are labelled by channel only (`remote` / `me`).
- Meeting chat is read through OCR of the meeting window.
- Only Markdown and text files are indexed.
- The SQLite search index is not encrypted (user-only directory); everything else in the vault is AES-256-GCM.

## Next steps

1. Pin the evaluated model chain in `apps/desktop/config/models.json`, rerun `scripts/demo.sh`, and record the evidence.
2. Owner grants permissions, then: live loopback test with the packaged app, and the exclusion test (`electron dist/app/exclusion-test.js`).
3. On a Windows device, repeat the same tests (T03).
