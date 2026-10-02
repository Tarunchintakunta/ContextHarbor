# Acceptance and failure cases

The source of task completion is TASKS.md. This document defines test scenarios; a plausible demo does not replace them.

| Case | Required behavior |
|---|---|
| Outstar login requests Chintakunta document ID | Deny without leaking filename, content, existence details, or a signed URL |
| Same file uploaded to two client accounts | Separate access-scoped metadata and caches; deduplication must not create cross-client access |
| Login switch while STT/answer is streaming | Stop old streams, clear source buffers and overlay, reject late events and require a new meeting |
| User changes password | Revoke sessions; preserve immutable workspace binding and all ledger entries |
| Deactivate while meeting is active | Revoke and close paid streams within target; settle billable work and block reconnect |
| Admin attempts to deactivate sole admin | Reject; documented recovery process handles lost access |
| Expired or replayed invite/reset/socket ticket | Reject; no second session or privilege escalation |
| Shared device | No saved document text in local caches by default; credentials in OS store; logout clears current identity |
| New client using a previous client's account | Disallow silent reassignment; create new workspace/account |
| Duplicate/retried upload completion | One version/job for the idempotent request; show existing status |
| File extension does not match content | Reject before parsing as ready |
| Malicious DOCX zip, PDF, Markdown HTML | Bounded sandbox extraction; no network calls/macros/scripts; safe text rendering |
| Scanned or partly scanned PDF | Flag affected pages; no claim all contents were understood; user-visible remediation |
| Bad tables or missing images | Extraction preview and persistent limitation indicator; abstain on unreadable evidence |
| Password-protected PDF/DOCX | Explain unsupported encrypted upload; user supplies an authorized unlocked copy |
| Source revised mid-meeting | Current immutable version remains labeled until explicit refresh; no silent source changes |
| Source deleted or access revoked | Invalidate pack, cancel pending answers, prevent subsequent cached use and downloads |
| Total pack exceeds tokens | Show exact limit and reject preparation; no silent truncation |
| Conflicting deadlines | Cite both source versions and ask which is authoritative; do not invent priority by upload date |
| Status absent or stale | State what the source says and its date; never assert current completion without evidence |
| Prompt injection in document or speech | Treat as content; no tools, secrets, policy override, or cross-client requests |
| Missing answer | Display not found and a useful clarification; no general-knowledge guess presented as project fact |
| Follow-up such as “and who owns that?” | Use recent meeting context and cited source; ask clarification if referent is ambiguous |
| Two questions overlap | Bound the queue; newest automatic question supersedes stale work; pinned answer remains visible |
| Local speech repeats an answer | Do not repeatedly trigger on local channel; test speaker echo and repeated utterances |
| Accent, jargon, wrong transcript | English technical-term hints; editable question/manual trigger; uncertainty visible |
| Meeting spoken in another language | English-only notice; do not pretend reliable translation is supported |
| Zero audio despite granted permissions | Level-meter timeout and actionable troubleshooting; never show healthy listening based only on permission status |
| Unrelated system notification audio | Scope warning and source/device controls where available; exclude app-generated audio |
| Network drop or gateway restart | Show gap, close/orphan-safe settle streams, reauthorize on reconnect; no duplicate charges |
| Slow generation/provider timeout | Bounded timeout, retry budget, and visible failure; old text marked stale |
| Provider rate limit/invalid credentials | Clear state, backoff, admin health event; no unlimited failover or paid retry loop |
| User has $0 or insufficient next reservation | Block new paid work; preserve account and document access |
| Two devices start one account simultaneously | Atomic meeting lease allows one; losing request is rejected before provider billing |
| Multiple users spend last organization funds | Transactional reservations enforce organization cap under concurrency |
| Crash after provider billed but before settlement | Pending conservative liability retained; reconciliation prevents free usage/double settlement |
| Provider price changes | Versioned rates; stop unknown-priced admission; reconcile and expose variance |
| Admin grants twice due to retry | Idempotency prevents duplicate grant |
| Admin lowers wallet below reservation | Reject invalid adjustment; do not erase pending liability |
| Hide overlay | Listening remains explicitly visible in tray; separate pause stops paid capture |
| Quit, lock, sleep, lost permissions | Stop capture and release devices; no silent resume |
| Unsupported share mode | No privacy guarantee; hide overlay and offer tested window share or unshared display |
| User deletes meeting with persistent brief | Explain approved brief is separate saved data; offer deleting derived brief content; enforce provenance |
| Restore old database backup | Reapply deletion tombstones before serving data |

## Evaluation fixtures

Use synthetic or company-approved nonconfidential fixtures, checked into a test-only directory. Include Markdown, text PDF, DOCX with a table, mixed text/scanned PDF, a corrupt file, conflicting versions, stale status, injection attempts, and two client workspaces with deliberately similar names and different facts.

A minimum 100-question evaluation includes 60 answerable, 20 unanswerable, 10 conflicting, and 10 multi-turn questions. Track exact factual correctness, citation validity and support, abstention, critical fabricated claims, final-utterance-to-answer latency, model, price version, pack size, cold/warm cache, and token/audio usage. Report per-category results, not only an average. Include 40,000-token packs rather than evaluating only tiny samples.

Separately use labeled meeting audio for question detection recall/false triggers, accents, interruptions, headphones/speakers, and silence. Use deterministic fake providers for CI failure modes and budget races; use bounded live-provider tests for actual latency, quality, and billing. No live-provider secrets in CI pull requests.

## Release gates

- Both platforms pass signed-install, permission, capture, and required receiver-side sharing tests.
- A member cannot access another login's client context across any API, stream, cache, storage path, or UI navigation.
- PRD quality/latency targets pass, or the owner explicitly revises the scope/targets with recorded rationale before release.
- Wallet race, idempotency, unknown-outcome, and restart tests pass; provider reconciliation has been exercised.
- Retention/deletion and restore procedures work; secret scanning and dependency review have no unresolved critical findings.
- A small real pilot completes and the owner has a concrete support matrix, operating cost report, and rollback plan.

## Operations and recovery

Monitor first-answer latency, empty audio, disconnects, failed extraction, invalid citations, provider errors, low credit, ledger discrepancies, and cleanup lag. Logs contain IDs and timing, not raw documents, audio, transcripts, credentials, or answer text by default.

Deploy staging first with a separate database, bucket, provider key scope, and email mode. Apply additive database migrations before compatible app releases. Back up and prove restore before destructive migrations. For rollback, disable paid-session admission, drain streams, roll back app/worker versions, keep compatible schema, reconcile pending ledger entries, and re-enable only after smoke tests. Never reset or rewrite the spend ledger as a rollback technique.

During provider outage, existing sourced text can remain readable with a stale label; new live answers are unavailable. During a suspected isolation incident, revoke affected sessions, stop new paid admission, preserve redacted audit evidence, rotate compromised secrets, and follow the company's incident process.
