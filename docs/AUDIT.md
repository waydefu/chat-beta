# Repository audit

完整逐項登錄、priority、evidence、root cause、PR 邊界與 baseline 結果位於 repository root 的 [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md)。該檔是這次 enterprise remediation 的 canonical audit；本頁保存文件入口與各 PR closure 狀態，避免兩份 finding registry 漂移。

## 2026-08-14 baseline

- 稽核範圍：`src/`、`functions/`、`tests/`、`public/`、`docs/`、`.github/`、Firebase Rules／indexes／config、package、Vite、TypeScript、ESLint、Vitest、Playwright 與 CI/CD。
- baseline：lint、strict TypeScript、unit、Functions、Rules、signed-out E2E、production build 與 production audit 可執行；測試深度與 signed-in coverage 明顯不足。
- 最大 root causes：backend lifecycle 缺少 durable state/lease/lock、session 與 room ownership 混淆、message live snapshot 覆蓋 historical pages、rendering 以 whole-list replacement、mirror write 非原子、push/offline lifecycle 不完整、單檔 controller/CSS 持續累積。

## Remediation PRs

| PR | Scope | Status |
| --- | --- | --- |
| 1 | RTC + global Presence correctness | implementation branch；待 CI／review／production staging gate |
| 2 | Messages + Push + Offline correctness | pending |
| 3 | Media + Custom Stickers | pending |
| 4 | UI/UX + CSS architecture + dead code | pending |
| 5 | Backup + Retention | pending；production deletion 預設 disabled |

## PR 1 closure evidence

PR 1 已在 code level 解決：pre-media `active`、room concurrent call、participant adoption race、RTC App Check不一致、缺 incoming signal、timer起點錯誤、room-scoped Presence、self online count、room switch offline，以及 LiveKit listener/element cleanup。新 contract使用 V2 Function名稱以維持 additive rollout；觀察期後刪除舊三支。新增 server/client state-machine unit tests、global Presence projection tests、Firestore/RTDB Rules tests與 mobile visual checks。

以下仍明確不是 PR 1 完成項：message pagination/rendering、push token ownership、offline IndexedDB revoke、media/sticker lifecycle、CSS 全面拆分、dead-code checker、backup/retention/restore。不得把本 PR 的綠燈解讀成整份 enterprise remediation 已完成。
