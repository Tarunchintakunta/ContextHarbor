# Start Claude Code implementation

Copy the following prompt into Claude Code after placing this pack at the intended repository root:

> Act as the senior engineer implementing ContextHarbor. Read CLAUDE.md, STATUS.md, TASKS.md, docs/PRD.md, docs/ARCHITECTURE.md, and docs/DECISIONS.md. Inspect the repository and preserve existing work. Start with T01, then implement the first unblocked task whose dependencies are complete. Work one task at a time, verify its acceptance, append real evidence to docs/EVIDENCE.md, check its box, and update STATUS.md before continuing. Use my authorized connectors only for this project's scoped resources, and do not expose secrets. If a credential or target device is missing, record the blocker and continue independent work with clearly labeled mocks. Prioritize actual Windows/macOS audio and receiver-side sharing feasibility before a polished dashboard. Do not promise universal invisibility. Each login must use only its one client workspace and small document collection. Keep going through unblocked tasks during the session; preserve an exact handoff if the session ends. Do not mark the product complete until the release gates pass.

For a later session:

> Resume ContextHarbor from CLAUDE.md, STATUS.md and TASKS.md. Verify current repository state and evidence, then continue the first unblocked task. Do not reset checkboxes or redo completed work without a specific reason.

No provider secrets belong in either prompt. Use ignored local environment files or hosting secret configuration. A Claude Code session or authorized runner must actually be active; these instructions do not create an unattended scheduler.
