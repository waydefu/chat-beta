# 技術債登記簿

每一項都必須可執行：有明確的驗收條件與最早可安全處理的日期。不收「TODO later」。

最後更新：2026-08-16

| ID | 問題 | 影響 | 優先 | 依賴 | 最早可處理 | 驗收條件 |
|---|---|---|---|---|---|---|
| TD-A1 | `@google/genai` 安裝 `^1.15.0`，最新為 `2.17.1`，差一個主版本 | 落後兩年份的 SDK 修正與型別；升級具破壞性風險 | 中 | Gemini production 穩定執行至少七天 | 2026-08-21 | 升 v2 後 `functions` typecheck 與全部 bot 測試通過，且 production smoke 重跑一次串流、取消、usage metadata |
| TD-A2 | `generateGeminiReply` 的 callable 層無測試（lease、replay、串流、取消、並行釋放） | 這些是 race-safety 的核心路徑，回歸不會被 CI 擋下 | **高** | 需要 Firestore 與 GenAI SDK 的 mock 邊界 | 立即 | 涵蓋首次請求、lease 中重複、過期 lease replay、完成後 replay、取消不留 final message、429/5xx/timeout、context > 24k、`finally` 釋放並行 |
| TD-A3 | `context-builder.ts` 與 `rate-limit.ts` 無測試 | context 修剪與速率限制錯誤只會在 production 顯現 | 高 | 同上 mock 邊界 | 立即 | 涵蓋排序、reply context、token 修剪、不洩漏其他房間、正常取得／並行／釋放／過期 lease |
| TD-A4 | Inline Grounding Citations（行內引用標註與文字 span mapping） | 訊息僅提供整則來源列表，無句級/段落級細緻引用 | 低 | Google Search Grounding 上線穩定 | 待排 | 保留 `groundingSupports`，支援點擊引文標號跳轉或反白對應來源 |
| TD-A5 | Dedicated Weather Tool（專用氣象 API 整合） | 搜尋 grounding 無法保證即時精確經緯度預報與警報結構 | 中 | Google Search Grounding 上線穩定 | 待排 | 整合專用 Weather API 提供氣溫、降雨機率、逐時/10日預報與卡片渲染 |
| TD-C1 | PR #43 的三項 RTC 啟動最佳化（inline grant、App Check session warm-up、媒體與協商平行化）已於 2026-08-16 部署，但**尚未取得任何一組部署後的分段數字** | 無法判定是改善、無感或回歸。2026-08-15 的原結案把瓶頸歸給「Cloud Function 冷啟動」並宣告不要再改 client，該歸因已由 server 端對照推翻（暖機 server 端只佔 212 ms／2234 ms，9%），**不得再引用** | **高** | 需要兩個真實帳號、真實音訊裝置與 production | 立即 | 以 `localStorage['chat-lite:call-timing']='1'` 取得 ≥5 通暖機語音、≥1 通真正冷啟動語音、≥1 通視訊，逐階段算出 min/median/max，填入 `docs/RTC.md` 的 AFTER 表並與 BEFORE 對照；最後必須標記 `VERIFIED-IMPROVEMENT`／`NO-MEANINGFUL-IMPROVEMENT`／`REGRESSION`／`INCONCLUSIVE` 其中一個，不接受模糊措辭 |
| TD-C2 | 重連瞬間 presence heartbeat 會被 Rules 拒一次：`detected connection state mismatch` 後接 `update /realtime/presence/{uid}/connections/{id} failed: permission_denied` | 目前可自癒（下一次 heartbeat 與 `establish()` 會補回），但 console 被洗版，真正的授權問題會被藏在噪音裡 | 中 | 無 | 立即 | 找出 heartbeat 與 RTDB 重新認證之間的競態；重連後不得再出現 `permission_denied`，或由 `establish()` 統一擁有重連後的第一次寫入。2026-08-15 production 實測：斷網 20 秒重連後必現一次。**2026-08-16 狀態：NON-BLOCKING**（可自癒，非正確性缺陷）；本輪未重新觀測，因為需要真實斷網。 |
| TD-C3 | 長時間開著的分頁寫入全部被拒：連續 28 次 heartbeat `permission_denied`，分頁齡 154 分鐘 | 使用者整天開著分頁會靜默從 presence／typing 消失，畫面卻仍顯示已連線 | 中 | 需要能重現：單一帳號、不換帳號、分頁放置 >1 小時 | 立即 | 兩個變因必須先分離，未分離前不得提出根因或修法。**TEST A（長效 session，不換帳號）**：單一帳號登入，分頁放置 2 小時且期間不切換帳號，presence heartbeat 須全程成功、無 `permission_denied`。**TEST B（換帳號，不長放）**：登入後 5 分鐘內切換到另一帳號，觀察切換後的 heartbeat 是否被拒。兩項各自獨立記錄結果 |
| TD-C4 | typing 指示器的 stale 清除路徑（`TYPING_STALE_AFTER_MS` 6 秒 ＋ `TYPING_SWEEP_MS` 2 秒 sweep）只有單元測試，沒有 production 異常終止實測 | 對方分頁被強制結束時 `onDisconnect` 不會執行，若 sweep 失效，A 會永遠停在「正在輸入…」 | 中 | 需要兩個真實帳號，且能對 B 製造真正的異常終止（工作管理員結束行程，不是正常關閉分頁） | 立即 | B 開始輸入後強制結束其瀏覽器行程；A 的「正在輸入…」必須在約 8 秒內（6 秒 stale ＋ 最多一次 2 秒 sweep）消失。實測通過才可標記 `TYPING_STALE = VERIFIED-PRODUCTION`，否則維持 `MANUAL-VERIFICATION-REQUIRED` |
| TD-C5 | `cleanupExpiredCallSignals` 每次排程執行都以 `FAILED_PRECONDITION` 失敗：`collectionGroup('incomingCalls').where('expiresAt','<=',…)` 是**單欄位 collection-group 查詢**，需要 `fieldOverrides` 的 COLLECTION_GROUP 例外，但 `firestore.indexes.json` 的 `fieldOverrides` 是空陣列 | `users/{uid}/incomingCalls` 的保留清理從未生效，文件無上限累積。通話流程本身不受影響（signal 仍可建立與讀取），屬成長／保留問題而非通話中斷 | 中 | 無。修法是在 `firestore.indexes.json` 補 `fieldOverrides`，再以帶 `firestore:indexes` 的階段（`rtc_backend` 或 `additive_backend`）部署 | 立即 | 補上 `incomingCalls` 的 `expiresAt` COLLECTION_GROUP 單欄位例外後部署索引，觀察至少兩次排程（每 60 分鐘）不再出現 `FAILED_PRECONDITION`，且過期 signal 確實被刪除 |
| TD-P3 | presence 的 12 小時 legacy 相容窗（`PRESENCE_LEGACY_TRUST_MS`） | 過渡期措施，長期會讓真正的殭屍連線多存活 12 小時 | 中 | 全部 client 都已載入 #33 之後的版本 | 2026-08-21 | 移除該分支與常數，`hasOnlineConnection` 只留嚴格窗，測試同步更新 |
| TD-M1 | `membership.ts` 撤銷成員時只清 legacy room presence，未清 global presence | 被移除的成員在 global presence 仍可能顯示在線 | 中 | 無 | 立即 | 撤銷流程一併移除 `realtime/presence/{uid}`；rules 測試涵蓋 |
| TD-L1 | legacy RTC 三支（`startLiveKitCall`／`getLiveKitToken`／`endLiveKitCall`）仍部署 | 新舊雙架構並存，違反「不得永久 dual architecture」 | 中 | 七天觀察期，且確認無 supported client 流量 | 2026-08-21 | 依 production inventory 明確刪除該三支，HANDOFF 記錄 |
| TD-L2 | legacy `realtime/rooms/{roomKey}/presence` 路徑與其 rules 仍保留 | 同上 | 中 | 同上 | 2026-08-21 | 移除路徑與對應 rules，rules 測試更新 |
| TD-L3 | legacy push token 文件仍存在 | canonical registry 之外的殘留資料 | 低 | 同上 | 2026-08-21 | 確認 `pushTokenClaims` 為唯一來源後清除 |
| TD-U1 | `chat.controller.ts` 已達 1470 行，同時管儲存、狀態、渲染、生命週期 | 變更放大；渲染與訂閱耦合 | 中 | UI 方案選定 | UI Phase 3 | 拆出 MessageRenderer／ComposerController／DrawerController／PresenceController，各有明確 ownership |
| TD-U2 | `src/style.css` 三層疊加（初版／2026 refinement／3.0 override），重複 media query，`.call-video` 重複定義 | 特異性債務，append-only 造成回歸 | 中 | UI 方案選定 | UI Phase 3 | 拆為 tokens/base/layout/... 分層，無重複選擇器 |
| TD-U3 | 死碼：`#chat-heads`（68 行 CSS）、`.typing-chip`／`.typing-dots`／`.typing-label`、`public/image/background.jpg`、`public/image/logo.png` | 每次部署都在傳輸未使用的位元組 | 低 | 確認無動態引用 | UI Phase 3 | 刪除後視覺與 build 驗證通過；`@keyframes ring-pulse` 為共用，**不可**一併刪除 |
| TD-U4 | 圖示全為平台 Unicode 字形（13 種），零 SVG | 各作業系統渲染尺寸與樣式不一致 | 中 | UI 方案選定 | UI Phase 3 | 改為 inline SVG，`aria-label` 維持現狀 |
| TD-D1 | `docs/motion.md:20` 引用不存在的 `chat-head-ping`（實際為 `chat-head-pop`） | 文件與程式碼不符 | 低 | 無 | 立即 | 修正或隨死碼一併移除 |
| TD-R1 | 媒體與貼圖批次（審計 PR 3）：共用 R2 primitives、貼圖管理 UI、URL 過期重取、上傳重試 | 使用者無法管理自訂貼圖；重複的 MIME／配額邏輯易漂移 | 中 | 無 | 待排 | 依審計 P1-16／P1-17／P2-07～09 逐項驗收 |
| TD-R2 | 備份與保留批次（審計 PR 5）：archive manifest、checkpoint、dry-run、restore runbook | 無法安全啟用資料保留 | 中 | 無 | 待排 | 依審計 P1-18 驗收；刪除預設維持關閉 |

## 文件衝突（DOCUMENT-CONFLICT）

登記與 executable architecture 相牴觸的既有條目。程式碼、Rules 與設定優先於文件；未解決前不得依該條目施工。

| ID | 衝突條目 | 與什麼牴觸 | 為何 | 提出 |
|---|---|---|---|---|
| DC-1 | TD-M1「撤銷流程一併移除 `realtime/presence/{uid}`」 | `AGENTS.md` 條款 1（RTDB 不是授權來源）與 6（切房不得把使用者標為離線）、`docs/SECURITY.md`「Global Presence 不作為 room ACL」、`database.rules.json`（`realtime/presence/{uid}` 只由本人寫入，與 room membership 無關）、`src/realtime/presence-state.ts` 的 `onlineRoomMembers` | global presence 是「已登入的 session」，不是「某房間的成員」。因單一房間撤銷而刪除全域節點，會讓使用者在其他房間被誤判離線；該節點由 client 擁有寫入權，heartbeat 會立刻寫回，因此既不正確也無效 | 2026-08-15，Claude Code harness PR |

TD-M1 的症狀前提也需重新確認：`chat.controller.ts` 的在線清單是 `onlineRoomMembers(members, onlineIds, selfUid)`，即 active room membership ∩ global presence，被撤銷者會因為離開 `members` 而消失。目前沒有任何 UI 直接呈現 global presence。正確驗收方向是「撤銷後該使用者不再出現在該房間在線清單，且其他房間在線狀態不變」，而非刪除全域 presence 節點。
