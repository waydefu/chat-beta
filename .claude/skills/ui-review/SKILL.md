---
name: ui-review
description: Repeatable UI and UX review pass for Chat Lite before calling a visual or markup change done. Use when changing style.css, index.html, a controller's DOM, a view, or anything users see.
paths:
  - "src/style.css"
  - "index.html"
  - "src/**/*.controller.ts"
  - "src/**/*.view.ts"
  - "src/calls/call-panel.ts"
  - "src/calls/incoming-call-panel.ts"
---

# UI review

A UI change is not done when it typechecks. It is done when it has been looked at across the axes below, and the ones you did not check are named.

## 1. State the surface

Which elements changed, and which of these own them: the message list, the composer, the drawer, the call panel, the incoming-call sheet, a dialog, the landing view. Renaming or removing an element ID breaks startup — `byId()` throws — so any ID change updates `index.html` and the controller together.

## 2. Walk the matrix

Check the cells your change can reach, and say which ones you skipped.

| Axis | Values |
| --- | --- |
| Width | 320, 390, 1440 |
| Theme | light, dark |
| Input | keyboard only (tab order, visible focus, Escape), touch (target size, no hover-only affordance) |
| Runtime state | empty, loading, error, offline, long content, very long single word, missing avatar or name |
| Chrome | mobile safe area, on-screen keyboard, dialog focus containment, drawer open over content |
| Motion | `prefers-reduced-motion` honoured |

Specific traps in this repository: the call panel is a draggable compact panel on desktop and a safe-area-aware screen on mobile that collapses to a call bar; the incoming-call sheet must contain focus; the message list must not be rebuilt, so verify media and scroll position survive the change.

## 3. Do not regress the structure

- zh-TW strings stay zh-TW; no English leaks into user-facing copy.
- Icons and labels keep their `aria-label`. Nothing becomes an unlabelled glyph.
- `src/style.css` is layered and already carries specificity debt (TD-U2). Add to the layer that owns the surface; do not append a new override block at the end, and do not start the CSS split as a side effect.
- No new static import into the signed-in path without checking the bundle budget.

## 4. Verify

```bash
pnpm typecheck
pnpm lint
pnpm test:e2e   # when markup, focus order or accessibility changed; runs axe
pnpm build      # when imports in the signed-in path changed
```

Where a browser is available, capture the rendered result at 320, 390 and 1440 in both themes rather than describing it.

## Completion evidence

Report: the surfaces touched, the matrix cells checked and how (rendered, reasoned, or skipped), the axe result if markup changed, and the claim level from `/verify-change`. Cells checked by reasoning alone are `MANUAL-VERIFICATION-REQUIRED`, not `VERIFIED`.
