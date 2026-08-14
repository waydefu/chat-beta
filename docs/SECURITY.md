# Security

## ACL

登入者只能查詢 public room metadata；active member 才能讀 room content。Firestore Rules 每次以 `rooms/{roomId}/members/{auth.uid}.status == active` 授權。`users/{uid}` 只允許本人讀寫必要欄位；訊息與 membership 保存顯示 snapshot，避免全域 user directory。

一般文字保留 offline direct write，但 Rules 鎖定 senderId、senderType、kind、roomId、createdAt 與可變欄位。bot、system、attachments、calls、memberships 與 operation journal 都是 server-only write。

Call signaling 也是 server-only write。成員只能讀 room calls；`users/{uid}/incomingCalls` 只有本人可讀且 client 完全不可寫。Single-active-call invariant 由 Firestore transaction、room lock 與 lease 維護，不能由 UI button 或 client query 取代。LiveKit JWT TTL 10 分鐘，identity 綁 Firebase UID，publish sources 依 voice/video 類型限制。log 禁止輸出 JWT、LiveKit token、signed URL、secret 或聊天內容。

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

Global Presence 不作為 room ACL。每位 authenticated user 只能寫 `realtime/presence/{ownUid}/connections/{connectionId}`，connection schema 只允許 `online|away` 與 server timestamp 欄位；authenticated client 可讀已知 UID subtree，但不能讀 presence root 建立全域 user directory。Room typing/activity 仍由 membership mirror fail closed。

## App Check 與 secrets

Web 使用 reCAPTCHA Enterprise。先在 Firebase Console 監測有效/無效比例，再以 Functions 非機密環境變數 `APP_CHECK_ENFORCED_FEATURES` 依 `membership,ai,media,rtc,search,stickers` 分組 enforce；空值代表監測期。RTC 的 start/token/confirm/respond/heartbeat/fail/end callables 在 client 一律要求 limited-use token，backend 在 `rtc` enforce 時一律 consume，避免只保護部分 transition。Firestore、RTDB、FCM 依 migration runbook 分批收緊。所有 provider credential 使用 Secret Manager，且 presigned URL 視為短效 bearer token。
