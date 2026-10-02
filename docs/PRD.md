# ContextHarbor product requirements

## Problem and outcome

A presenter loses project context between meetings and cannot conveniently search project documents while sharing their screen. ContextHarbor should listen to an authorized meeting and present concise, source-backed speaking notes without requiring the presenter to leave the shared application.

The assistant supports the presenter's memory. It must not invent commitments, owners, deadlines, implementation status, or answers absent from the selected evidence. Source documents can be stale; the UI must show their version and date where known.

## Product shape and boundaries

A desktop application owns local audio capture, overlay controls, and shortcuts. A web dashboard owns project setup, document management, account administration, and usage. A browser extension alone does not satisfy cross-application overlay and system audio needs; a website alone cannot guarantee exclusion during full-display capture. This architecture is a product recommendation based on those constraints.

MVP is one organization, one super admin, and multiple members with separate credentials. No public sign-up. No shared admin password. Each member login is bound to exactly one client/project workspace. There is no member project picker or cross-workspace search. Outstar and Chintakunta are example workspace labels, not proposed credentials. Passwords are never used as database partition keys; isolation uses immutable account and workspace IDs. Changing a password does not move or merge data. The super admin manages all client workspaces and access; the UI must disclose this administrative access. A workspace represents one freelance engagement or company project, never an implicit shared knowledge pool. A person may own multiple separate logins, but sharing one login among several employees is out of scope because it loses individual accountability. Meeting transcript history belongs to the meeting owner; admin content inspection requires an explicit, audited action, rather than opening all transcripts on the dashboard by default.

RAGless means every selected document's extracted text fits in a bounded context pack sent to the answer model. It does not mean training a new model or remembering an unlimited corpus. Project notes, an approved project brief, and current meeting context are included. Arbitrary Slack/chat history is not automatically ingested; users can upload an export in a supported format or paste project notes.

## User journey

1. Super admin logs in with MFA, configures approved providers, runs a bounded connection test, and creates member invitations.
2. Admin allocates $5, $10, $20, or a custom USD usage allowance. Members never need the organization's API key.
3. Member logs into their single assigned client workspace, uploads permitted files, and reviews extraction status and previews. Only the admin creates and binds workspaces. Multiple employee accounts for one shared workspace are deferred.
4. Member prepares the ready source version(s) and approved notes for that workspace for a meeting. The app displays context size, source dates, and estimated cost range.
5. In the desktop app, member selects audio devices, checks that remote speech is audible to the app, and completes a sharing preflight. The company policy reference is visible in settings and preflight.
6. Member starts listening explicitly. The app captures remote audio plus optional local microphone audio, transcribes English, detects questions, and produces a short cited answer.
7. The movable overlay shows the detected question, one to three talking points, evidence links, and status. A shortcut can request an answer immediately if question detection misses a turn.
8. Member can pin an answer, hide/show the overlay, pause listening, or stop the meeting. Hiding the overlay does not pause capture; the tray/menu-bar status continues to show listening. These controls must be distinct.
9. At meeting end, the member sees usage and may review a proposed project brief update. Saving approved facts to the project preserves context for the next meeting; unreviewed model output is never promoted automatically to authoritative project knowledge.

## Required capabilities and acceptance

| ID | Requirement | Observable acceptance |
|---|---|---|
| R01 | Accounts | One protected super admin; invite-only members; no privilege selection in client signup |
| R02 | Administration | Invite, resend invitation, initiate password reset, deactivate/reactivate; never reveal passwords |
| R03 | Revocation | Deactivation blocks new requests immediately and closes active provider streams within 5 seconds; reset revokes sessions |
| R04 | Workspace isolation | Every member login has exactly one workspace; cross-account documents, caches, briefs, transcripts, answers, signed URLs, and budget requests are denied server-side |
| R05 | Document intake | `.md`, `.pdf`, `.docx` only; validate content as well as extension; show uploaded/processing/ready/failed/deleted |
| R06 | Extraction | Preserve PDF page markers, Markdown headings/line spans, DOCX headings/paragraphs; preview extracted content before use |
| R07 | Unsupported content | Explain encrypted files, scanned/image-only pages, incomplete extraction, and oversized packs; never silently omit pages |
| R08 | Grounded answers | Every factual project answer links to valid evidence; insufficient information returns an abstention; conflicting sources are identified |
| R09 | Meeting context | Track recent finalized turns and a bounded rolling summary; follow-up pronouns resolve from meeting context |
| R10 | Live audio | Remote voices work with headphones on both target platforms; microphone-only demo is insufficient |
| R11 | Answer display | Stream into a readable movable overlay without taking keyboard focus; pin prevents automatic replacement |
| R12 | Capture behavior | Publish only tested sharing modes; unsupported full-display protection cannot show a green privacy indicator |
| R13 | Spending | Server enforces individual and organization allowances with reservations before paid work, including retries and speech streams |
| R14 | Provider health | Bounded admin tests show success/failure, billed cost, and masked key status; invalid keys cannot be enabled |
| R15 | Failure handling | Clear no-audio, provider-error, reconnecting, insufficient-credit, and stale-context states; no fake live answers |
| R16 | Project memory | User reviews proposed meeting decisions before saving a versioned project brief for future sessions |
| R17 | Data lifecycle | Stop closes capture; delete revokes access immediately and purges active derived data within the configured deadline |
| R18 | Delivery | Signed Windows installer and signed/notarized macOS builds; tested clean installation and permissions |

## Freelance workspace behavior

Display the client/workspace name persistently in the desktop title, overlay, and preflight. Logging out or signing into another client must stop capture and provider requests, invalidate socket tickets, clear renderer and main-process context, remove in-memory source caches, and require a fresh meeting. Late network events from the former login are discarded by account/session generation. No simultaneous meetings on one account in MVP. Different accounts can meet concurrently subject to the organization cap.

Admin may edit a workspace display name, but cannot silently reassign an account with existing data to another client. Create a new workspace/account for a new client, or run a separately approved migration later. A wrong upload can be deleted immediately; it must disappear from subsequent answers and active context packs. Removing or replacing a document is not evidence that a previously spoken answer is correct.

## Document and meeting limits

Proposed initial limits: 25 MiB/file (26,214,400 bytes), 20 active files per workspace and per selected meeting pack, 500 MiB total stored data per workspace including retained versions and extraction artifacts, 200 PDF pages/file, 40,000 document-and-note tokens per pack, 8,000 tokens for meeting history/summary, and 120 minutes per session. The model's full context budget must also accommodate instructions and reserved output. Use the chosen model's tokenizer/counting API; a file count or character estimate is not a token guarantee.

Text PDFs are supported in MVP. Scanned pages, embedded screenshots, diagrams, and complex visual tables are detected/flagged for review; OCR and visual understanding are deferred. DOCX is text and basic table extraction, not layout fidelity or Word automation. `.doc`, `.docm`, arbitrary ZIP, HTML, and URL crawling are out of scope. A partially extracted document stays non-ready until the user explicitly accepts its limitations; accepted omissions remain visible in its metadata and answer sources.

If the pack is too large, ask the member to select fewer documents or narrower project notes. Do not silently truncate it. A later hybrid retrieval mode may support larger libraries without changing this contract invisibly.

## Overlay experience

Suggested starting size is 420 by 300 logical pixels, resizable with readable 16–18 px text. Show the question, a direct answer of at most three short bullets, expandable evidence, a timestamp, and listening status. Avoid fabricated confidence percentages; use `Supported`, `Conflicting evidence`, and `Not found` labels.

Provide keyboard-accessible show/hide, pause/resume, manual answer, and pin/unpin. Let users rebind conflicting shortcuts. Hide/show must not switch away from the presentation. Closing the overlay hides it; quitting the app stops capture. Resume after lock/sleep requires an explicit action. No answer text in operating-system notifications.

## Screen sharing contract

The requirement is an assistant outside the shared presentation. Do not market it as universally invisible or undetectable. Windows capture exclusion is best effort. Modern macOS ScreenCaptureKit callers may include protected windows. See [Electron content protection](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable) and [Microsoft display affinity](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity).

Share a specific application window or tab, or keep the overlay on an unshared display. Test the actual receiving participant's view, not just the local preview. Software cannot reliably infer every third-party app's chosen share mode, so the preflight records the user's selected mode and test result without claiming automatic protection verification. When full-display sharing is selected on an unsupported combination, hide the overlay and offer an unshared display or a supported window-sharing workflow.

## Quality targets

These are proposed release gates, measured on the pilot devices and documented network conditions:

- Final question audio to first useful answer: p50 at most 3 seconds, p95 at most 6 seconds over at least 100 representative questions; measure cold-cache cases separately.
- At least 90% factual correctness on a 100-question company-approved evaluation set; at least 95% citation support on answerable cases; no invented critical dates or owners.
- At least 95% abstention on deliberately unanswerable cases; at least 90% question recall and no more than one false automatic answer per 10 minutes on labeled meeting fixtures.
- Three simultaneous 60-minute sessions without duplicated charges or cross-project content; correct settlement after disconnects and service restarts.
- Zero unauthorized data exposures in access-control tests. All selected public-beta sharing combinations pass receiver-side inspection.
- After a 5-meeting pilot, collect an owner rating of answer usefulness and manual corrections. No product-market-fit claims from a small pilot.

## Explicitly deferred

Meeting bots, calendar connectors, Slack history sync, non-English support, Linux/mobile clients, billing employees by card, subscription commerce, public multi-organization signup, enterprise SSO, OCR, general web search, automatic actions in external systems, and native mobile companion apps. The MVP does not execute instructions found in documents or speech.

## Planning estimate

For one experienced developer with Claude assistance: roughly 1–2 weeks for feasibility and a narrow working vertical slice, then another 3–6 weeks for both-platform hardening, administration, accounting, and a controlled pilot. This is a planning assumption, not a delivery commitment. Hardware compatibility, signing, quality results, and provider approval determine the actual date.
