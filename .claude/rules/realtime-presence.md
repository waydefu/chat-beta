---
paths:
  - "src/realtime/**"
  - "functions/src/presence/**"
  - "database.rules.json"
---

# Presence, typing and activity

Three different questions get confused here. Keep them apart.

| Question | Answer lives in | Scope |
| --- | --- | --- |
| Is this user signed in somewhere? | `realtime/presence/{uid}/connections` | global, per authenticated session |
| May this user be in this room? | Firestore `rooms/{roomId}/members/{uid}.status` | canonical authorization |
| Who is online *in this room*? | active room membership ∩ global presence | derived, never stored |

- Global presence is a property of an authenticated session, not of room membership. Losing access to one room must not mark a user offline everywhere — they may be signed in and active in another room, and the client owns that write anyway, so a server-side delete would be both wrong and ineffective.
- Room online users are computed by intersection (`onlineRoomMembers` in `src/realtime/presence-state.ts`). Never derive room presence from the global node alone, and never derive membership from RTDB.
- Liveness is a timestamp judgement, not the existence of a node. A connection that stopped heartbeating stops emitting events, so the reader has to sweep on a timer or it holds a dead user online forever.
- Whoever writes a node owns whether it still exists, not just the transition that created it. A partial `update` is validated against the *merged* result, so it is denied outright when the node has gone — and the node can go with no transition this tab observes: the server runs `onDisconnect` as soon as it stops seeing the socket, and the scheduled sweeper reaps connections whose writes were throttled in a background tab. A write path that only re-establishes on a socket event will beat against a node nothing restores, and the user disappears from presence for the rest of the session while the header still reads connected. Repair on write failure, not on reconnect alone.
- The staleness constants exist twice on purpose — `src/realtime/presence-state.ts` and `functions/src/presence/presence-policy.ts` share no code. Change both in the same commit or presence flickers.
- Typing and activity are room-scoped and membership-gated; presence is not. Do not merge their lifetimes.

Why: every presence bug this repository has shipped came from collapsing two of these three questions into one. Anything that proposes deleting a global presence node in response to a room-level event contradicts the executable architecture and `docs/SECURITY.md` — report it as a `DOCUMENT-CONFLICT` instead of implementing it.
