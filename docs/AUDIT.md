# Repository audit

完整逐項登錄、priority、evidence、root cause、PR 邊界與 baseline 結果位於 repository root 的 [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md)。該檔是這次 enterprise remediation 的 canonical audit；本頁保存文件入口與各 PR closure 狀態，避免兩份 finding registry 漂移。

## 2026-08-14 baseline

- 稽核範圍：`src/`、`functions/`、`tests/`、`public/`、`docs/`、`.github/`、Firebase Rules／indexes／config、package、Vite、TypeScript、ESLint、Vitest、Playwright 與 CI/CD。
- baseline：lint、strict TypeScript、unit、Functions、Rules、signed-out E2E、production build 與 production audit 可執行；測試深度與 signed-in coverage 明顯不足。
- 最大 root causes：backend lifecycle 缺少 durable state/lease/lock、session 與 room ownership 混淆、message live snapshot 覆蓋 historical pages、rendering 以 whole-list replacement、mirror write 非原子、push/offline lifecycle 不完整、單檔 controller/CSS 持續累積。

## Remediation PRs

| PR | Scope | Status |
| --- | --- | --- |
| 1 | RTC + global Presence correctness | PR #25 merged；production staging gate仍為人工步驟 |
| 2 | Messages + Push + Offline correctness | implementation branch；待 CI／review／production rollout gate |
| 3 | Media + Custom Stickers | pending |
| 4 | UI/UX + CSS architecture + dead code | pending |
| 5 | Backup + Retention | pending；production deletion 預設 disabled |

## PR 1 closure evidence

PR 1 已在 code level 解決：pre-media `active`、room concurrent call、participant adoption race、RTC App Check不一致、缺 incoming signal、timer起點錯誤、room-scoped Presence、self online count、room switch offline，以及 LiveKit listener/element cleanup。新 contract使用 V2 Function名稱以維持 additive rollout；觀察期後刪除舊三支。新增 server/client state-machine unit tests、global Presence projection tests、Firestore/RTDB Rules tests與 mobile visual checks。

以下仍明確不是 PR 1 完成項：message pagination/rendering、push token ownership、offline IndexedDB revoke、media/sticker lifecycle、CSS 全面拆分、dead-code checker、backup/retention/restore。不得把本 PR 的綠燈解讀成整份 enterprise remediation 已完成。

## PR 2 closure evidence

PR 2 在 code level 解決 live window 覆蓋歷史頁、whole-list message DOM replacement、read mirror sequential write、公開房間無界 query、private room N+1、Push token 跨帳號 ownership、通知文字外洩與 IndexedDB revoke 語意。Push client不再直接寫 token；`claimPushToken`／`releasePushToken`以 transaction維護 `pushTokenClaims/{sha256(token)}`和 user mirror，chat/call sender只讀 canonical claims。離線撤銷在清除前等待 pending writes；其他分頁持有資料庫時維持「待清除」且新版啟動只用 memory cache。

PR 2 新增 message store、offline policy、Push ownership/privacy unit tests，以及 read mirror與 Push Rules tests。尚未完成的項目仍是 PR 3 media/stickers、PR 4 UI/CSS/dead code與 signed-in Axe擴充、PR 5 backup/retention/restore；不得把 PR 2 解讀成整體計畫完成。
