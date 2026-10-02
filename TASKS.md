# ContextHarbor implementation tasks

This is the authoritative engineering checklist. All tasks are initially pending. Requirements are specified in docs/PRD.md; a checkmark means implementation and acceptance evidence exist, not merely that code was written.

## Execution rules

Take the first unblocked task whose dependencies are checked. Work on one task at a time. On starting, put its ID in STATUS.md. On passing acceptance, append evidence to docs/EVIDENCE.md, mark only that task `[x]`, update STATUS.md, and commit if working in a Git repository. Continue to the next unblocked task while the session is active.

If a task is blocked by hardware, signing access, credentials or an owner decision, leave it unchecked, record the precise blocker, and continue independent local work. Never pretend mocks prove live audio, paid billing, distribution, or screen-share protection. T03 and T04 require real target hardware; T05 is a product feasibility gate. Independent infrastructure work may proceed, but release depends on the full chain.

Tasks are estimates of small implementation slices; split a task if it cannot fit in one coherent change, assigning stable child IDs and updating dependencies. Do not remove acceptance criteria or weaken thresholds merely to mark it complete. Completion status belongs only here; STATUS.md is a current handoff, not a competing checklist.

## Discovery

- [x] **T01 — Confirm implementation environment and scope**

  Dependencies: none.

  Implement: Read this pack and existing repository instructions; inventory existing code, connectors, available test hardware and provider access without modifying external resources. Record small collection per login, one workspace per member, both OS targets, and missing owner inputs.

  Acceptance: STATUS.md identifies exact gaps; existing user files preserved; no secrets printed.

  Evidence: Scope decisions and environment inventory.

## Feasibility

- [x] **T02 — Bootstrap the smallest desktop feasibility harness**

  Dependencies: T01.

  Implement: Create a pinned Electron/TypeScript shell with an overlay marker, local status, show/hide, pause and quit controls. Use generated nonconfidential fixture content.

  Acceptance: Window works without taking presentation focus; quit releases all acquired resources.

  Evidence: Build/run commands and local screenshot.

- [ ] **T03 — Prove Windows remote audio and capture behavior**

  Dependencies: T02.

  Implement: Implement remote audio acquisition and separate optional mic stream; test headphones, permission/device failures and receiver-side overlay behavior for the Windows matrix.

  Acceptance: Actual remote voice captured with mic disabled; all intended share modes have receiver evidence and honest support status.

  Evidence: Exact OS/runtime versions and receiver test records.

- [ ] **T04 — Prove macOS packaged audio and capture behavior**

  Dependencies: T02.

  Implement: Add required permission descriptions; package a test build and verify audio on Apple Silicon and Intel targets. Test receiver view and fallbacks; document full-display limitations.

  Acceptance: Packaged app captures remote audio with headphones; tested window/unshared-display fallback works; untested architecture remains blocked.

  Evidence: Build, permissions and hardware evidence.

## Feasibility gate

- [ ] **T05 — Record feasibility decision and supported modes**

  Dependencies: T03,T04.

  Implement: Update compatibility rows with evidence and supported fallbacks; record whether the key product outcome is achievable on each target.

  Acceptance: Do not advance to release promises if any required behavior is unproven; alternatives are concrete and limitations explicit.

  Evidence: Decision log entry and compatibility matrix.

## Foundation

- [ ] **T06 — Create monorepo and meaningful CI checks**

  Dependencies: T02.

  Implement: Create web, desktop, API, worker and shared package boundaries; pin runtime/dependencies and establish documented lint, typecheck, unit and build scripts.

  Acceptance: Clean checkout installs and builds; CI has no production secrets; scripts in CLAUDE.md match reality.

  Evidence: CI run and commands.

## Identity

- [ ] **T07 — Select authentication library and create schema migrations**

  Dependencies: T06.

  Implement: Verify maintained auth library meets password/MFA/revocation/desktop login needs. Implement organization, account, unique workspace binding and auth tables with constraints.

  Acceptance: Migration works forward on empty DB; duplicate member-workspace bindings and second super admin are rejected.

  Evidence: ADR, schema tests and migration logs.

- [ ] **T08 — Implement super admin bootstrap and recovery**

  Dependencies: T07.

  Implement: Create one-time bootstrap without a default password; require MFA, disable bootstrap after use and document recovery. Protect sole admin lifecycle.

  Acceptance: Cannot run bootstrap again or deactivate sole admin; recovery is audited and revokes compromised sessions.

  Evidence: Integration test and recovery runbook.

- [ ] **T09 — Implement invitation and member login**

  Dependencies: T08.

  Implement: Create admin workspace plus member invitation atomically; accept expiring single-use invite; disable public signup and role assignment.

  Acceptance: Expired/replayed invites fail; member gets exactly one workspace and no admin privileges.

  Evidence: Auth integration tests.

- [ ] **T10 — Implement reset, deactivate and reactivate**

  Dependencies: T09.

  Implement: Add email reset, session version invalidation and account status changes with audit events.

  Acceptance: Reset is single-use and revokes sessions; deactivate blocks new calls; reactivate requires fresh login.

  Evidence: Revocation tests.

- [ ] **T11 — Implement workspace authorization and isolation**

  Dependencies: T09.

  Implement: Centralize server authorization and DB defense in depth; protect all resource access and administrative inspection.

  Acceptance: Adversarial Outstar/Chintakunta tests cannot read or mutate each other’s resources; no caller-selected role or scope is trusted.

  Evidence: Negative access-control tests.

- [ ] **T12 — Implement secure desktop browser login and logout**

  Dependencies: T10,T11.

  Implement: Implement PKCE browser handoff, allowlisted redirect, OS credential storage and one active desktop identity.

  Acceptance: Replay/redirect attacks fail; logout clears both main/renderer state; account switch invalidates old generation events.

  Evidence: Desktop auth integration tests.

## Dashboard

- [ ] **T13 — Build member and admin dashboard shells**

  Dependencies: T11.

  Implement: Member sees only its workspace; admin sees account/workspace management. Add persistent client labels, empty/error/loading states and accessible controls.

  Acceptance: Member cannot navigate to another client; admin creates, resets and disables a test member through actual API calls.

  Evidence: Browser workflow test.

## Knowledge

- [ ] **T14 — Implement safe document upload and metadata**

  Dependencies: T11.

  Implement: Create private quarantined upload flow, server size/type/checksum validation, immutable versions and deduplicated completion jobs.

  Acceptance: Oversize/mismatched/cross-account uploads rejected; public access denied; retries create one version.

  Evidence: Storage/API integration tests.

- [ ] **T15 — Implement Markdown and text PDF extraction**

  Dependencies: T14.

  Implement: Extract in resource-bounded worker with source locators, warnings and text previews. Detect corrupt/encrypted/scanned pages.

  Acceptance: Fixtures preserve locators; partial or empty extraction never silently becomes fully ready.

  Evidence: Fixture assertions and extraction previews.

- [ ] **T16 — Implement DOCX text and table extraction**

  Dependencies: T14.

  Implement: Use a maintained safe parser in bounded worker; heading/paragraph locators, tables and explicit visual limitations; reject macro/legacy files.

  Acceptance: DOCX fixtures have correct readable text; malformed/zip-bomb fixtures stop within limits; no remote fetch or macro execution.

  Evidence: Parser tests and sample preview.

- [ ] **T17 — Implement ready document collection UI**

  Dependencies: T13,T15,T16.

  Implement: Allow upload, retry, preview, explicit limitation acceptance, source selection and deletion in one workspace.

  Acceptance: At most configured files per meeting pack; readable failure reasons; no other workspace files appear.

  Evidence: Member upload workflow test.

- [ ] **T18 — Implement exact context pack construction**

  Dependencies: T17.

  Implement: Build immutable manifest and token count for selected source versions, notes and brief; enforce all limits without truncation.

  Acceptance: 40,000-token boundary tests pass; over-limit pack rejected; deleting source invalidates existing pack.

  Evidence: Token boundary and version tests.

## Providers

- [ ] **T19 — Implement provider configuration and bounded health tests**

  Dependencies: T08,T06,T20.

  Implement: Build write-only secret configuration, model allowlist, price-version record and synthetic bounded connectivity tests.

  Acceptance: Keys never reach bundles/logs; failed replacement retains previous working config; costs go to operations budget.

  Evidence: Mock tests plus bounded live test when funded.

## Budgets

- [ ] **T20 — Implement append-only wallets and grants**

  Dependencies: T07.

  Implement: Create micro-USD ledger, idempotent grants/adjustments, operations wallet and organization caps.

  Acceptance: Duplicate grant is no-op; concurrent adjustments preserve invariants; spent/pending/available are consistent.

  Evidence: Database money and concurrency tests.

- [ ] **T21 — Implement atomic model cost reservation and settlement**

  Dependencies: T19,T20.

  Implement: Count input and reserve worst-case paid model cost before call; settle actual usage exactly once with price version.

  Acceptance: Cold-cache/write cases fit admission; concurrent last-dollar requests cannot overspend admitted funds; unknown usage remains pending.

  Evidence: Race, retry and failure-injection tests.

- [ ] **T22 — Implement speech leases and crash reconciliation**

  Dependencies: T21.

  Implement: Reserve timed stream slices per channel plus shutdown headroom; enforce gateway deadlines and orphan reconciliation.

  Acceptance: Cutoff before unreserved audio; DB outage closes at reserved horizon; provider-billed crash retained and reconciled without double charge.

  Evidence: Clock-controlled stream tests and restart tests.

- [ ] **T23 — Expose grants and usage in dashboard**

  Dependencies: T13,T20,T21.

  Implement: Admin grants $5/$10/$20/custom; members see settled/pending/available and usage; warn on thresholds.

  Acceptance: UI matches ledger, zero-credit user can still access documents, and unauthorized grants fail.

  Evidence: End-to-end grant/spend workflow.

## Live meeting

- [ ] **T24 — Implement meeting lifecycle and secure socket gateway**

  Dependencies: T11,T12,T18,T22.

  Implement: Create scoped meeting state machine, single-active-meeting lease, short-lived socket tickets, validated events and audio limits.

  Acceptance: Invalid/replayed tickets and concurrent account meeting rejected; deactivation closes active streams within target.

  Evidence: Socket authorization/lifecycle tests.

- [ ] **T25 — Connect desktop audio to streaming transcription**

  Dependencies: T03,T04,T19,T24.

  Implement: Send bounded labeled audio streams through API to STT; show levels, final/partial text and gap states; meter all channels.

  Acceptance: Headphone call produces remote text; pause/stop stops provider billing stream; no screen frames or raw audio saved.

  Evidence: Bounded live two-device test and network test.

- [ ] **T26 — Implement question detection and manual fallback**

  Dependencies: T25,T21.

  Implement: Debounce finalized remote utterances, suppress duplicates, add manual question trigger and bounded optional classifier.

  Acceptance: Labeled audio meets detection targets; local repetition/interim events do not trigger endless paid calls.

  Evidence: Detection report and duplicate-event tests.

## Answers

- [ ] **T27 — Implement bounded grounded answer generation**

  Dependencies: T18,T21.

  Implement: Build provider adapter, versioned prompt, bounded context and structured cited output. Cache scoped stable prefix where eligible.

  Acceptance: Fixture answers cite actual spans, conflict/unknown cases handled, injections ignored, all requests metered.

  Evidence: Grounding unit/integration tests.

- [ ] **T28 — Implement meeting memory and follow-up resolution**

  Dependencies: T26,T27.

  Implement: Maintain bounded recent turns and referenced summary with metered compaction. Keep workspace session scopes strict.

  Acceptance: Multi-turn follow-up works after compaction; context cap enforced; summary claims labeled and do not override source facts.

  Evidence: Multi-turn and long-session fixtures.

- [ ] **T29 — Validate streamed answers and cancel stale generations**

  Dependencies: T27,T28.

  Implement: Use generation IDs, provisional streaming, server citation checks, at most one bounded repair and cancellation.

  Acceptance: Late former-account answers discarded; invalid references suppressed; no unlimited repair/retry spending.

  Evidence: Out-of-order, injection and cancellation tests.

## Desktop

- [ ] **T30 — Finish production overlay interaction**

  Dependencies: T05,T12,T29.

  Implement: Add pin, show/hide, independent pause, resizable readable UI, rebindable shortcuts and persistent workspace label.

  Acceptance: No focus theft; pinned content stable; hide does not falsely imply paused; unsupported share mode has honest fallback.

  Evidence: Desktop interaction and receiver tests.

## Project memory

- [ ] **T31 — Implement reviewed persistent project brief**

  Dependencies: T28,T17.

  Implement: Generate optional metered draft from a completed meeting; user reviews edits and approves version with provenance.

  Acceptance: Unapproved draft excluded from future packs; approved changes versioned and source deletion behavior explained.

  Evidence: Review/save/reuse workflow.

## Operations

- [ ] **T32 — Implement retention and deletion jobs**

  Dependencies: T18,T24,T31.

  Implement: Purge expired meeting data, invalidate deleted sources and derived caches, retain minimal accounting and tombstones; support zero-retention mode.

  Acceptance: Immediate access revocation, 24-hour purge target and no durable transcripts in zero mode verified.

  Evidence: Lifecycle tests and cleanup metrics.

- [ ] **T33 — Implement recovery and graceful shutdown**

  Dependencies: T22,T25,T29.

  Implement: Handle network interruption, rate limits, revoked permissions, device swaps, sleep and server draining with bounded buffers.

  Acceptance: No silent resume or raw-audio backlog upload; gaps visible; ledger conserved after restart.

  Evidence: Fault-injection and hardware tests.

## Hardening

- [ ] **T34 — Harden desktop IPC and web security**

  Dependencies: T12,T17,T30.

  Implement: Enforce sandbox/CSP/validated IPC, navigation controls, output sanitization, rate limits, CSRF/Origin checks and secret redaction.

  Acceptance: Malicious documents cannot execute script or IPC; secret scanning passes; renderer cannot read provider credentials.

  Evidence: Security regression tests.

- [ ] **T35 — Run full account isolation regression**

  Dependencies: T23,T29,T31,T32,T34.

  Implement: Exercise every entry point, caches, source previews, downloads, history, wallet, logins and late events using two similar client contexts.

  Acceptance: Zero cross-account data or spend exposure; role escalation and account reassignment attempts fail.

  Evidence: Endpoint coverage and negative-test report.

## Quality gate

- [ ] **T36 — Build and run answer quality evaluation**

  Dependencies: T27,T28,T29.

  Implement: Create the 100-question set and labeled meeting audio suite, run candidate models, and compare measured quality/latency/cost.

  Acceptance: Report PRD gates by category and cold/warm cache; select verified model ID; failures stay open.

  Evidence: Reproducible evaluation report and ADR.

- [ ] **T37 — Run concurrency and cost reconciliation soak**

  Dependencies: T22,T33,T35.

  Implement: Run three concurrent 60-minute sessions with restarts, $0/last-credit edges and provider usage reconciliation.

  Acceptance: No duplicate settlement or cross-client answer; measured cost variance explained and corrected.

  Evidence: Load and accounting report.

## Deployment

- [ ] **T38 — Provision isolated staging and deploy web/backend**

  Dependencies: T19,T32,T34.

  Implement: Use authorized connectors to configure one backend host, Vercel, Neon, storage and secrets. Scope resources and record expected recurring cost.

  Acceptance: Health checks, TLS, migrations and private storage pass; production resources and data are not accidentally reused.

  Evidence: Staging URLs, resource IDs and smoke test.

## Distribution

- [ ] **T39 — Build signed Windows distribution**

  Dependencies: T30,T34,T38.

  Implement: Configure secure signing and release packaging; install/update/uninstall on a clean Windows target.

  Acceptance: Trusted signed artifact launches with correct permissions and matching build provenance; rollback artifact available.

  Evidence: Installer hash and clean-device test.

- [ ] **T40 — Build signed and notarized macOS distributions**

  Dependencies: T30,T34,T38.

  Implement: Configure signing, entitlements and notarization; test supported Apple Silicon and Intel packages on clean targets.

  Acceptance: Notarization verified, audio works in packaged install and permissions recover correctly.

  Evidence: Artifact hashes and platform test evidence.

## Release gate

- [ ] **T41 — Complete release compatibility matrix**

  Dependencies: T39,T40,T33.

  Implement: Repeat Meet/Teams/Slack receiver checks on release artifacts for each supported OS/architecture and mode.

  Acceptance: No NOT TESTED cell is claimed supported; failed full-display modes clearly documented and fallback verified.

  Evidence: Completed matrix and receiver evidence.

- [ ] **T42 — Verify backup restore and operational runbook**

  Dependencies: T32,T38.

  Implement: Run staging backup/restore, tombstone replay, key rotation and rollback rehearsal; configure redacted metrics and budget alerts.

  Acceptance: Deleted data stays unavailable after restore; paid admission can be safely stopped and ledger remains intact.

  Evidence: Restore/rollback evidence and operator runbook.

## Pilot

- [ ] **T43 — Run controlled office and freelance pilot**

  Dependencies: T36,T37,T41,T42.

  Implement: Pilot separate office and freelance client accounts, collect usefulness ratings, corrections, latency and actual spend.

  Acceptance: At least five meetings reviewed with owner; blocking defects recorded and fixed; no unresolved isolation or capture claims.

  Evidence: Pilot report and follow-up defect tasks.

## Release

- [ ] **T44 — Prepare production handoff and release**

  Dependencies: T43.

  Implement: Provide final supported modes, artifact downloads, operating costs, admin recovery instructions and remaining limits. Deploy only within owner-authorized production scope.

  Acceptance: Owner can invite, fund, upload, run meeting, review source, stop and revoke account; final live smoke and rollback available.

  Evidence: Release notes, deployment record and handoff.

