# Testing

CI 固定使用 Node 22、pnpm lockfile、Java 21 與 Firebase emulators。unit 測 domain utility、client call state machine 與 Presence projection；Functions 測 membership version、bot routing/idempotency 與 server call lifecycle policy；Rules 測實際 Firestore/RTDB ACL；Playwright 測主要 UI 與 axe。

`tests/rules.test.ts` 覆蓋 anonymous、non-member、active、revoking、sender spoof、bot/system write、自我升權、owner removal、原子read mirrors、reaction、structured mention、缺 mirror、跨房、撤銷、legacy room multi-tab、global Presence self/cross-user/schema/root-list denial、incoming call recipient ACL，以及Push canonical claim/client mirror denial。Playwright 目前自動驗證 signed-out landing、鍵盤焦點及 axe serious/critical；RTC mobile surface 另以 320/390/desktop local visual smoke 檢查。登入後多使用者自動化仍是已知 gap，真 LiveKit 必須走受保護 staging gate。

PR 1 baseline：14 個 client unit tests（86.66% scoped coverage）、15 個 Functions tests、16 個 Rules tests全部通過；signed-out Playwright 1/1通過。Production build core signed-in JavaScript是 200.59 kB gzip，低於 210 kB budget，LiveKit仍為 lazy chunk。這些純 policy tests不能取代 LiveKit staging smoke；真實 concurrent transaction、media permission、network reconnect與 browser background行為必須在 emulator/integration或 staging 補證據。

PR 2新增`PaginatedMessageStore`的live/historical merge、dedupe與stable ordering測試；offline policy測explicit opt-in與pending revoke memory fallback；Functions測Push hash、idempotent refresh/cross-account replacement、owner-only release與privacy copy。Rules另驗證雙read-state write在任一mirror不合法時整批失敗，以及client不能寫Push mirror/global claim。真實FCM delivery、browser permission revoke、multi-tab IndexedDB lock與rollout adoption比例仍須staging/production smoke，不能由pure unit tests取代。

PR 2 local gate：20個client unit tests通過，scoped statements coverage 87.95%（message store 92.3%、offline policy 100%）；19個Functions tests、18個Rules tests、signed-out Playwright 1/1全部通過。Production build core signed-in JavaScript為203.25 kB gzip，低於210 kB budget；production audit在high threshold exit 0，仍有一個既有moderate advisory待PR 4處理。GitHub CI使用Node 22執行原始`pnpm`命令，是merge的authoritative gate。

每個 phase 都必須通過 README 列出的完整 gate。Rules、Functions 或 migration 變更不能以「只有三位使用者」為由略過測試。

效能 fixture 需包含 5,000 messages，檢查只訂閱載入訊息的 reactions、切房後 listener 歸零、長列表 memory、initial gzip <200kB，且 AI/Media/RTC/Search chunk 不進首屏。
