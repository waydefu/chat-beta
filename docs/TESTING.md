# Testing

CI 固定使用 Node 22、pnpm lockfile、Java 21 與 Firebase emulators。unit 測 domain utility、client call state machine 與 Presence projection；Functions 測 membership version、bot routing/idempotency 與 server call lifecycle policy；Rules 測實際 Firestore/RTDB ACL；Playwright 測主要 UI 與 axe。

`tests/rules.test.ts` 覆蓋 anonymous、non-member、active、revoking、sender spoof、bot/system write、自我升權、owner removal、原子read mirrors、reaction、structured mention、缺 mirror、跨房、撤銷、legacy room multi-tab、global Presence self/cross-user/schema/root-list denial、incoming call recipient ACL，以及Push canonical claim/client mirror denial。Playwright 目前自動驗證 signed-out landing、鍵盤焦點及 axe serious/critical；RTC mobile surface 另以 320/390/desktop local visual smoke 檢查。登入後多使用者自動化仍是已知 gap，真 LiveKit 必須走受保護 staging gate。

PR 1 baseline：14 個 client unit tests（86.66% scoped coverage）、15 個 Functions tests、16 個 Rules tests全部通過；signed-out Playwright 1/1通過。Production build core signed-in JavaScript是 200.59 kB gzip，低於 210 kB budget，LiveKit仍為 lazy chunk。這些純 policy tests不能取代 LiveKit staging smoke；真實 concurrent transaction、media permission、network reconnect與 browser background行為必須在 emulator/integration或 staging 補證據。

PR 2新增`PaginatedMessageStore`的live/historical merge、dedupe與stable ordering測試；offline policy測explicit opt-in與pending revoke memory fallback；Functions測Push hash、idempotent refresh/cross-account replacement、owner-only release與privacy copy。Rules另驗證雙read-state write在任一mirror不合法時整批失敗，以及client不能寫Push mirror/global claim。真實FCM delivery、browser permission revoke、multi-tab IndexedDB lock與rollout adoption比例仍須staging/production smoke，不能由pure unit tests取代。

PR 2 local gate：20個client unit tests通過，scoped statements coverage 87.95%（message store 92.3%、offline policy 100%）；19個Functions tests、18個Rules tests、signed-out Playwright 1/1全部通過。Production build core signed-in JavaScript為203.36 kB gzip，低於210 kB budget；production audit在high threshold exit 0，仍有一個既有moderate advisory待PR 4處理。GitHub CI使用Node 22執行原始`pnpm`命令，是merge的authoritative gate。

每個 phase 都必須通過 README 列出的完整 gate。Rules、Functions 或 migration 變更不能以「只有三位使用者」為由略過測試。

## 可重複的 production 程序

單元／Rules／Playwright 都到不了的幾件事，各自有固定作法。每一項都寫下前置條件、方法與通過標準，因為它們的失敗方式是「看起來正常」。

**排程清理與索引驗證。** 綠色的部署 workflow 只證明指令回傳 0，不證明索引可用。先確認索引狀態為 READY（`gcloud firestore indexes fields describe <field> --collection-group=<group>`，或 composite 的對應指令），再手動觸發該支排程（`gcloud scheduler jobs run firebase-schedule-<function>-asia-east1 --location=asia-east1`），然後讀該 Function 的 log 確認沒有 `FAILED_PRECONDITION` 且有完成訊息。通過標準是 log 出現該 Function 自己的完成 log。注意刪除筆數為 0 不一定是失敗——先確認保留窗內是否真的有到期資料，再判讀。禁止為了製造測資而寫入 production。

**真實斷網重連。** DevTools 的 Offline 不可靠：它常常不會真的拆掉已經建立的 WebSocket，2026-08-15 的一次假陰性就是這樣來的。要拔實體網路或關閉 Wi-Fi，維持 20 秒以上再恢復，全程開著 console。觀察連線狀態列的三個階段與 `realtime/presence` 的寫入結果。通過標準：恢復後 presence 自行回復，且其他帳號能重新看到這個使用者。

**兩帳號 typing 異常終止。** 需要兩個真實帳號與兩個可獨立終止的瀏覽器 profile。B 開始輸入、A 看到「正在輸入…」之後，用工作管理員**結束 B 的行程**，不可用正常關閉分頁——正常關閉會觸發 `onDisconnect`，測不到要測的東西。計時到 A 的指示器消失為止，上限約 8 秒（`TYPING_STALE_AFTER_MS` 6 秒加最多一次 `TYPING_SWEEP_MS` 2 秒 sweep）。

**RTC 分段量測。** 在 console 設 `localStorage['chat-lite:call-timing'] = '1'` 後重載，該 session 才會輸出。需要兩個真實帳號與真實音訊裝置。冷啟動與暖機要分開記錄，並且要把 client 觀測到的每段時間與 Cloud Logging 的 server 端數字並排——兩者的差額是瀏覽器端成本，和 server 端是不同的修法。詳見 [RTC](RTC.md)。

效能 fixture 需包含 5,000 messages，檢查只訂閱載入訊息的 reactions、切房後 listener 歸零、長列表 memory、initial gzip <200kB，且 AI/Media/RTC/Search chunk 不進首屏。
