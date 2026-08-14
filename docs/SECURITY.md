# Security

## ACL

登入者只能查詢 public room metadata；active member 才能讀 room content。Firestore Rules 每次以 `rooms/{roomId}/members/{auth.uid}.status == active` 授權。`users/{uid}` 只允許本人讀寫必要欄位；訊息與 membership 保存顯示 snapshot，避免全域 user directory。

一般文字保留 offline direct write，但 Rules 鎖定 senderId、senderType、kind、roomId、createdAt 與可變欄位。bot、system、attachments、calls、memberships 與 operation journal 都是 server-only write。

FCM token ownership同樣是server-only invariant。`claimPushToken` transaction會把相同token從舊UID移除後再指派新UID；release在canonical owner一致時才刪claim。client只可讀自己的mirror，不能寫mirror或讀global claims。sender不再信任legacy user token文件，stale FCM response與90日未refresh claim都由bounded cleanup同時刪canonical claim和mirror。chat push只包含訊息種類的通用文字，不包含聊天本文；foreground正在看的room不顯示重複toast，call payload維持獨立type/lifecycle。

「可信裝置離線資料」是明確opt-in。關閉時先等待pending writes同步，再terminate本分頁Firestore並清IndexedDB；離線或其他分頁仍持有資料庫時fail closed，不顯示已清除。pending revoke啟動時只使用memory cache。登出不會默默刪除使用者明確保留的trusted-device cache；需要清除時必須先關閉此設定，UI會揭露這個行為。

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

Web 使用 reCAPTCHA Enterprise。先在 Firebase Console 監測有效/無效比例，再以 Functions 非機密環境變數 `APP_CHECK_ENFORCED_FEATURES` 依 `membership,ai,media,notifications,rtc,search,stickers` 分組 enforce；空值代表監測期。RTC與Push ownership callables在client一律要求limited-use token，backend在對應feature enforce時consume。Firestore、RTDB、FCM 依 migration runbook 分批收緊。所有 provider credential 使用 Secret Manager，且 presigned URL 視為短效 bearer token。

## AI 與 Google Search Grounding 隱私

提及 @Gemini 時，僅送出目前房間必要的上下文與使用者問題。若模型判定需要即時公開資訊而使用 Google Search grounding，搜尋查詢由 Google 端原生處理；伺服器端僅正規化並儲存驗證後的來源網址與標題（上限 5 筆），且 Cloud Logging 僅記錄 `groundingUsed` 與來源數量，嚴禁記錄使用者搜尋 query、造訪網址、頁面標題或對話全文。
