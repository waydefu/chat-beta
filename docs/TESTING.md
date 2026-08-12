# Testing

CI 固定使用 Node 22、pnpm lockfile、Java 21 與 Firebase emulators。unit 測 domain utility；Functions 測 membership version、bot routing/idempotency 等純邏輯；Rules 測實際 Firestore/RTDB ACL；Playwright 測主要 UI 與 axe。

`tests/rules.test.ts` 覆蓋 anonymous、non-member、active、revoking、sender spoof、bot/system write、自我升權、owner removal、read state、reaction、structured mention、缺 mirror、跨房、撤銷與 multi-tab。Playwright 目前自動驗證 signed-out landing、鍵盤焦點及 axe serious/critical；登入後三使用者完整流程仍是受保護 staging gate。staging smoke 才可呼叫 Gemini、R2、LiveKit、Algolia 真實服務。

每個 phase 都必須通過 README 列出的完整 gate。Rules、Functions 或 migration 變更不能以「只有三位使用者」為由略過測試。

效能 fixture 需包含 5,000 messages，檢查只訂閱載入訊息的 reactions、切房後 listener 歸零、長列表 memory、initial gzip <200kB，且 AI/Media/RTC/Search chunk 不進首屏。
