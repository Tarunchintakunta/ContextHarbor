# Account isolation and answer grounding

Treat the immutable organization, account, workspace and meeting IDs as a single checked scope. Validate it on every request, source lookup, signed URL, provider call and stream event. Cache keys include scope, source version hashes and prompt version. Never share cached answer objects between accounts.

Each member login has one workspace and one active meeting at a time. Admin access must be explicit and audited. Tests must include two clients with similar document titles and contradictory facts. Switching accounts must stop audio and discard late old-session events.

Do not infer facts absent from authorized evidence. Cite source spans from the selected pack, label current-meeting statements separately, and keep reviewed project briefs versioned. Missing evidence leads to abstention. Source deletion invalidates active and cached context.
