# ContextHarbor implementation pack

Prepared 2 October 2026 for the product owner and Claude Code. This is an implementation specification, not a built or deployed application. All engineering tasks start unchecked.

**Working company name:** ContextHarbor Labs. **Product:** ContextHarbor. **Positioning:** Your project context, ready when the question comes. These are naming proposals; domain and trademark availability have not been checked.

Build a Windows and macOS desktop meeting assistant with a web dashboard. Each member login opens exactly one client workspace. Upload its source document(s), prepare its meeting knowledge pack, and receive short, cited answers in a small movable window. One super admin manages individual member accounts and prepaid internal AI allowances.

## Confirmed requirements

- Windows and macOS in the first release.
- English meeting audio and answers.
- Markdown, PDF, and Word `.docx` documents.
- An existing company policy permits meeting AI use. Record its policy version during setup; do not invent a new consent ceremony on every call.
- One super admin, multiple individual member logins, password recovery, account activation/deactivation, and owner-funded $5/$10/$20 allowances.
- Each member login is bound to exactly one client/project workspace, including freelance clients such as Outstar and Chintakunta. Passwords authenticate accounts; immutable account/workspace IDs isolate data.
- A small document collection per login is confirmed; initial proposed limits are 20 active files, 25 MiB/file, and a 40,000-token meeting pack.
- No cross-client context switching inside a live meeting. Signing into a different client ends the current session and clears its local context.
- Answers remain outside the shared presentation where the tested sharing configuration permits it.

## Read and execute

1. Read [Product requirements](docs/PRD.md).
2. Read [Architecture](docs/ARCHITECTURE.md) and [API and cost setup](docs/API_AND_COSTS.md).
3. Use [TASKS.md](TASKS.md) as the only authoritative task checklist.
4. Copy this folder's contents, including `.claude`, into the intended repository root. If a repository already has instructions, merge deliberately instead of overwriting them.
5. Start Claude Code in that repository and paste [START_HERE.md](START_HERE.md).
6. Claude must update [STATUS.md](STATUS.md) and the evidence record after every completed task. Resume from these files in later sessions.

`CLAUDE.md` supplies repository instructions. It does not itself run Claude continuously, grant connector permissions, buy services, or prove completed work. A session must be running, and external credentials/hardware can block particular tasks. See [Claude Code memory documentation](https://code.claude.com/docs/en/memory).

## First milestone

Prove audio capture and receiver-side overlay behavior on both operating systems before building the complete dashboard. macOS full-display exclusion is not a dependable product promise. Default to sharing a specific application window; use a separate unshared display when necessary. Exact supported combinations must appear in [the compatibility matrix](docs/COMPATIBILITY.md).

## Proposed defaults

Use Electron, TypeScript/React, Next.js, a persistent Node backend on Railway, Neon Postgres, private object storage, Deepgram transcription, and Claude API answers. Render is an alternative to Railway, not another required backend. Begin with bounded full-context document grounding; no vector database or embedding API is required in version one.

Pilot assumption: 10 named users and 3 simultaneous meetings. Target Windows 11 x64 and macOS 14.2 or newer on Apple Silicon and Intel, subject to signed-build testing and supported runtime versions. Limits and service levels below are proposed acceptance targets, not measured results.

The remaining inputs are the admin email, company policy reference, preferred data region, provider credentials, actual pilot devices, and signing accounts. Local mock development can proceed while these are collected.
