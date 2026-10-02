# Product and engineering decisions

## D01 Confirmed user requirements

2 October 2026: both Windows and macOS; English; Markdown/PDF/DOCX; existing company AI policy. Follow-up clarified freelance use with separate logins for different clients. The owner selected a small document collection per login, all belonging to that one client/project.

## D02 Proposed delivery architecture

Desktop app for capture and overlay, website for setup and administration, persistent backend for streaming and enforced budgets. Electron is the proposed cross-platform framework. Validate capture first; do not spend weeks building dashboard features before finding the core desktop behavior impossible on target hardware.

## D03 Proposed context strategy

Full-context, source-labeled pack up to 40,000 document/note tokens, with bounded current meeting history. No embeddings or vector store in MVP. The word RAGless is interpreted this way rather than as a requirement for a new model. A later retrieval feature requires an explicit new decision and evaluation for larger libraries.

## D04 Proposed account strategy

One organization, one admin, one client workspace per member account, one member account per workspace for MVP. A single person can hold multiple distinct accounts; display names may match but authentication identifiers must remain unique. Suggested invitation identifiers are unique email addresses or approved email aliases. Password changes never change the workspace. Multiple members collaborating inside one workspace is deferred.

## D05 Proposed spending strategy

Owner-funded internal non-expiring USD grants, no payment checkout, no markup. Meter all paid operations. Provider funding and infrastructure spending are separate from member allowance assignment. Reserve and reconcile rather than decrementing a client-side counter after work.

## D06 Proposed release defaults

10 named users, 3 concurrent meetings, one meeting per account; 25 MiB/file, 20 active files/workspace and pack, 500 MiB workspace storage including retained versions/artifacts, 200 PDF pages/file, 120-minute session. Proposed Windows 11 x64 and macOS 14.2+ on Intel/Apple Silicon, subject to supported runtime and actual hardware tests. Revise limits with evidence rather than silently changing implementation behavior.

## Future decision template

- ID and date:
- Problem:
- Decision and scope:
- Options considered:
- Supporting evidence:
- Cost/security/compatibility implications:
- Affected tasks and requirements:
- Owner input if required:

## D07 Implementation environment baseline (T01)

- ID and date: D07, 2 October 2026.
- Problem: Record the actual development environment so later tasks do not assume hardware, credentials or cloud resources that do not exist.
- Decision and scope: Develop on the single available Apple Silicon Mac. Use pnpm workspaces with TypeScript. Pin Electron 44.5.1 (npm `latest` on 2 October 2026; requires Node >= 22.12). Build tooling runs on the installed Node 25.9.0, which is past end of life; T06 must pin an LTS Node (24 or 26) and record it. Windows, Intel macOS and receiver-side tests stay blocked until hardware exists. No cloud resources are created before T38.
- Options considered: Wait for all hardware before coding (rejected: blocks independent work); claim support from the development Mac alone (rejected: violates evidence rules).
- Supporting evidence: docs/EVIDENCE.md, T01 entry.
- Cost/security/compatibility implications: No spend incurred. macOS 27.0 is newer than the proposed 14.2 minimum; results on it do not prove 14.2 support.
- Affected tasks and requirements: T03, T04, T19, T38–T41 (R10, R12, R14, R18).
- Owner input if required: See STATUS.md "Missing owner inputs".

## D08 Early skeleton deployment (owner-authorized)

- ID and date: D08, 2 October 2026.
- Problem: The owner asked to push to GitHub and deploy a frontend and a backend now, before T38.
- Decision and scope: Use top-level `frontend/` (Next.js 16.3.8 on Vercel, project `contextharbor`, root directory `frontend`) and `backend/` (Fastify 5.12.5 on Railway, project `contextharbor`, service `backend`, root directory `/backend`). Both are health-check skeletons with no client data, no providers and no secrets. These folders take the place of the proposed `apps/web` and `apps/api`; T06 keeps these names. Both deploy automatically on push to `main`.
- Options considered: Wait for T38 (rejected by the owner's explicit request). Host the backend on Vercel (rejected: the live gateway needs persistent WebSockets, see ARCHITECTURE).
- Supporting evidence: docs/EVIDENCE.md, "Skeleton deployment".
- Cost/security/compatibility implications: Railway bills by usage for one small always-on service. The Vercel hobby project has no expected recurring cost. CORS allows only `https://contextharbor.vercel.app`. This does not complete T38: there is no staging isolation, database, storage, or migrations.
- Affected tasks and requirements: T06, T38.

## D09 Owner's daily-assistant brief (local-first RAG desktop app)

- ID and date: D09, 2 October 2026.
- Problem: Mid-session, the owner supplied a new build brief ("Part 1") and a runtime system prompt ("Part 2"). They asked for a working app. The brief conflicts with parts of the original pack:
  - RAG with a vector index instead of D03 RAGless.
  - Local per-user storage instead of server-side accounts, budgets and admin.
  - Recording of chat and OCR of shared screens.
  - Any LLM, with local models allowed.
- Decision and scope:
  - Build the brief as the desktop product in `apps/desktop`. It is local-first, one knowledge base per local user, with every query filtered by `user_id`.
  - D03 is superseded for the desktop app. The app uses hybrid retrieval: embeddings plus SQLite FTS5, a re-ranker, a threshold, and 3 to 6 passages.
  - The server pieces of the original pack (admin, invitations, wallets, T07–T23) are not built. They remain in TASKS.md for the owner to keep or drop.
  - The Part 2 prompt ships verbatim in `apps/desktop/static/system-prompt.md`.
- Non-negotiables kept from CLAUDE.md:
  - No universal-invisibility claim. Capture exclusion is reported per platform as supported, best-effort or unsupported.
  - On macOS, while the user presents on a single display, the panel is hidden unless the user confirms a receiver-side test.
  - Recording is off until the organization policy and consent are set. If the jurisdiction requires all-party consent, nothing is saved without per-meeting confirmation.
  - Titles that look like exams, interviews or assessments disable the assistant.
  - Raw audio and screen frames are never stored.
- Options considered: Keep the original server architecture and add RAG (rejected: the brief specifies local storage, any LLM and a single user per machine). Pause and ask the owner (rejected: the owner said to build it end to end and is unavailable during the session).
- Cost/security implications: The default models are local (Ollama), so model cost per answer is $0. Hosted adapters exist, but no hosted model was evaluated because no API keys were provided.
- Affected tasks: T03/T04 (audio capture is now implemented, but receiver evidence is still missing), T25–T30 (desktop equivalents implemented locally), T05/T41 (still open).
