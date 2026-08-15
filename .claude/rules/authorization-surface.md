---
paths:
  - "firestore.rules"
  - "database.rules.json"
  - "firestore.indexes.json"
  - "firebase.json"
  - "functions/src/config.ts"
---

# Authorization and deployment surface

You are editing what a client is allowed to do, or how the app is served. This is the highest-consequence surface in the repository and the one with the weakest local feedback.

- Never widen a Rule to make a client write succeed. The write belongs in a callable. `senderType`, `kind`, membership, call state, push claims and journals are server-written by design.
- `pnpm test:rules` is mandatory for any change to `firestore.rules` or `database.rules.json`, together with a test for the new case — allowed *and* denied. No exceptions, and "only a few users" is not one.
- A new or changed query ships its composite index in `firestore.indexes.json` in the same phase that deploys the Function using it, or the query fails in production only.
- `firebase.json` carries CSP, cache headers and emulator ports. A new external origin needs a CSP entry; a caching change is invisible to a reloaded tab and must be checked in a fresh private window.
- App Check enforcement is per feature and all-or-nothing within a feature group. Never enforce on a subset.

Why: a mistake here is silent locally, passes typecheck, and is either a data-exposure bug or a production outage. `pnpm check` proves nothing about this surface.
