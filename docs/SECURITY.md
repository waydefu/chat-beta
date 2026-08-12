# Security

## ACL

登入者只能查詢 public room metadata；active member 才能讀 room content。Firestore Rules 每次以 `rooms/{roomId}/members/{auth.uid}.status == active` 授權。`users/{uid}` 只允許本人讀寫必要欄位；訊息與 membership 保存顯示 snapshot，避免全域 user directory。

一般文字保留 offline direct write，但 Rules 鎖定 senderId、senderType、kind、roomId、createdAt 與可變欄位。bot、system、attachments、calls、memberships 與 operation journal 都是 server-only write。

## Firestore → RTDB consistency

加入是安全的 eventual consistency：Firestore transaction 建立 active membership、user index、operation，worker 才建立 mirror；mirror 未完成時 RTDB Rules 拒絕 ephemeral state。

移除是 fail-closed protocol：

```mermaid
sequenceDiagram
  participant API as Membership callable
  participant FS as Firestore
  participant RT as RTDB
  API->>FS: transaction: member + roomState = revoking; journal revoke pending
  Note over FS: Rules 立即拒絕永久資料
  API->>RT: version-guarded atomic transaction deletes mirror/presence/typing/activity
  API->>FS: transaction: delete member/index; journal complete
  API-->>API: 任一步失敗保留 revoking，交給 retry/reconciliation
```

Reconciliation 只在 fresh canonical membership 是 active 且沒有未完成/較新 revoke 時建立 mirror。它也刪除 orphan mirror。版本舊的事件不能恢復較新的撤銷。

## App Check 與 secrets

Web 使用 reCAPTCHA Enterprise。先在 Firebase Console 監測有效/無效比例，再以 Functions 非機密環境變數 `APP_CHECK_ENFORCED_FEATURES` 依 `membership,ai,media,rtc,search,stickers` 分組 enforce；空值代表監測期。replay-sensitive callable 在對應分組 enforce 後同步啟用 limited-use App Check token。Firestore、RTDB、FCM 依 migration runbook 分批收緊。所有 provider credential 使用 Secret Manager，且 presigned URL 視為短效 bearer token。
