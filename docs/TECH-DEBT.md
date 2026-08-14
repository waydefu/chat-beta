# 技術債登記簿

每一項都必須可執行：有明確的驗收條件與最早可安全處理的日期。不收「TODO later」。

最後更新：2026-08-14

| ID | 問題 | 影響 | 優先 | 依賴 | 最早可處理 | 驗收條件 |
|---|---|---|---|---|---|---|
| TD-A1 | `@google/genai` 安裝 `^1.15.0`，最新為 `2.17.1`，差一個主版本 | 落後兩年份的 SDK 修正與型別；升級具破壞性風險 | 中 | Gemini production 穩定執行至少七天 | 2026-08-21 | 升 v2 後 `functions` typecheck 與全部 bot 測試通過，且 production smoke 重跑一次串流、取消、usage metadata |
| TD-A2 | `generateGeminiReply` 的 callable 層無測試（lease、replay、串流、取消、並行釋放） | 這些是 race-safety 的核心路徑，回歸不會被 CI 擋下 | **高** | 需要 Firestore 與 GenAI SDK 的 mock 邊界 | 立即 | 涵蓋首次請求、lease 中重複、過期 lease replay、完成後 replay、取消不留 final message、429/5xx/timeout、context > 24k、`finally` 釋放並行 |
| TD-A3 | `context-builder.ts` 與 `rate-limit.ts` 無測試 | context 修剪與速率限制錯誤只會在 production 顯現 | 高 | 同上 mock 邊界 | 立即 | 涵蓋排序、reply context、token 修剪、不洩漏其他房間、正常取得／並行／釋放／過期 lease |
| TD-A4 | Inline Grounding Citations（行內引用標註與文字 span mapping） | 訊息僅提供整則來源列表，無句級/段落級細緻引用 | 低 | Google Search Grounding 上線穩定 | 待排 | 保留 `groundingSupports`，支援點擊引文標號跳轉或反白對應來源 |
| TD-A5 | Dedicated Weather Tool（專用氣象 API 整合） | 搜尋 grounding 無法保證即時精確經緯度預報與警報結構 | 中 | Google Search Grounding 上線穩定 | 待排 | 整合專用 Weather API 提供氣溫、降雨機率、逐時/10日預報與卡片渲染 |
| TD-P1 | typing 寫入 `updatedAt` 但 `watchTyping` 從不讀，沒有 TTL | `onDisconnect` 未觸發時，該使用者對全房間永遠顯示「正在輸入」 | 中 | 無 | 立即 | 讀取端套用與 presence 相同的過期判定；補測試涵蓋過期與未過期 |
| TD-P2 | `typingTimer` 在 `closeRoom`／`cleanupSession` 未清除 | 1800ms 內切換房間時，計時器會對**新**房間誤送 `setTyping(false)` | 中 | 無 | 立即 | 切房後舊計時器不影響新房間；lifecycle 有明確 owner |
| TD-P3 | presence 的 12 小時 legacy 相容窗（`PRESENCE_LEGACY_TRUST_MS`） | 過渡期措施，長期會讓真正的殭屍連線多存活 12 小時 | 中 | 全部 client 都已載入 #33 之後的版本 | 2026-08-21 | 移除該分支與常數，`hasOnlineConnection` 只留嚴格窗，測試同步更新 |
| TD-T1 | `watchSystemTheme` 在 `bootstrap.ts:41` 與 `chat.controller.ts:1228` 各註冊一次，且不回傳 unsubscribe | 同一份狀態兩個 owner，監聽器存活至整個頁面生命週期 | 中 | 無 | 立即 | 單一註冊點、回傳 unsubscribe、由明確的 lifecycle scope 持有 |
| TD-M1 | `membership.ts` 撤銷成員時只清 legacy room presence，未清 global presence | 被移除的成員在 global presence 仍可能顯示在線 | 中 | 無 | 立即 | 撤銷流程一併移除 `realtime/presence/{uid}`；rules 測試涵蓋 |
| TD-L1 | legacy RTC 三支（`startLiveKitCall`／`getLiveKitToken`／`endLiveKitCall`）仍部署 | 新舊雙架構並存，違反「不得永久 dual architecture」 | 中 | 七天觀察期，且確認無 supported client 流量 | 2026-08-21 | 依 production inventory 明確刪除該三支，HANDOFF 記錄 |
| TD-L2 | legacy `realtime/rooms/{roomKey}/presence` 路徑與其 rules 仍保留 | 同上 | 中 | 同上 | 2026-08-21 | 移除路徑與對應 rules，rules 測試更新 |
| TD-L3 | legacy push token 文件仍存在 | canonical registry 之外的殘留資料 | 低 | 同上 | 2026-08-21 | 確認 `pushTokenClaims` 為唯一來源後清除 |
| TD-U1 | `chat.controller.ts` 已達 1315 行，同時管儲存、狀態、渲染、生命週期 | 變更放大；渲染與訂閱耦合 | 中 | UI 方案選定 | UI Phase 3 | 拆出 MessageRenderer／ComposerController／DrawerController／PresenceController，各有明確 ownership |
| TD-U2 | `src/style.css` 三層疊加（初版／2026 refinement／3.0 override），重複 media query，`.call-video` 重複定義 | 特異性債務，append-only 造成回歸 | 中 | UI 方案選定 | UI Phase 3 | 拆為 tokens/base/layout/... 分層，無重複選擇器 |
| TD-U3 | 死碼：`#chat-heads`（68 行 CSS）、`.typing-chip`／`.typing-dots`／`.typing-label`、`public/image/background.jpg`、`public/image/logo.png` | 每次部署都在傳輸未使用的位元組 | 低 | 確認無動態引用 | UI Phase 3 | 刪除後視覺與 build 驗證通過；`@keyframes ring-pulse` 為共用，**不可**一併刪除 |
| TD-U4 | 圖示全為平台 Unicode 字形（13 種），零 SVG | 各作業系統渲染尺寸與樣式不一致 | 中 | UI 方案選定 | UI Phase 3 | 改為 inline SVG，`aria-label` 維持現狀 |
| TD-D1 | `docs/motion.md:20` 引用不存在的 `chat-head-ping`（實際為 `chat-head-pop`） | 文件與程式碼不符 | 低 | 無 | 立即 | 修正或隨死碼一併移除 |
| TD-R1 | 媒體與貼圖批次（審計 PR 3）：共用 R2 primitives、貼圖管理 UI、URL 過期重取、上傳重試 | 使用者無法管理自訂貼圖；重複的 MIME／配額邏輯易漂移 | 中 | 無 | 待排 | 依審計 P1-16／P1-17／P2-07～09 逐項驗收 |
| TD-R2 | 備份與保留批次（審計 PR 5）：archive manifest、checkpoint、dry-run、restore runbook | 無法安全啟用資料保留 | 中 | 無 | 待排 | 依審計 P1-18 驗收；刪除預設維持關閉 |
