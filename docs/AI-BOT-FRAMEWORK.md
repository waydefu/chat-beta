# AI bot framework

只有 structured mention `{type:"bot", id:"gemini", start, end}` 會觸發 bot。這是 server 端的判準，但 client 會從輸入文字產生該結構：`src/messages/message.service.ts` 比對 `@Gemini` 並帶 token boundary 檢查，所以**手打 `@Gemini` 一樣會觸發**；不含 `@` 的「Gemini」與 `@GeminiTest` 這類延伸字串則不會。request ID 固定為 `sourceMessageId_botId`，`aiRequests` 保存 lease、attempt、status、usage、latency、model、finalMessageId 與 failure category。

```text
@Gemini message → callable stream → provider
                    ├─ triggerer: sendChunk
                    ├─ room: optional RTDB aiDraft (1s/256 chars)
                    └─ completion: one Firestore transaction for final message + ledger
```

Firestore 不保存 token chunk 或 draft。取消/斷線透過 client AbortSignal 與 server response.signal 中止 provider，移除 RTDB draft，而且不建立 final message。deterministic final message ID 與 transaction 讓 retry idempotent；過期 lease 可重取。一般 context 20 則；reply 額外保留目標與附近訊息；larger/day 類請求最多 200 則。送出前使用 provider `countTokens` 逐步裁掉最舊 context，硬性限制在 24k input tokens。私人完整 prompt 不寫入 ledger/log。

### Google Search Grounding

Gemini 3.6 Flash 原生支援 Google Search grounding（`tools: [{ googleSearch: {} }]`），由模型依問題性質（即時資訊、天氣、時事新聞、價格、版本狀態等）自主判斷是否需要搜尋。

- **Grounding metadata 正規化**：由純函式 `mergeGroundingSources` 在串流 chunk 中收集去重，驗證 URL（限 http/https）、裁剪 title（最多 120 字元）並限制最多 5 個來源。
- **儲存與 Client 契約**：僅在確定使用搜尋且有有效來源時，將 normalized `grounding: { usedSearch: true, sources: [...] }` 寫入最終訊息的 `metadata`。
- **隱私邊界**：Google Search query 不寫入 Cloud Logging 或 Firestore；日誌僅記錄 `groundingUsed: boolean` 與 `groundingSourceCount: number`。

上線前須在 Remote Config 設定並驗證 `gemini_model` stable model、Secret Manager 的 `GEMINI_API_KEY`，並在 staging 測 cancellation、usage metadata、quota 與 provider error。
