# ContextHarbor desktop: private meeting assistant

The app runs in the background. When it detects a meeting it transcribes the call on your machine. When someone asks you a question, it searches **your own** notes and shows a short cited answer in a small panel that only you see. It is built from the owner brief (Part 1); the runtime system prompt (Part 2) ships verbatim in [`static/system-prompt.md`](static/system-prompt.md).

## Setup

Requirements: Node ≥ 22.12, pnpm 10, plus a local model runtime and speech-to-text.

```bash
cd apps/desktop
pnpm install
node node_modules/electron/install.js        # pnpm 10 skips Electron's postinstall
brew install ollama whisper-cpp               # Windows: winget install Ollama.Ollama; whisper.cpp release binary on PATH
ollama pull qwen2.5:7b && ollama pull gemma3:12b && ollama pull nomic-embed-text
mkdir -p models && curl -L -o models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

The pinned model files and checksums are listed in [`config/models.json`](config/models.json). The app verifies the speech model's SHA-256 at startup, and the embedding model must match its pinned Ollama digest.

## Run

```bash
pnpm start            # tray icon appears; Settings is in the tray menu
./scripts/demo.sh     # scripted end-to-end run with simulated meeting audio (isolated profile, synthetic notes)
pnpm harness          # T02 feasibility harness (overlay marker only)
```

Put your notes in the knowledge-base folder shown in Settings. The default is `~/Documents/ContextHarbor/<user>/knowledge-base`.

```
knowledge-base/
  2026/W40_2026-09-28_to_2026-10-04/sprint-planning-2026-09-29.md
  _reference/project-overview.md
```

Markdown and text files are indexed incrementally as you add, edit or delete them.

Default hotkeys (all rebindable in Settings):

| Hotkey | Action |
|---|---|
| ⌘/Ctrl+Alt+P | Pause or resume |
| ⌘/Ctrl+Alt+A | Answer now |
| ⌘/Ctrl+Alt+H | Show or hide the panel |
| ⌘/Ctrl+Alt+K | Pin the panel |
| ⌘/Ctrl+Alt+D | Dismiss the panel |

## Tests

```bash
pnpm test     # unit + integration (node:test): 24 tests
pnpm eval     # model evaluation: 38 cases × 3 rounds against local models (needs Ollama)
pnpm build && electron dist/app/exclusion-test.js ../../evidence/exclusion/<name>   # capture-exclusion check
```

What the tests cover:

- Week-folder parsing and time hints.
- Hybrid retrieval with time boosts and the relevance threshold.
- Isolation filters, including a test with two users who have similar files and contradictory facts.
- Question detection, the output-format validator and the fallback chain.
- Budget assembly.
- Encryption, retention, the recording policy and wipe.
- Meeting detection, display placement, VAD and settings-input validation.

Two tests are integration tests:

- `pipeline.test.ts`: proves another user's data never reaches a prompt.
- `longhistory.test.ts`: 52 weekly occurrences of a recurring meeting plus one 3-hour meeting. Every request stays under budget, and facts from week 0 are still retrieved.

## Permissions each OS needs

| OS | Needed for | Permission |
|---|---|---|
| macOS 14.2+ | Meeting (system) audio | "System Audio Recording". A packaged app needs `NSAudioCaptureUsageDescription`. A dev build inherits the permission of the terminal that launched it. |
| macOS | Microphone ("me" channel) | Microphone |
| macOS | Window titles for detection, and OCR of the meeting window | Screen Recording |
| Windows 10/11 | Microphone | Settings → Privacy → Microphone. System audio loopback needs no prompt. |
| Linux | Audio | PipeWire/PulseAudio access; OCR needs `tesseract` and screenshots need ImageMagick `import` |

## Design decisions

- **Electron**, not Tauri. Electron is already pinned and proven in the T02 harness. `setContentProtection` maps to `NSWindow.sharingType = .none` on macOS and `WDA_EXCLUDEFROMCAPTURE` on Windows. `desktopCapturer` provides system-audio loopback and window thumbnails for OCR.
- **Local first.** One SQLite file (`node:sqlite`, built into Electron 44) per user and per embedding model. It holds the FTS5 keyword index and stored vectors. Retrieval is brute-force cosine plus BM25, fused with reciprocal-rank fusion, then re-ranked by query coverage, time hint and recency, and cut at a relevance threshold (3–6 passages).
- **Isolation.** Every SQL statement filters on `user_id` (`CHECK user_id <> ''`), and rows are re-checked before they leave the knowledge-base module. `assertOwned` runs again in the pipeline. Switching users disposes the whole user context (index handle, memory, buffers, overlay contents), and a generation counter drops late answers.
- **Any LLM.** One interface: `generate(system, messages, stream, maxTokens, timeoutMs)`. Adapters:
  - `OpenAICompatible`: OpenAI, Ollama, llama.cpp server, vLLM, LM Studio, OpenRouter.
  - `AnthropicMessages`.

  Floating aliases (`latest`) are rejected.

  The fallback chain is: the pinned cheap model, then a pinned larger model, then a private "Answer unavailable". It moves on after a timeout, rate limit, provider error, or output that fails the format check. Each model gets one retry with backoff, and a context-length error retries once with a smaller budget.
- **Answer validation.** Answers follow Section 10 (1–3 bullets or 1–2 sentences, plus a sources line). Every cited source must be a passage that was actually provided, or the live meeting. Secrets are redacted.
- **Context budget.** The input budget is the lower of 12k tokens and 50% of the model's window, minus the output reserve. Priority order:
  1. Question.
  2. Newest live lines.
  3. Running summary.
  4. Retrieved passages and past segments, ranked together.
  5. Series summary.
  6. Monthly or quarterly rollup, included only when the question reaches far back.

  Lowest-ranked items are dropped first. The question and the newest live line are never dropped.
- **Speech to text.** whisper.cpp (`ggml-base.en`, pinned by checksum) transcribes energy-VAD segments. Your names, roles and topics are passed as the vocabulary prompt; without it, names get lost ("Varish" was dropped). Speakers are labelled by channel only: `remote` (system audio) and `me` (microphone). The app does not diarize individual remote speakers.
- **Recording policy.** Off until Settings records that the organization allows recording and you confirm consent. If all-party consent is required, nothing is saved unless you tick "All participants consented" for that meeting in the tray menu. Meetings whose titles look like exams, interviews or assessments switch the assistant off. Raw audio and frames are never written to disk, apart from a temp WAV per utterance that is deleted right after transcription.
- **Storage.** Transcripts, summaries, history and logs are AES-256-GCM encrypted. The key is wrapped by the OS keychain through Electron `safeStorage`. API keys are kept the same way, never in settings.

## Known limitations (honest status)

- **Capture exclusion is not universal.**
  - Windows 10 2004+: supported by the OS API, but not yet verified with a second device.
  - macOS: best effort. While you present on your only display, the panel is hidden unless you tick the receiver-tested option. With a second display, the panel moves there.
  - Linux: unsupported. The panel is hidden while you present on a single display.
  - The automated exclusion test could not run on the development Mac: this environment lacks Screen Recording permission (`could not create image from rect`).
- **Sharing detection reads window titles** ("is presenting", "Sharing control bar", …). The app cannot always know which screen is being shared, so it assumes the primary display.
- **Meeting chat is captured through OCR of the meeting window**, not through the meeting app's API. Hidden chat panels are not read.
- **Live loopback audio still needs real-device evidence:**
  - macOS: a packaged build and the user's permission click.
  - Windows: a Windows device, which was not available.
  - The scripted demo uses simulated audio from a WAV file and is labelled as such.
- **The search index is not encrypted:** `node:sqlite` has no SQLCipher. The index is kept in a user-only (0700) directory; use FileVault or BitLocker. Everything else is encrypted.
- **Start at login** is applied only in packaged builds.
- **Only Markdown and text files are indexed.** PDF and DOCX extraction from the original pack (T15/T16) is not yet wired in.
