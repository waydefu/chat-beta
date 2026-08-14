# ACL migration runbook

The 2026-08-12 production execution record, backup references, migration totals, and remaining observation gates are recorded in [HANDOFF](HANDOFF.md). This runbook remains the procedure for future migrations and rollback drills.

不可直接把新 Rules 部署到 legacy client。每一步都要保存 command output、操作者、時間、Firebase project ID 與對應備份 reference；`artifacts/` 已被 gitignore，migration report 可能含 UID，不可提交到 Git。

## 0. Preflight

```powershell
pnpm preflight:rollout
node node_modules/firebase-tools/lib/bin/firebase.js login
pnpm preflight:rollout:online
```

線上 preflight 只列出 projects、Functions、Hosting sites、RTDB instances 與 Firestore indexes，不會讀取 Secret Manager 的值。還須人工記錄 billing/budget、各資源 region、App Check metrics、FCM、實際資料量及 Gemini/R2/LiveKit/Algolia 設定。

## 1. 同一時間點備份

先建立 Firestore managed export，再立刻匯出 RTDB；兩者的時間與 reference 要寫入同一份 rollout record。以下 placeholder 不可直接照抄：

```powershell
gcloud firestore export gs://<backup-bucket>/chat-lite/<timestamp>/firestore --project=f-chat-wayde-fu --database='(default)'
New-Item -ItemType Directory -Force artifacts
node node_modules/firebase-tools/lib/bin/firebase.js database:get / --project=f-chat-wayde-fu --instance=f-chat-wayde-fu-default-rtdb --export --output artifacts/rtdb-<timestamp>.json
```

確認 managed export 完成、RTDB JSON 可解析，並把 RTDB 檔案上傳到受存取控制且 retention 足夠的備份位置。正式 migration 前，必須用這一組備份在隔離專案完成一次 restore/rollback 演練。

## 2. Additive backend

從 GitHub Actions 手動執行 `Deploy Firebase production`，選 `additive_backend`。此 phase 只部署 indexes 與 room/membership Functions：operation journal、versioned mirror sync、fail-closed revoke 與 reconciliation；不部署 provider Functions，也不收緊 Rules。

## 3. Audit 與 migration

migration 使用 Admin SDK Application Default Credentials；執行者需有最小必要 Firestore 權限。所有命令都必須明示 project，apply 另外要求 project 二次確認與兩份備份 reference：

```powershell
New-Item -ItemType Directory -Force artifacts
pnpm --filter chat-lite-functions audit:v3 -- --project=f-chat-wayde-fu | Tee-Object artifacts/migration-dry-run.json

pnpm --filter chat-lite-functions migrate:v3 -- `
  --project=f-chat-wayde-fu `
  --confirm-apply=f-chat-wayde-fu `
  --firestore-backup=gs://<backup-bucket>/chat-lite/<timestamp>/firestore `
  --rtdb-backup=gs://<backup-bucket>/chat-lite/<timestamp>/rtdb.json `
  | Tee-Object artifacts/migration-apply.json
```

沒有 `createdBy/ownerId` 的 room 只會標成 quarantined，必須人工指定 owner 後重跑。腳本可重入並保留 legacy fields；不得以移除安全參數的方式繞過 apply gate。

## RTC + global Presence additive migration

這一批不重寫既有 message 或 membership；採 additive-first：

1. 部署 Firestore indexes與新版 V2 Functions，但先不要部署 client／Rules。V2使用 `startLiveKitCallV2`／`getLiveKitTokenV2`／`endLiveKitCallV2`，不覆蓋 production舊三支 contract。
2. 等 index READY；確認 LiveKit secrets 是有效版本，且 `APP_CHECK_ENFORCED_FEATURES` 的 production 值已記錄。
3. 部署 Firestore/RTDB additive Rules：新增 global Presence 與 incoming signal ACL，暫留 legacy room Presence Rules。
4. 在 staging 執行 concurrent start、failed connect rollback、incoming accept/reject、stale cleanup、multi-tab/multi-device Presence 與 App Check smoke。
5. 部署 Hosting client。新版 client 只寫 global Presence，不 dual-write legacy room Presence。
6. 觀察至少七天，確認 legacy room Presence 沒有 supported client 流量、stale call cleanup 沒有異常、incoming signal cleanup有執行。
7. 另開 cleanup PR移除 `realtime/rooms/{roomKey}/presence` 與相應 Rules，並明確刪除舊 `startLiveKitCall`／`getLiveKitToken`／`endLiveKitCall`。不得永久 dual architecture。

**MANUAL PRODUCTION STEP**：production deploy service account 必須有 Eventarc（`syncCallSignals`）、Cloud Scheduler（兩支 cleanup）、Functions/Run、Rules/Database、Secret Manager 所需最小權限。必須先以 `firebase functions:list` 與 WIF workflow dry inventory確認，不可改用個人憑證繞過。

部署順序：indexes → RTC V2 Functions/triggers/schedulers → additive Rules → Hosting。若 Functions 部署失敗，不部署會呼叫 V2 endpoints 的 Hosting。若 Hosting rollout失敗，可直接 rollback Hosting；舊 client仍使用未覆蓋的舊三支 backend，不需要放寬 Rules或回滾 additive資料。

首次啟用前，對現有 `rooms/*/calls` 做 bounded read-only inventory。沒有 lease／room pointer 的舊 active call以 `startedAt + 4 hours`作 migration grace：grace內會阻擋同房 V2 start，避免新舊 client同時建立兩通；過期後由 bounded cleanup或 start fallback terminalize。若同房有 10筆以上 live legacy call，start會 `CALL_INVARIANT_REPAIR_REQUIRED` fail closed，必須人工審核後再啟用。

## 4. 驗證與分階段發布

1. 等待 `syncMembershipMirror`，再觀察至少一次 `reconcileMembershipMirrors`；比較 active membership、user room index、operation journal 與 RTDB mirror。
2. 在 staging 用三個帳號驗證 public metadata、member content、non-member denial、revoking denial，並完成 Gemini/R2/LiveKit/Algolia smoke tests。
3. 在 GitHub production environment 設定 `.env.example` 所列公開 variables，尤其 `VITE_APP_CHECK_SITE_KEY` 與 `VITE_FCM_VAPID_KEY`；設定所有 Functions secrets，但不要把值放進 Git。
4. workflow 選 `feature_backend`，且 `migration_verified=true`、`providers_verified=true`。workflow 只明列部署 3.0 Functions，不會在此階段刪除未知的 legacy Functions。
5. workflow 選 `hosting_client`；相同兩個確認必須為 true，且 Hosting 必需公開 variables 不可為空。
6. 驗證新版 client 後，workflow 選 `restrictive_rules`。App Check 仍先 monitor，依 metrics 逐功能 enforce。
7. 監測 24 小時；七天後才依 production Functions inventory 明確刪除 legacy Functions、移除 legacy fields/path 與 compatibility branch，最後將 GitHub Pages 切成 Hosting 導向頁。`full_post_migration` 同樣不會自動刪除未明列的舊 Function。

## Rollback

Rollback 不是反向執行 migration script：先停止 client rollout/Functions trigger，將 Rules 回復到 migration-compatible 版本，再從相同時間點的 managed Firestore export 與 RTDB export 復原。復原後先停用 reconciliation，避免它以混合時間點資料重建 mirror。若只發生 Hosting 問題，可先回滾 Hosting release；若 membership 資料已改變，必須使用已演練的成對備份，不可拼接不同時間點資料。
