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
