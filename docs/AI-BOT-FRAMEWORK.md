# AI bot framework

只有 structured mention `{type:"bot", id:"gemini", start, end}` 會觸發 bot；純文字比對不會觸發。request ID 固定為 `sourceMessageId_botId`，`aiRequests` 保存 lease、attempt、status、usage、latency、model、finalMessageId 與 failure category。

```text
@Gemini message → callable stream → provider
                    ├─ triggerer: sendChunk
                    ├─ room: optional RTDB aiDraft (1s/256 chars)
                    └─ completion: one Firestore transaction for final message + ledger
```

Firestore 不保存 token chunk 或 draft。取消/斷線透過 client AbortSignal 與 server response.signal 中止 provider，移除 RTDB draft，而且不建立 final message。deterministic final message ID 與 transaction 讓 retry idempotent；過期 lease 可重取。一般 context 20 則；reply 額外保留目標與附近訊息；larger/day 類請求最多 200 則。送出前使用 provider `countTokens` 逐步裁掉最舊 context，硬性限制在 24k input tokens。私人完整 prompt 不寫入 ledger/log。

上線前須在 Remote Config 設定並驗證 `gemini_model` stable model、Secret Manager 的 `GEMINI_API_KEY`，並在 staging 測 cancellation、usage metadata、quota 與 provider error。
