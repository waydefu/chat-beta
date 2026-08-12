# ACL migration runbook

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
