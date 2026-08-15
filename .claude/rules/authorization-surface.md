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
- `firebase.json` carries CSP, cache headers and emulator ports. A new external origin needs a CSP entry. HTML is served `no-cache` (two rules: `/` and `**/*.html`, because a Hosting glob matches the request path and `**/*.html` alone misses the root), so a deployed header change reaches a plain reload — do not send anyone to a private window to see it.
- Match the CSP directive to how the resource is actually fetched, not to what it is. An SDK that loads over a script element needs `script-src`; `connect-src` cannot authorise one. Firebase RTDB's `BrowserPollConnection` is JSONP (`<script src=".../.lp?...">`) and is the *initial* transport whenever `WebSocketConnection.previouslyFailed()` is true — which the SDK sets before every WebSocket open and clears only once a connection proves healthy, so it is a routine path, not a fallback. A vendor whose host is server-redirected (RTDB caches an `s-*` host in `internalHost` and builds every later URL from it) needs the domain wildcard; pinning the project origin passes the first load and blocks everything after. Verify a policy change against the deployed origin, because the Hosting emulator does not apply `firebase.json` headers at all.
- App Check enforcement is per feature and all-or-nothing within a feature group. Never enforce on a subset.

Why: a mistake here is silent locally, passes typecheck, and is either a data-exposure bug or a production outage. `pnpm check` proves nothing about this surface.
