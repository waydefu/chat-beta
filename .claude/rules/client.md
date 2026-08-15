---
paths:
  - "src/**"
  - "index.html"
---

# Browser client

Read `src/AGENTS.md` before your first edit in this subtree. Claude Code does not load it automatically, and it owns the layering table, the lifecycle scopes, the rendering contract and the list of coverage-scoped modules.

- The browser is untrusted. A change that needs a privileged read or write becomes a Functions callable — never a wider client write, never a relaxed Rule.
- Firebase SDK calls belong in repositories. A controller or view importing `firebase/*` is the defect, not the shortcut.
- Register every subscription, timer and listener on the scope that owns it. `SessionScope` survives a room switch; `RoomScope` does not. A timer with no owner fires into the next room.
- Put new pure logic in a coverage-scoped module with a test, not inside `chat.controller.ts`.
- Never rebuild the message list. Update the row keyed by `data-message-id`; a full replacement unmounts media and drops scroll position.

Why: these five are the failure modes that produced the lifecycle, timer and rendering debt already registered in `docs/TECH-DEBT.md`. Everything else about this subtree is in `src/AGENTS.md`.
