# API setup and owner funded credits

## Required services

These are proposed choices, not accounts already provisioned or tested. Configure credentials in the target hosting secret manager or a local ignored environment file; do not paste secrets into chat or the repository.

| Service | Purpose | What the owner supplies |
|---|---|---|
| Anthropic Claude API | Grounded answers and bounded summaries | API key, funded account, permitted models and rate limits |
| Deepgram API | English streaming transcription | API key, funded account, approved endpoint/region |
| Neon Postgres | Accounts, workspace bindings, metadata and ledger | Runtime pooled connection and separate migration credentials |
| Railway | Persistent API/gateway, worker and optional private storage | Existing connector access scoped to this project; selected plan/region |
| Vercel | Web dashboard | Existing project/connector access and domain configuration |
| Private S3-compatible object storage | Documents and extraction artifacts | Bucket, endpoint, region, scoped access credentials; select one provider |
| Transactional email, e.g. an approved SMTP service | Invitations and password resets | SMTP credentials, verified sender/domain; no marketing mail |
| Windows signing and Apple Developer credentials | Trusted desktop distribution | Signing access, Apple team/notarization setup, CI secrets |

Render can replace Railway. Do not deploy duplicate production backends simply because both connectors exist. No Google Meet, Teams, or Slack API is required for the proposed local capture approach. Each application still requires a compatibility test. No embedding API is required for the bounded full-context MVP. OCR and payment processing APIs are deferred. Authentication can run through a maintained library on the backend rather than adding a paid identity service initially.

Claude Code's coding subscription/connector access and the product's runtime provider billing are separate concerns. A deployment connector does not automatically fund Anthropic or Deepgram, create signing certificates, or authorize client-data processing in a region.

## Connection test flow

Admin submits a key over TLS. Server stores it in the secret mechanism and displays only a fingerprint. Run a tiny, explicitly priced-limit test: an answer against a fixed nonconfidential fixture and a short synthetic English speech sample. Record provider, model, timestamp, result, latency, and actual or conservatively estimated cost. Maximum proposed spend is $0.10 per combined test; rate-limit to five attempts/hour. Charge an organization operations wallet, not a random member. Activate only successful configurations. Preserve the previous working configuration if replacement fails. Do not log provider responses containing secrets.

## Price reference and estimate

Observed 2 October 2026, subject to change and account-specific terms:

- Deepgram lists promotional Nova-3 monolingual streaming at $0.0048/minute, with a displayed regular rate of $0.0077/minute. [Deepgram pricing](https://deepgram.com/pricing).
- Claude Haiku 4.5 is listed at $1/million input tokens, $5/million output tokens, $1.25/million for five-minute cache writes, and $0.10/million cache reads. This is a candidate economical model, not a quality guarantee. Select the production model after evaluation and verify its actual ID and availability. [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing).

Illustrative 60-minute meeting, two separately billed audio streams, 30 answers, 40,000 stable document tokens, 2,000 additional input tokens/answer, and 200 output tokens/answer:

| Component | Assumption and calculation | USD |
|---|---|---:|
| Audio | 60 × 2 × 0.0048 | 0.576 |
| First cached prefix | 40,000 × 1.25 / 1,000,000 | 0.050 |
| Subsequent cached prefix | 29 × 40,000 × 0.10 / 1,000,000 | 0.116 |
| New input | 30 × 2,000 × 1 / 1,000,000 | 0.060 |
| Answer output | 30 × 200 × 5 / 1,000,000 | 0.030 |
| Example subtotal | Assumes 29 cache hits | **0.832** |

If instead all 30 answers use ordinary uncached document input, the same example is **$1.866**. Repeated cache creation can cost more than ordinary uncached input. These are calculations, not a quote or upper bound. The example excludes question classification, summary updates, retries, taxes, provider rounding/add-ons, ingestion infrastructure, storage, email, and hosting. Longer histories, expensive models, cache expiry, and two-channel pricing can materially change it. Verify channel billing against [Deepgram multichannel documentation](https://developers.deepgram.com/docs/multichannel) and actual account invoices.

For planning only, $5/$10/$20 could cover roughly 2/5/10 meetings if total measured variable cost were $2/meeting. Show usage dollars first, not promised meeting hours. Reserve a separate provisional $30–$100/month infrastructure budget for a small always-on pilot, then replace it with the actual hosting plans and measured costs before purchase. This is an internal planning allowance, not provider pricing.

## Wallet contract

Credits are internal spending allowances in USD funded by the owner; granting $10 in the app does not deposit $10 with a provider. No member checkout or cash redemption in MVP. Grants do not expire or recur automatically. Admin adds a grant or adjustment with a reason; never edits past usage. No markup in MVP. Infrastructure costs are reported separately and are not silently deducted from member balances.

`available = grants + adjustments - settled_usage - active_reservations`.

Use integer micro-USD. The ledger is append-only and every grant, reservation, and settlement has an idempotency key. A displayed balance is not authoritative; only the server can admit a paid operation.

### Admission and reconciliation

1. Lock the organization spending row and member wallet row in a consistent order inside one transaction. Check active status, workspace binding, one-active-meeting lease, individual available funds, and organization daily/monthly cap.
2. Before an LLM request, reserve the upper cost bound for counted input, maximum output, and the most expensive applicable cache-write case. Use an immutable price version and account for any configured paid features. Reject unknown pricing; do not assume free fallback.
3. Before speech starts, reserve a short metering interval, initially 15 seconds, for every open stream/channel plus billing granularity and shutdown-latency headroom. Renew the lease before its paid horizon ends. If renewal fails, the gateway closes the provider connection while already-reserved headroom covers shutdown. Enforce a local monotonic deadline even if Postgres is unavailable.
4. Persist the request/attempt before sending it. Each paid retry has its own reservation; an operation ID ties attempts together. Do not automatically retry a request with an unknown provider outcome unless accounting permits both possible charges.
5. On definitive completion, atomically convert the reservation into actual usage and release unused funds. Repeated completion messages cannot charge twice. Record input, output, cache write/read tokens and stream seconds, including abandoned but billable operations.
6. If usage is unknown after disconnect/crash, keep a conservative pending charge or reservation and reconcile later; never refund merely because a process died or a lease expired. A cleanup job may release only evidence-backed unused reservations. Reconcile to provider usage/invoices, with manual exception review when per-request usage is unavailable.
7. If actual cost exceeds reservation because a provider rate/rounding assumption was wrong, record the real expense, freeze new admission if needed, and alert admin. Do not hide or discard liability to preserve a cosmetic zero balance. Use organization provider-side limits where available as a second control; exact external billing cutoff is not guaranteed by the app alone.

Warnings at 80% and 95% of the current grant budget; no new paid work if funds cannot cover the next reservation. A zero balance still allows login, document review, usage review, and administrative recovery. Admin balance reductions cannot consume funds already reserved. Re-enabling a user does not restore revoked sessions; require login again.

## Owner input checklist

- [ ] Super-admin email and company display name; ContextHarbor Labs is only a working brand.
- [ ] Company meeting AI policy reference/version and approval for any freelance client material.
- [ ] Preferred data region and approved provider retention terms.
- [ ] Anthropic and Deepgram funded accounts and keys configured securely.
- [ ] Railway or Render selected; Vercel and Neon access verified for the intended project.
- [ ] Private storage and email sender configured.
- [ ] Pilot Windows/macOS hardware, accounts, and receivers for sharing tests.
- [ ] Signing/notarization access for release distribution.
- [ ] Initial organization spend cap and each member's grant.

These setup items are owner dependencies, not engineering completion checkboxes. Missing credentials must not stop local tests with explicit fake providers, but fake providers cannot satisfy release acceptance.
