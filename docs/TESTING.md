# Testing

CI 固定使用 Node 22、pnpm lockfile、Java 21 與 Firebase emulators。unit 測 domain utility、client call state machine 與 Presence projection；Functions 測 membership version、bot routing/idempotency 與 server call lifecycle policy；Rules 測實際 Firestore/RTDB ACL；Playwright 測主要 UI 與 axe。

`tests/rules.test.ts` 覆蓋 anonymous、non-member、active、revoking、sender spoof、bot/system write、自我升權、owner removal、read state、reaction、structured mention、缺 mirror、跨房、撤銷、legacy room multi-tab、global Presence self/cross-user/schema/root-list denial，以及 incoming call recipient ACL。Playwright 目前自動驗證 signed-out landing、鍵盤焦點及 axe serious/critical；RTC mobile surface 另以 320/390/desktop local visual smoke 檢查。登入後多使用者自動化仍是已知 gap，真 LiveKit 必須走受保護 staging gate。

PR 1 baseline：14 個 client unit tests（86.66% scoped coverage）、15 個 Functions tests、16 個 Rules tests全部通過；signed-out Playwright 1/1通過。Production build core signed-in JavaScript是 200.59 kB gzip，低於 210 kB budget，LiveKit仍為 lazy chunk。這些純 policy tests不能取代 LiveKit staging smoke；真實 concurrent transaction、media permission、network reconnect與 browser background行為必須在 emulator/integration或 staging 補證據。

每個 phase 都必須通過 README 列出的完整 gate。Rules、Functions 或 migration 變更不能以「只有三位使用者」為由略過測試。

效能 fixture 需包含 5,000 messages，檢查只訂閱載入訊息的 reactions、切房後 listener 歸零、長列表 memory、initial gzip <200kB，且 AI/Media/RTC/Search chunk 不進首屏。
