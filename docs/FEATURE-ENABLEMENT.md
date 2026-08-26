# 剩餘功能啟用 runbook

Last updated: 2026-08-14 (Asia/Taipei)

這份文件接在 [HANDOFF](HANDOFF.md) 之後。HANDOFF 記錄 3.0 rollout 完成後的 production 狀態，這份記錄「還沒開的功能要怎麼開」。接手的人請先讀 HANDOFF 的〈Provider integrations〉，再讀這裡。

規則不變：不要把任何 secret 值、user ID、production 房間名稱或訊息內容寫進這個 repo。

## 0. 現況

### Production Functions（asia-east1，Node.js 22，gen2）

[HANDOFF](HANDOFF.md) 保存最後一次已驗證的部署 snapshot；每次 rollout 前仍必須以 `firebase functions:list --project f-chat-wayde-fu` 取得 fresh inventory。不要用這份 runbook 推測 production 已部署哪一支 Function。

RTC correctness PR 會增加 V2 start/token/end與七支 callable/trigger/scheduler；在該 PR合併並完成 [MIGRATION](MIGRATION.md) 的順序前，production仍只有舊版 start/token/end RTC contract。新版 Hosting client不得先行。

### 已上線 Functions

| Function | 部署時間 | 功能 |
| --- | --- | --- |
| `generateGeminiReply`／`cleanupExpiredAIDrafts` | 2026-08-14，GitHub Actions run 31798296940 | Gemini AI 回覆、串流草稿與過期草稿清理 |

Gemini callable 的無內容健康檢查已到達端點；仍須依第 7.5 節在真實房間驗證串流、取消、用量 metadata 與錯誤情境。

### 未部署的 Functions 與其依賴

| Function | 需要的 secret | 解鎖的功能 |
| --- | --- | --- |
| `notifyOnMessage` | 無 | FCM 推播（新訊息通知） |
| `sendStickerMessage` | 無 | 內建貼圖 |
| RTC lifecycle／signaling／cleanup（見 [RTC](RTC.md)） | `LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET` | 語音／視訊、正式來電、single-call lock、recovery |
| `requestUpload`／`finalizeUpload`／`getAttachmentDownloadUrl`／`cleanupExpiredUploads`／`cleanupOrphanR2Objects` | `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET` | 檔案附件、語音訊息 |
| `requestCustomStickerUpload`／`finalizeCustomStickerUpload`／`getCustomStickerDownloadUrl`／`deleteCustomSticker`／`cleanupExpiredCustomStickerUploads` | 同上 R2 | 自訂貼圖 |
| `searchMessages`／`syncMessageSearchIndex` | `ALGOLIA_APP_ID`、`ALGOLIA_ADMIN_KEY`、`ALGOLIA_INDEX_NAME` | 歷史訊息搜尋 |

「需要的 secret」是逐一核對每支 Function 的 `secrets:` 宣告得到的，不是從功能名稱推測。要重新確認：

```bash
grep -rn "secrets:" functions/src
```

### Secret Manager 現況

Secret 的值與版本狀態不進 Git；不能沿用舊文件中的 `UNCONFIGURED` 推測。每個 provider phase 都要由 operator 確認目前 active version、在 protected staging 做 runtime smoke，且不得把 `functions:secrets:access` 的內容貼到 log、PR 或聊天。

### client 端現況

Client 有些功能會走真實 callable；是否 production-ready 以 fresh Functions inventory、provider smoke 與 feature-specific gate 三者共同決定。未部署 backend 的 UI 必須在後續 feature-flag/debt PR fail closed，不能把 callable 失敗當功能開關。

## 1. 啟用順序

| 批次 | 內容 | 外部依賴 | 前置 |
| --- | --- | --- | --- |
| A | 推播、內建貼圖 | 無 | 第 2 節 |
| B | 通話（LiveKit） | LiveKit Cloud 帳號 | 批次 A 完成、CSP 修正 |
| C | 附件、語音訊息、自訂貼圖 | Cloudflare R2 | 批次 B 完成、R2 CORS／lifecycle |
| D | AI 回覆 | Gemini API key | Remote Config 釘模型版本 |
| E | 歷史搜尋 | Algolia 帳號 | room-bound index、刪除同步驗證 |

先做批次 A 的理由：它不需要任何第三方帳號，可以把「補部署角色 → 部署 Functions → 驗收」這條從未走過的路徑先跑通一次。第一次用 WIF service account 部署 Functions 幾乎一定會缺權限，讓它在最沒有外部依賴的批次上失敗，遠比在通話上線當天失敗好。

## 2. 先決條件（所有批次共用，只做一次）

### 2.1 repo 改動（已完成）

原本 [.github/workflows/deploy-hosting.yml](../.github/workflows/deploy-hosting.yml) 只有 `feature_backend` 一個會部署 provider Functions 的階段，而它一次部署全部 22 支，包含 secret 還是佔位的那些。這讓「只開通話」在流程上不可能，而且 `providers_verified=true` 這個人為聲明也無法照實回答。

現在多了兩個階段：

| 階段 | 部署內容 | gate |
| --- | --- | --- |
| `notification_backend` | `notifyOnMessage`、`sendStickerMessage` | 只檢查 `migration_verified` |
| `rtc_backend` | RTC V2 start/token/end、confirm/respond/heartbeat/fail、signal sync、兩支 cleanup | `migration_verified` 與 `providers_verified` |
| `ai_backend` | `generateGeminiReply`、`cleanupExpiredAIDrafts` | `migration_verified` 與 `providers_verified` |
| `firestore_indexes` | 只有 `firestore:indexes`（含 `fieldOverrides`） | 無 |

`notification_backend` 不設 provider gate，因為那兩支沒有任何 secret 宣告。理由與 PR #13 把 `hosting_client` 的 gate 拿掉一樣：不要求一個無法照實回答的聲明。

`rtc_backend` 的 `providers_verified` 是**範圍限定**的聲明，指的是 LiveKit 已就緒，不是全部 provider 都好了。`feature_backend` 保留原本的全機隊 gate 不變。

`firestore_indexes`（2026-08-17 新增）也不設 gate：它只建立索引容量，不改行為、不動 provider、不動 Rules，沒有查詢的索引是惰性的。它的用途是替**線上已經在跑**的程式碼補索引；新查詢的索引仍然要跟著它的 Function 一起出，見 [MIGRATION](MIGRATION.md)。部署成功不等於索引可用，要另外確認狀態為 `READY`，見 [TESTING](TESTING.md)。

### 2.2 補部署角色

部署角色會隨 trigger 類型改變，現況以 IAM inventory 與 [HANDOFF](HANDOFF.md) 為準。gen2 Functions 實際部署會要求下列其中幾項。**照 WIF-SETUP 的原則辦：讀錯誤訊息指名的權限、只補那一項，不要預先全給，也不要改用個人帳號繞過 WIF。**

| 角色 | 什麼時候會需要 |
| --- | --- |
| `roles/run.admin` | 所有 gen2 Functions（底層是 Cloud Run） |
| `roles/eventarc.developer` | `notifyOnMessage`（Firestore trigger 走 Eventarc） |
| `roles/cloudscheduler.admin` | 排程類 Functions（批次 C／D 才會用到） |
| `roles/secretmanager.admin` | 批次 B 起。部署帶 `defineSecret` 的 Function 時，CLI 要幫 runtime service account 綁 `secretAccessor` |

`secretmanager.admin` 給部署帳號的範圍偏大。替代做法是預先手動把 `roles/secretmanager.secretAccessor` 授給 Functions 的 runtime service account，部署帳號就只需要 `roles/secretmanager.viewer`。兩種都可以，選定後把決定寫回 WIF-SETUP。

### 2.3 每次部署前的固定檢查

沿用 HANDOFF〈Before any production mutation〉那份清單，一項都不要跳過。

## 3. 批次 A：推播與內建貼圖

### 3.1 推播啟用條件

PR 2之後，client不再直接寫`users/{uid}/pushTokens`。`claimPushToken`／`releasePushToken`用transaction維護`pushTokenClaims/{sha256(token)}`唯一owner和user-private mirror；chat與call sender只信任canonical registry。這避免同一browser token跨帳號殘留，也表示舊版「只部署notifyOnMessage」流程已失效，必須走[MIGRATION](MIGRATION.md)的分段adoption gate。

### 3.2 部署

workflow已提供`push_ownership_backend`和`push_sender_backend`。先跑ownership phase，再部署`hosting_client`並觀察adoption；驗證後以`push_adoption_verified=true`跑sender，最後才跑`restrictive_rules`。不得用`feature_backend`或`full_post_migration`一次跨過gate；兩者也會檢查同一個adoption確認。

### 3.3 驗收

1. `firebase functions:list --project f-chat-wayde-fu` 出現`claimPushToken`、`releasePushToken`、`cleanupStalePushTokens`與`notifyOnMessage`。
2. A、B 兩個帳號同房。B 開啟推播，確認`pushTokenClaims/{hash}.uid=B`和`users/{B}/pushTokens/{hash}.ownershipVersion=1`；client不得讀global claim。
3. B 把分頁切到背景，A 送一則訊息，B 應收到系統通知，點擊後開到該房間。
4. B 把該房間設為靜音，A 再送一則，B 不應收到——`notifyOnMessage` 有讀 `roomStates/{roomId}.muted`。
5. B登出或切換成A，舊B mirror必須消失或同hash owner原子轉移；B不再收到A帳號通知。
6. Cloud Logging查structured operations，確認沒有`messaging/`錯誤堆積，也沒有token或message text。
7. 送一張內建貼圖，訊息列正常顯示。

### 3.4 回滾

先回滾sender，再回滾Hosting/Rules到彼此相容的release。`pushTokenClaims`是additive資料，可保留供roll-forward；不得刪callables後仍讓新版client呼叫，也不得回滾成client直寫token卻保留restrictive Rules。詳細步驟以[MIGRATION](MIGRATION.md)為準。

## 4. 批次 B：通話（LiveKit）

### 4.1 Repository rollout scope

RTC 現在不是三支 callable，而是完整 lifecycle/signaling/cleanup機隊。新 client呼叫 `startLiveKitCallV2`／`getLiveKitTokenV2`／`endLiveKitCallV2`，避免 additive backend階段破壞仍開著的舊頁面。狀態機與 invariant見 [RTC](RTC.md)；資料與 additive migration見 [MIGRATION](MIGRATION.md)。`livekit-client`仍是動態 import，不進首屏 chunk；Firestore calls/incoming signals都是 server-only write。

這次變更需要先部署 index、Eventarc trigger 與 Cloud Scheduler Functions，再部署 additive Rules，最後才部署 Hosting client。不能只覆蓋舊三支 Function 後直接上新版 client。

### 4.2 建立 LiveKit Cloud 專案

1. 到 <https://cloud.livekit.io> 建立專案，region 選離 `asia-east1` 最近的。
2. 在 Settings → Keys 產生 API key／secret，記下專案 URL（形如 `wss://<subdomain>.livekit.cloud`）。
3. 不需要在 LiveKit 端調 token TTL，程式碼已經寫死 10 分鐘。

### 4.3 寫入 Secret Manager

三個 secret 各跑一次，值用貼的，不要寫進任何檔案或留在 shell 歷史：

```bash
firebase functions:secrets:set LIVEKIT_URL --project f-chat-wayde-fu
```

`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET` 同樣做法。三個都設好之後，先確認哪一版是佔位值：

```bash
firebase functions:secrets:access LIVEKIT_URL@1 --project f-chat-wayde-fu
```

確認後再停用該版本，不要憑編號猜：

```bash
firebase functions:secrets:destroy LIVEKIT_URL@1 --project f-chat-wayde-fu
```

### 4.4 CSP（repo 已修，但要部署才生效）

[firebase.json](../firebase.json) 的 `connect-src` 原本只有 `wss://*.livekit.cloud`，缺 `https://*.livekit.cloud`，現已補上。**但 CSP 是 Hosting 標頭，要跑一次 `hosting_client` 階段部署才會對使用者生效，這件事要在 `rtc_backend` 之前做完。**

原因：`livekit-client` 連到 `.livekit.cloud` 網域時，會先對 `https://<host>/settings/regions` 發一個 `fetch` 做區域探索。SDK 裡的 `getCloudConfigUrl()` 把 URL 的 `wss:` 換成 `https:`。LiveKit 官方防火牆需求也是列 `*.livekit.cloud` TCP 443，涵蓋 https 與 wss。

影響程度要說清楚，免得接手的人判斷錯優先序：這個 fetch 失敗在 SDK 裡有 `.catch` 接住、只會 `log.warn`，**所以第一次連線仍然會成功**。代價是區域備援（region failover）完全失效，且 console 會持續噴 CSP 錯誤。這不是「通話打不開」等級的問題，但必修，而且要在通話上線前修，否則之後每一次連線品質問題都會多一個變因。

WebRTC 的媒體連線（ICE／TURN／UDP）不受 CSP 管轄，所以 `*.turn.livekit.cloud` 不需要寫進 CSP。

CSP 改動走 `hosting_client` 階段部署。HTML 現在是 `Cache-Control: no-cache`（PR #8），標頭改動下一次請求就生效，不必等一小時；驗收時仍建議開無痕視窗，避免 Service Worker 或既有分頁干擾判斷。

### 4.5 部署

```bash
gh workflow run "Deploy Firebase production" --repo waydefu/chat-beta -f rollout_phase=rtc_backend -f migration_verified=true -f providers_verified=true
```

`providers_verified=true` 在這個階段的意思是「LiveKit 的憑證已設定並在 staging 驗過」，不是「全部 provider 都好了」。這就是拆階段的用意，照實回答即可。

### 4.6 驗收

用兩個真實帳號測，不要只有自己一個帳號開兩個分頁：

1. A、B 同房，A 按 ☎。
2. A 看到「語音通話已開始」的 toast，兩邊訊息列都出現「開始了一通電話」的系統訊息。
3. B 點該系統訊息加入，雙向可通話。
4. DevTools Console 沒有任何 CSP 違規。
5. Network 面板確認 `getLiveKitTokenV2` 回傳 `expiresIn: 600`。
6. A 掛斷，Firestore `rooms/{roomId}/calls/{callId}.status` 變 `ended`，且 room `activeCallId` 被清除；重送 end 結果不變。
7. 非發起者且非 owner／admin 的成員呼叫結束，應得到 `permission-denied`。
8. 視訊（▣）與螢幕分享各測一次。
9. 通話結束後，DOM 不應殘留 `[data-chat-lite-call-audio]` 或 `.call-video`。
10. 同房兩人同時 start、double click、media permission denial、關頁與斷網 recovery 都要驗證；不能只測 happy path。
11. 背景分頁收到獨立 `type=call` 通知，foreground 收到 per-user incoming signal；普通 chat notification 不應代替 signaling。

### 4.7 上線前的非技術前置

**隱私說明與服務條款必須先更新。** 通話會把使用者的音訊與視訊送到 LiveKit Cloud 這個第三方處理者，這是 HANDOFF〈Immediate follow-up〉第 8 點。在 [privacy.html](../privacy.html) 揭露之前，不要對真實使用者開放通話。

### 4.8 App Check

先查 production `APP_CHECK_ENFORCED_FEATURES`，不要依文件猜值。client 對所有 RTC callable 都帶 `limitedUseAppCheckTokens: true`；backend 在 `rtc` enforce 時全部 consume。等 metrics 顯示合法流量穩定之後再加 `rtc`，一次只加一個 surface。

### 4.9 回滾

```bash
firebase functions:delete startLiveKitCallV2 getLiveKitTokenV2 confirmLiveKitCall respondLiveKitCall heartbeatLiveKitCall failLiveKitCall endLiveKitCallV2 cleanupStaleLiveKitCalls syncCallSignals cleanupExpiredCallSignals --project f-chat-wayde-fu --region asia-east1
```

先 rollback Hosting 到前一個 release，再刪新增 Functions；保留舊 `startLiveKitCall`／`getLiveKitToken`／`endLiveKitCall` 才能服務舊 client。已結束的 calls、system messages 與未過期 incoming signals 是 recovery/history，不要在 rollback 當場手動刪除。

> **這段的前提在 TD-L1 執行後即失效。** 舊三支的**來源碼已不在 repo**（2026-08-26 查核），因此一旦依 TD-L1 從 production 刪除它們，這條 rollback 路徑就不再存在——rollback Hosting 到前一個 release 會得到一個呼叫已不存在 callable 的 client。刪除之前請先確認：可接受的 RTC rollback 範圍將只剩「Hosting 回到仍使用 V2 的某個 release」。

## 5. 批次 C／D／E

共同前置與批次 B 相同（角色、workflow 階段、部署前檢查）。各自的 gate 沿用 HANDOFF〈Required provider gates〉：

- **批次 C（R2）**：除了四個 secret，還要先設定 bucket CORS、lifecycle rule、配額，並確認 orphan cleanup 能正確刪除未 finalize 的物件。這批會啟用兩支排程 Function，部署帳號屆時需要 Cloud Scheduler 權限。
- **批次 D（Gemini）**：見第 7 節，這批有自己的 `ai_backend` 階段。
- **批次 E（Algolia）**：index 必須是 room-bound，且要驗證訊息刪除會同步刪除索引，否則等同把已刪訊息留在第三方可搜尋。

每一批都要在受保護 staging 做完 smoke test 才動 production，並且更新 privacy／terms。

## 6. 不要做的事

- 不要用 `feature_backend` 階段來開單一功能。那個階段是 22 支一起出，只有全部 provider 都就緒時才該用。
- 不要為了讓部署過關而把 `providers_verified` 填成不實的值。這兩個 input 是人為聲明，唯一的價值就是誠實。
- 不要在還沒補齊角色前，改用個人帳號從本機或 Cloud Shell 手動部署 Functions。那會讓 production 的實際狀態與 workflow 記錄脫節，正是 WIF 當初要解決的問題。
- 不要把 secret 值貼進 commit message、PR 描述、issue 或這個 repo 的任何檔案。

## 7. 批次 D：AI 回覆（Gemini）

已於 2026-08-14 透過 `ai_backend` phase 部署。以下保留金鑰輪替、模型設定、驗收與回滾的操作紀錄；不要重複部署，除非修改了 AI Functions。

### 7.1 取得並寫入金鑰

到 <https://aistudio.google.com> → Get API key → Create API key，選 `f-chat-wayde-fu` 專案。然後：

```bash
node node_modules/firebase-tools/lib/bin/firebase.js functions:secrets:set GEMINI_API_KEY --project f-chat-wayde-fu
```

貼值時**只貼金鑰本身**，不要帶 `GEMINI_API_KEY=` 前綴。LiveKit 那次就是整行貼進去，簽出來的憑證當然無效。設完可以驗一下長度合不合理，這個指令不會印出內容：

```bash
node node_modules/firebase-tools/lib/bin/firebase.js functions:secrets:access GEMINI_API_KEY --project f-chat-wayde-fu | tr -d '\r\n' | awk '{print "len=" length($0)}'
```

### 7.2 釘住模型版本

[model-config.ts](../functions/src/bots/model-config.ts) 從 Remote Config 讀 `gemini_model`，讀不到才退回程式碼裡寫死的備援值，並且快取五分鐘。**上線前要在 Remote Config 明確設定這個參數**，否則模型版本由程式碼裡那個可能已經過期的常數決定。

Firebase Console → Remote Config → 新增參數 `gemini_model`，值填一個目前有效的穩定模型 ID。改動五分鐘內生效，不需要重新部署。

### 7.3 隱私說明先上

Gemini 會把聊天內容送給 Google，這是新的第三方處理。`privacy.html` 已經寫好對應段落，但**必須先跑 `hosting_client` 部署讓它生效，再部署 `ai_backend`**。揭露要走在處理前面。

### 7.4 部署

```bash
gh workflow run "Deploy Firebase production" --repo waydefu/chat-beta -f rollout_phase=ai_backend -f migration_verified=true -f providers_verified=true
```

`providers_verified` 在這個階段限定指 Gemini 已設定並驗過，不是全部 provider。

`cleanupExpiredAIDrafts` 是每五分鐘的排程，所以這個階段需要 `roles/cloudscheduler.admin`。

### 7.5 驗收

1. 在訊息裡提及 Gemini，送出後應看到逐字串流的回覆。**用 `@` 選單挑選，或直接手打 `@Gemini`，兩者都會觸發** —— client 是以文字比對 `@Gemini` 產生結構化提及的（`src/messages/message.service.ts`）。不含 `@` 的「Gemini」不會觸發，`@GeminiTest` 這類延伸字串也不會（token boundary 檢查）。
2. **Google Search Grounding 驗證**：
   - 知識/推理題（如「1+1 是多少？」）：直接回答，不觸發 Search grounding，無來源區塊。
   - 即時新聞/時事題（如「今天有什麼重要 AI 新聞？」）：使用 grounding，訊息下方顯示「來源 · N」折疊面板，展開顯示最多 5 個標題與網域連結。
   - 一般天氣題（如「淡水現在天氣如何？」）：使用 grounding 說明近期資訊與時間點，若無地點（「今天天氣如何？」）主動反問地點，不猜測所在地。
3. 串流中按取消，草稿應消失且不留下最終訊息。
4. 另一個帳號在同一房間應看得到生成中的草稿。
5. Firestore `rooms/{roomId}/aiRequests/{runId}` 有 status、usage、latency、model、groundingUsed、groundingSourceCount 紀錄。
6. Cloud Logging 確認**完整 prompt、使用者 query、造訪 URL 與頁面標題絕不寫入日誌**（僅記錄 `groundingUsed` 與 `groundingSourceCount`）。
7. 十分鐘後確認過期草稿被清掉。

### 7.6 回滾

```bash
firebase functions:delete generateGeminiReply cleanupExpiredAIDrafts --project f-chat-wayde-fu --region asia-east1
```

刪掉後前端提及 Gemini 會失敗，`privacy.html` 也要改回「尚未啟用」。

## 8. 交接時要更新的地方

每完成一個批次，更新 [HANDOFF](HANDOFF.md) 的〈Provider integrations〉與〈Immediate follow-up〉，並把該批次的 Functions 從這份文件第 0 節的「未部署」表移到「已上線」。
