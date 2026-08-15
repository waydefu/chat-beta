---
paths:
  - "src/calls/**"
  - "functions/src/calls/**"
---

# Calls

`docs/RTC.md` is the state machine and the callable table. Read it before changing any transition.

- The single-active-call invariant is `rooms/{roomId}.activeCallId` plus a Firestore transaction, a caller-generated operation ID and a lease. A disabled button, a client query or an optimistic guard is not the invariant and must never become the only one.
- The call belongs to `SessionScope`. Switching rooms must not end it. Every LiveKit listener, media element, track and abort signal is released by session cleanup.
- LiveKit holds media state only. Lifecycle, recovery and authorization stay in Firestore.
- Every replay-sensitive RTC callable uses the same App Check gate, and the client sends limited-use tokens for all of them. Enabling the gate for a subset breaks the group.

## Latency work: measure before you optimize

"The call feels slow" is not a location. Instrument the stages separately before changing anything, and state which stage the number came from:

`button press → UI acknowledgement → call creation callable → token callable → SDK dynamic import → provider connect → local media → remote participant seen → server confirm`

Perceived latency and actual latency have different fixes. The UI must acknowledge the press immediately and show its own phase; it must never wait for the whole chain before rendering. Report the measured stage split with any latency change — a fix with no before/after numbers is not a latency fix.

Why: call bugs are expensive to reproduce and impossible to unit test end to end, so the lock, the ownership and the measurement discipline are what keep them from recurring.
