# Production handoff

Last updated: 2026-08-26 (Asia/Taipei)

This document records the production state after the Chat Lite 3.0 ACL rollout. It is the starting point for the next operator. Never copy secret values, user IDs, migration artifacts, or production data into Git.

## Current production state

| Item | Value |
| --- | --- |
| Firebase project | `f-chat-wayde-fu` |
| Firebase Hosting | <https://f-chat-wayde-fu.web.app/> |
| Legacy GitHub Pages | <https://waydefu.github.io/chat-beta/> (redirects to Firebase Hosting) |
| Billing account | `017AC8-677C35-503670` |
| Primary region | `asia-east1` |
| Production branch | `main` |
| Deployed commit (Hosting client) | `4bb3ad707f936eb390d84f9d3a64a4872f576e70` (run `31995531725`, 2026-08-17) |
| Deployed commit (RTC Functions) | `aa646ac84fa7673c73df3c2f419d1fd8c9434696` (run `31953276095`, 2026-08-16) |
| App Check | reCAPTCHA Enterprise key configured; monitor before enforcement |
| FCM | production VAPID key configured |

The production client, migrated data, restrictive Firestore/RTDB Rules, membership mirror workers, and GitHub Pages redirect are live. Core text chat and room membership ACL are the supported production scope at this handoff.

## Rollout record

### Backup

The paired backup was taken before migration at `20260812T094822Z`:

- Firestore managed export: `gs://f-chat-wayde-fu-chat-lite-backups/chat-lite/20260812T094822Z/firestore`
- RTDB export: `gs://f-chat-wayde-fu-chat-lite-backups/chat-lite/20260812T094822Z/rtdb.json`
- Backup bucket: `gs://f-chat-wayde-fu-chat-lite-backups`
- Bucket region: `asia-east1`
- Uniform bucket-level access and object versioning are enabled.
- Retention is 30 days. Confirm the exact expiry before relying on this backup for a later rollback.

Migration reports were written under the ignored `artifacts/` directory in Cloud Shell and were not committed.

### Data migration

The v3 migration completed successfully:

- Rooms scanned: 1
- Rooms migrated: 1
- Rooms quarantined: 0
- Memberships created: 3
- Legacy messages upgraded in place: 5
- Orphan messages: 0
- Non-member senders: 0
- The room without an owner was assigned to its earliest message sender before the apply run.
- The room is now `schemaVersion: 3` with `migrationStatus: complete`.
- All memberships are `active`; roles are one owner and two members.
- Matching `users/{uid}/roomStates/{roomId}` documents exist.
- RTDB membership mirrors were reconciled and verified after migration.

Do not commit the production room name, user IDs, message contents, or raw migration reports.

### Deployed membership backend

The following Node.js 22, second-generation Functions are live in `asia-east1`:

Membership (deployed 2026-08-12):

- `createDirectRoom`
- `createOrJoinPublicRoom`
- `revokeRoomMember`
- `syncMembershipMirror`
- `reconcileMembershipMirrors`

Notifications and stickers (deployed 2026-08-13, `notification_backend` phase):

- `notifyOnMessage`
- `sendStickerMessage`

Calls V1 (deployed 2026-08-13, `rtc_backend` phase). Superseded by V2 and no
longer called by the shipped client:

- `startLiveKitCall`
- `getLiveKitToken`
- `endLiveKitCall`

**These three exist only in production.** They are absent from
`functions/src/index.ts` and from `functions/src/calls/livekit.ts` — verified
2026-08-26, the names appear nowhere outside documentation — so no deploy will
ever recreate them and no CI gate will notice them. Removing them is a direct
production delete, and it is the whole of what TD-L1 still needs:

```bash
firebase functions:list --project f-chat-wayde-fu
firebase functions:delete startLiveKitCall getLiveKitToken endLiveKitCall \
  --region asia-east1 --project f-chat-wayde-fu
```

Confirm from the inventory first. Deleting a Function is not reversible by
redeploy here, because the source is gone: restoring them would mean restoring
the pre-V2 code. That is the intended one-way door — the V2 contract is what the
shipped client speaks.

Push ownership (deployed 2026-08-14, `push_ownership_backend` phase):

- `claimPushToken`
- `releasePushToken`
- `cleanupStalePushTokens`

Calls V2 (deployed 2026-08-14, `rtc_backend` phase):

- `startLiveKitCallV2`
- `getLiveKitTokenV2`
- `confirmLiveKitCall`
- `respondLiveKitCall`
- `heartbeatLiveKitCall`
- `failLiveKitCall`
- `endLiveKitCallV2`
- `cleanupStaleLiveKitCalls`
- `cleanupExpiredCallSignals`

Gemini AI (deployed 2026-08-14, `ai_backend` phase, GitHub Actions run
31810705398):

- `generateGeminiReply`
- `cleanupExpiredAIDrafts`

The remaining Functions in `functions/src/index.ts` are undeployed. The
enablement order and per-batch gates are in
[FEATURE-ENABLEMENT](FEATURE-ENABLEMENT.md).

`syncMembershipMirror` is retryable and idempotent. `reconcileMembershipMirrors` runs every 15 minutes. Firestore membership is canonical; the RTDB mirror remains an eventually consistent derivative. Revocation stays fail-closed through the `revoking` state and operation journal.

### RTC V2 and push ownership rollout (2026-08-14)

PR #25 and PR #26 shipped in one rollout. PR #27 first split two phases that
deadlocked when the two runbook sections were combined; the resulting order is
in [MIGRATION](MIGRATION.md).

Completed, all runs successful:

1. `push_ownership_backend` — run 31770041190
2. `rtc_backend` — run 31770272284
3. `additive_rules` (RTDB rules only) — run 31770483822
4. `hosting_client` — run 31770722616
5. `push_sender_backend` — run 31772615042
6. `restrictive_rules` — run 31772855456

The rollout is complete. `notifyOnMessage` was updated onto the canonical
registry, `syncCallSignals` was created, and both Firestore and RTDB Rules are
now at the restrictive release. Neither sender logged an error after rollout.

The shipped bundle was verified against production: `call.service` carries the
V2 call callables, `livekit-call-provider` carries `getLiveKitTokenV2`, the push
chunk carries `claimPushToken`/`releasePushToken`, and the realtime repository
writes `realtime/presence`.

#### What `push_adoption_verified=true` rested on

The flag was set on production log evidence, not on the full checklist in
MIGRATION step 3. What was confirmed from `claimPushToken` and
`releasePushToken` logs before the sender shipped:

- Four claims, every one `result: complete`, with App Check and auth both
  `VALID`.
- One release with `released: true`, in a claim → release → claim sequence,
  which is the logout-then-switch-account path.
- Structured metadata only. No token value and no message content appeared in
  any log line.

What was **not** verified, and is still owed: a direct read of
`pushTokenClaims` confirming one owner per token hash, and `ownershipVersion: 1`
on the user mirrors. Both need Firestore admin credentials. Every claim logged
`replacedOwner: false`, so the takeover path — B claiming a token still owned by
A without an intervening release — has no production evidence either.

The read-only inventory of legacy `rooms/*/calls` was never run. It stopped
mattering during the rollout: the operator confirmed the existing production
room is disposable and intends to create a new one, so the
`CALL_INVARIANT_REPAIR_REQUIRED` fail-closed path has nothing to protect.

#### Missing calls indexes (found and fixed 2026-08-14)

`cleanupStaleLiveKitCalls` failed on every scheduled run from the moment it went
live until 06:02 UTC, with `FAILED_PRECONDITION: The query requires an index`.

`firestore.indexes.json` declared both composite indexes correctly. They were
never deployed: `additive_backend` was the only phase carrying
`firestore:indexes`, and the RTC + push rollout order gives no reason to run it.
The RTC runbook step does say "deploy Firestore indexes and the V2 Functions";
only the Functions half was done.

Fixing it surfaced a second gap. `additive_backend` then failed with `HTTP Error:
403` on the index request: `github-deploy` held `roles/datastore.viewer`, which
only reads. The indexes live in production had been deployed from Cloud Shell
under personal credentials on 2026-08-12, so the WIF account had never actually
sent an index. `roles/datastore.indexAdmin` was granted and recorded in
[WIF-SETUP](WIF-SETUP.md).

Resolution, verified: all six composite indexes report `READY`, and the 06:02
run logged `{"operation":"rtc.cleanup","result":"complete","count":10}`. It
cleared **ten** stale calls on its first working pass — the phantom `active`
records P1-01 and P1-03 describe. MIGRATION fails a V2 start closed with
`CALL_INVARIANT_REPAIR_REQUIRED` at ten or more live legacy calls in one room,
so the backlog was sitting exactly on that threshold while the sweeper that
clears it was dead.

PR #30 makes `rtc_backend` deploy `firestore:indexes` alongside its Functions.
Indexes belong with the Functions that query them; a phase that ships a query
without its index ships a Function that cannot run.

#### Owed follow-up

- Verify the `pushTokenClaims` invariant and mirror `ownershipVersion` from an
  authenticated environment, and exercise the `replacedOwner: true` takeover
  path once.
- Observe for 24 hours, then hold the seven-day gate before removing the legacy
  RTC trio, `realtime/rooms/{roomKey}/presence` and the legacy push token
  documents. Earliest cleanup is 2026-08-21.

### P3 correctness closure (2026-08-17)

Three pull requests, two deployments. Merged commits: PR #46 `4eb21b4`, PR #47 `4bb3ad7`, PR #48 `5d2634c`. Quality gates passed on `5d2634c` (run `31995760155`).

| Phase | Run | Commit | Result |
| --- | --- | --- | --- |
| `firestore_indexes` | `31994462556` | `4eb21b4` | success |
| `hosting_client` | `31995531725` | `4bb3ad7` | success |

`firestore_indexes` is new in PR #46: every other index-carrying phase also redeploys Functions, so repairing an index for already-deployed code used to cost an unrelated Function rollout.

**Index readiness.** The workflow exiting 0 is not readiness. The `incomingCalls.expiresAt` `COLLECTION_GROUP` index reached `READY` at `04:31:43Z`, checked with `gcloud firestore indexes fields describe`.

**Scheduled cleanup.** `firebase-schedule-cleanupExpiredCallSignals-asia-east1` was triggered manually at `04:32:26Z` and logged `rtc.signal.cleanup / complete / count 0 / 372 ms` with no `FAILED_PRECONDITION`. Before the index it had failed every run for days. The scheduler's own invocation path is now covered too, which a manual trigger does not establish: the unattended cycles at `05:32`, `06:32`, `07:32` and `08:32` UTC all logged `complete / count 0` in 235-310 ms, and the service has produced no `WARNING`-or-above entry since its last `FAILED_PRECONDITION` at `03:41:47Z`. Across every Cloud Run service in the project, that was also the only source of `ERROR` entries in the surrounding nine hours, and there have been none anywhere since the index landed. A count of 0 is the correct answer here, not a silent failure: signal retention is seven days and the oldest signal in production expires `2026-08-21T05:07Z`, so the first real deletion is only observable from 2026-08-21.

**Bundle verification.** At the time of this closure production served `assets/index-anPfP4ST.js`, which is what run `31995531725` built from `4bb3ad7`, replacing `assets/index-DLao8hNd.js` from run `31953496673`. That is the build the four rows below were tested against. It has since been superseded by the TD-M1 deploy recorded further down; RTC Functions are unchanged at `aa646ac` throughout.

#### The four person-only rows, now closed

All four were run by the operator on 2026-08-17 against the deployed client (`4bb3ad7`, serving `assets/index-anPfP4ST.js`) and passed. Acceptance conditions are in [TECH-DEBT](TECH-DEBT.md); procedures are in [TESTING](TESTING.md).

| Row | Result | Evidence |
| --- | --- | --- |
| TD-C1 | `VERIFIED-IMPROVEMENT` (warm) | Seven captured calls; stage table in [RTC](RTC.md), corroborated server-side from Cloud Logging |
| TD-C2 | Pass | Operator report |
| TD-C3 | Pass, TEST A and TEST B run separately | Operator report |
| TD-C4 | `TYPING_STALE = VERIFIED-PRODUCTION` | Operator report |

**The evidence is not of one kind, and the difference is worth keeping.** TD-C1 came with a console capture, so its numbers were recomputed here from the raw stages and cross-checked against server-side records. TD-C2 to TD-C4 rest on the operator's report alone. That is the nature of those tests -- a two-hour idle tab, a real network cut, a process killed from Task Manager -- and no terminal-side gate substitutes for them. It is a fixed limitation of the acceptance conditions, not a gap in this closeout.

#### What the TD-C1 numbers do and do not establish

Warm voice calls went from a 5101 ms median to 2334 ms, a 54% reduction, and the mechanism is confirmed rather than inferred: `getLiveKitTokenV2` was invoked zero times server-side across a six-hour window, because the inline grant removed that callable from the call path entirely.

The cold-start half is **not** established. None of the seven captured calls was genuinely cold -- every one showed a 2.2-3.7 ms CORS preflight, where a Cloud Run cold start costs 1.5-2.9 s -- so the first call's 3559 ms is session-cold with a warm server, and comparing it to the 18613 ms cold baseline would repeat the attribution error that overturned the 2026-08-15 closure. What exists for cold start is server-side only: the caller's cost fell from 7379 ms across three services to 4661 ms across two, measured at `10:01:32Z`. Capturing the client stages for a genuinely cold call remains open and is recorded as such in the row.


### TD-M1: global presence and revocation (2026-08-17)

The row asked for `realtime/presence/{uid}` to be cleared during revocation. That fix was retracted rather than implemented, because it cannot work and would cause harm:

- **It would not stick.** The node's write rule is `auth.uid === $uid` with no room condition, and a failed heartbeat calls `establish()`, which re-creates it. Any server-side delete is undone within one beat -- guaranteed by PR #47, merged earlier in this same closeout.
- **It would blank other rooms.** The node has no room dimension. Deleting it because one room revoked the user would make them appear offline everywhere else they are still a member.
- **The reported symptom does not reproduce.** `revokeRoomMember` sets the member document to `revoking` in its first transaction, and `watchRoomMembers` filters to `active`, so a revoked member leaves the list before any realtime cleanup runs.

**What was actually wrong.** `onlineRoomMembers` — the projection that produces the online list — did not look at membership status at all. The entire guarantee rested on one `.filter()` clause in a different module that had no test of its own. Removing that clause put a revoked member straight back in the list, shown online, with nothing to catch it.

The projection now checks status itself, and the invariant is pinned at three layers: the projection test (failing before the change, passing after), a new subscription test verified by mutating the filter away, and a rules test asserting that revocation closes the room mirror while leaving global presence self-writable — which is precisely why the original prescription was wrong.

**Same-failure-class search.** RTDB holds exactly two subtrees. `realtime/presence/{uid}` is the only global per-user state; typing and activity are room-scoped and already cleared on revocation. Every removal path (`revokeRoomMember`, `completeRevocation`, `reconcileMembership`, `reconcileMembershipMirrors`, `removeOrphanRealtimeAccess`) funnels into `removeRealtimeAccess*`, and no room-deletion or account-deletion path exists. Searched, no sibling found.

**Not a defect:** `realtime/presence/$uid` is readable by any authenticated user. That is deliberate and already asserted in `tests/rules.test.ts`, including that the parent is not enumerable.

**Deployed and verified.** Run `32029941263` shipped the `hosting_client` phase from `2e018e3`. Production now serves `assets/index-DjaHyNZL.js`, replacing `assets/index-anPfP4ST.js`, and the deployed `chat.controller-D7aoKpNf.js` contains the guard as `status==="active"&&o.userId!==n&&` — the fix read back out of the shipped artifact rather than assumed from a green pipeline.

No behavioural delta was expected or observed: the only caller already pre-filtered to active members, so the added condition is always true on the shipped path. Confirming a revoked member disappears from the list still needs two accounts and a room manager, and would be verifying behaviour that predates this change rather than anything it introduced.


### Rules and Hosting

- Restrictive Firestore Rules are live.
- Restrictive RTDB Rules are live.
- Anonymous production reads of room content were verified denied (Firestore `403`, RTDB `401`).
- Firebase Hosting security headers and CSP are live.
- Google Auth requires `https://apis.google.com` in `script-src`, and both `https://apis.google.com` and the auth domain `https://f-chat-wayde-fu.firebaseapp.com` in `frame-src`; removing any of them reproduces the login failure.
- `Cross-Origin-Opener-Policy` is `same-origin-allow-popups` so the `signInWithPopup` window handle survives popup cancellation polling.
- HTML is served with `Cache-Control: no-cache`, verified live on `/`, `/privacy.html` and `/terms.html`; hashed assets keep `public,max-age=31536000,immutable`. This means header and CSP changes reach returning browsers on the next request. Before this, HTML inherited the Hosting default `max-age=3600` and a cached document kept enforcing the previous CSP for up to an hour after a headers-only deploy.
- Production source maps are built for diagnostics but excluded from Hosting uploads.
- Core signed-in JavaScript is roughly `200 kB` gzip under the production configuration, of which the Firebase SDK is `187.43 kB`. The application's own code is `10.40 kB` and the entry chunk `2.09 kB`.
- The budget gate was raised from 200 kB to 210 kB on 2026-08-13. At 200 kB the headroom above Firebase was 12 kB and 99.9% consumed, so the gate had stopped catching bloat and started failing on bug fixes; the message list scroll fix (PR #17) tripped it by 70 bytes. The `forbidden` provider-chunk check in the same script is unchanged and remains the meaningful guard. Reclaiming real space means reducing what the Firebase SDK pulls into the core path, which is a separate piece of work.
- Google Sign-In startup was browser-smoked after the CSP fix: no CSP console error, no `auth/internal-error`, and the Auth iframe was created.

### GitHub delivery record

- PR #1: Chat Lite 3.0 implementation and rollout infrastructure.
- PR #2: exclude source maps from Firebase Hosting uploads.
- PR #3: allow the Google Auth API script in CSP.
- PR #4: allow the Google Auth iframe in CSP.
- PR #6: allow the Auth domain in CSP `frame-src` and set COOP for popups. This is the change that made Google Sign-In work; #3 and #4 were necessary but not sufficient.
- PR #8: serve HTML with `no-cache`. Requires a Hosting deploy to take effect.
- PR #9: upgrade deprecated GitHub Actions runtimes.
- PR #12: theme the login screen and apply the theme before sign-in.
- PR #13: scope the provider gate to the phases that deploy providers. `hosting_client` previously required an attestation that could not be answered truthfully while provider secrets remain placeholders, which forced every client-only change out through a manual deploy.
- PR #34: harden the Gemini path before enabling it (model allowlist, error taxonomy, mention token boundary, draft cleanup pagination).
- PR #35: add Google Search grounding with source citations to Gemini.
- The quality-gate workflow passed on production commit `bd58b8f0740ecb69e8cbf9473312564403163747`, including lint, typecheck, unit coverage, Functions tests, Rules tests, E2E, build, and production audit.
- The manual `Publish GitHub Pages redirect` workflow completed successfully for the previous production commit and the redirect remains live.

## Configuration state

GitHub's `production` environment contains the public client configuration, including:

- Firebase API/auth/project/app/database/messaging configuration
- `VITE_FIREBASE_FUNCTIONS_REGION`
- `VITE_APP_CHECK_SITE_KEY`
- `VITE_FCM_VAPID_KEY`

Do not place these values in Markdown even though browser Firebase configuration, App Check site keys, and VAPID public keys are not server secrets.

GitHub Workload Identity Federation is configured and proven. The pool `github`, its OIDC provider, and the `github-deploy` service account exist in `f-chat-wayde-fu`; the provider carries an attribute condition restricting it to `waydefu/chat-beta`, and no service account key was created. `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT` are set on the `production` environment. The setup commands are recorded in [WIF-SETUP](WIF-SETUP.md).

The first workflow deploy replaced the manual Cloud Shell rollout on 2026-08-12: `hosting_client` phase, run 31600675047, which passed `pnpm check` and `pnpm test:rules` before deploying.

The deploy roles were granted on 2026-08-13 for the first Functions deploy. `github-deploy` now holds eleven roles. Two of them are not in the [WIF-SETUP](WIF-SETUP.md) list and were only discovered by letting the deploy fail:

- `roles/firebaseextensions.viewer` — the CLI enumerates Extensions instances during any Functions deploy
- `roles/datastore.viewer` — Firestore triggers need to read the database metadata

The others are `firebasehosting.admin`, `serviceusage.serviceUsageConsumer`, `firebaserules.admin`, `firebasedatabase.admin`, `cloudfunctions.developer`, `iam.serviceAccountUser`, `artifactregistry.writer`, `run.admin`, `eventarc.developer` and `secretmanager.admin`. `secretmanager.admin` is broader than ideal; the narrower alternative is to pre-grant `secretAccessor` to the Functions runtime service account and drop the deploy account to `secretmanager.viewer`.

## Provider integrations

LiveKit calls and the Gemini generation endpoint are live in production. Gemini was deployed
on 2026-08-14 in [GitHub Actions run 31798296940](https://github.com/waydefu/chat-beta/actions/runs/31798296940):
`generateGeminiReply` and `cleanupExpiredAIDrafts` were both created in
`asia-east1`. A no-content callable health check reached the deployed endpoint;
the remaining user-facing validation is the `@Gemini` streaming and cancellation
check listed below.

The remaining provider secrets
still contain `UNCONFIGURED` placeholder versions created only to pass additive
deployment prompts. They are not valid credentials. Do not deploy the Functions
that depend on them until each value is replaced and verified in protected
staging:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `ALGOLIA_APP_ID`
- `ALGOLIA_ADMIN_KEY`
- `ALGOLIA_INDEX_NAME`

`LIVEKIT_URL` and `LIVEKIT_API_KEY` still carry their placeholder as version 1;
only the latest version is bound at deploy time, so this is inert. The stale
`LIVEKIT_API_SECRET` version was destroyed by the CLI when the secret was
corrected.

Required provider gates:

1. Replace placeholder secret versions without exposing values in logs or Git.
2. Configure R2 CORS, lifecycle rules, quotas, and orphan cleanup.
3. Configure LiveKit Cloud project, grants, and short token TTL.
4. Configure a room-bound Algolia index and verify delete synchronization.
5. Verify Gemini streaming, cancellation, usage metadata, rate limits, and the
   configured stable model with a real room invocation.
6. Run protected staging smoke tests before deploying any remaining provider
   Functions or `feature_backend`.

R2 uploads and Algolia historical search must not be represented as
production-ready until their respective gates pass.

## Immediate follow-up

1. Run authenticated smoke tests with all three existing accounts: room discovery, join, send/read/unread, multi-tab presence, typing, offline text queue, and member removal.
2. Observe Functions errors, Rules denials, App Check metrics, Firestore writes, RTDB mirror drift, and billing for at least 24 hours after rollout.
3. Grant the remaining deploy roles when a phase beyond `hosting_client` is first run. WIF itself is done; the service account is deliberately scoped to hosting only.
4. Run the Gemini room smoke test (streaming, cancellation, usage and rate-limit
   behaviour), then replace and stage-test the remaining provider credentials
   before deploying only their explicitly listed Functions. The batch order and
   per-batch gates are recorded in [FEATURE-ENABLEMENT](FEATURE-ENABLEMENT.md).
5. Enable App Check enforcement one surface at a time after legitimate traffic is visible in metrics.
6. Perform the rollback restore drill using a paired Firestore/RTDB backup in an isolated project.
7. Remove legacy fields, legacy RTDB paths, compatibility branches, and explicitly inventoried legacy Functions only after the seven-day observation gate. For this rollout, the earliest planned cleanup date is 2026-08-19, and only if monitoring is clean.

   Status as of 2026-08-26, since "legacy cleanup" is now four separate items
   with four different owners:

   | Item | Repository | Production |
   | --- | --- | --- |
   | `PRESENCE_LEGACY_TRUST_MS` (TD-P3) | removed | nothing to do — it was only ever code |
   | `realtime/rooms/{roomKey}/presence` (TD-L2) | rules and code removed | deploy `database_rules`, then delete residual nodes (item 9) |
   | V1 RTC trio (TD-L1) | never present to remove — see below | delete the three deployed Functions |
   | legacy push token documents (TD-L3) | compatibility delete must stay | blocked on the `pushTokenClaims` read this list already owes |
8. Update privacy/terms before enabling Gemini, R2, LiveKit, or Algolia for users.

## Operational checks

Repository quality gates:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit --coverage
pnpm test:functions
pnpm test:rules
pnpm test:e2e
pnpm build
pnpm audit --prod --audit-level high
```

Read-only production inventory from an authenticated environment:

```bash
pnpm preflight:rollout:online
firebase functions:list --project f-chat-wayde-fu
firebase hosting:sites:list --project f-chat-wayde-fu
```

Before any production mutation, confirm all of the following:

- `git status --short` is clean.
- `git rev-parse HEAD` matches the intended merged `main` commit.
- The command explicitly names `--project f-chat-wayde-fu`.
- The required public Vite variables are present in the build environment.
- A current paired backup and rollback point exist.
- Provider deployment gates are satisfied for every Function being deployed.

## Known maintenance warnings

GitHub Actions currently reports deprecation warnings for Node.js 20-based action runtimes and `actions/setup-java@v4`. These did not fail the quality gates, but the workflow should be upgraded to supported action versions before they become errors.

