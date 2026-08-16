# RTC

RTC 使用 Firestore 做 server-authoritative signaling 與 recovery，LiveKit 只保存即時 participant／track 狀態。`CallProvider` 隔離 LiveKit；client 動態載入 `livekit-client`，不進首屏 chunk。

## Call state machine

```text
creating -> ringing -> active -> ending -> ended
    |          |          |          |
    +----------+----------+----------+-> failed / missed / cancelled / rejected
```

- `creating`：server 已取得 room lock，但 caller 尚未完成 token、LiveKit connect 與 media setup。
- `ringing`：caller 已連線並呼叫 `confirmLiveKitCall`，此時才建立 system call message 與 incoming signals。
- `active`：至少一位非 caller 成員已連線並確認。
- `ending`：結束操作的 durable intermediate state。
- terminal states：`ended`、`failed`、`rejected`、`missed`、`cancelled`。

Timer 從 client 實際連線且看到 remote participant 時開始，不從 panel constructor 或 `creating` 開始。

## Server invariants

`rooms/{roomId}.activeCallId` 是 room-level lock。`startLiveKitCallV2` 在 Firestore transaction 中同時檢查 lock 與 call operation：

- caller 產生 UUID operation ID；重送相同 operation 只會 resume 同一 call。
- 同房另一個 operation、double click 或 network duplicate 會得到 `CALL_ALREADY_ACTIVE`。
- transition 與 room pointer 在同一 transaction 寫入。
- legacy call 沒有 room pointer 時，start 會做 bounded fallback scan；fresh call 會阻擋新 call，stale call 會被 terminalize。超過修復上限時 fail closed，交由 cleanup 處理。
- 所有 live state 帶 `leaseExpiresAt`。caller 每 45 秒 heartbeat；`cleanupStaleLiveKitCalls` 每 5 分鐘 bounded cleanup，回收 crash、關頁或斷網留下的 lock。
- `endLiveKitCallV2` 可重入；pre-active 結束保存為 `cancelled`，active 結束保存為 `ended`。
- connection rollback 使用 `failLiveKitCall`；rollback 失敗不會覆蓋使用者看到的 primary connection error。

## Callables and triggers

| Backend | Responsibility |
| --- | --- |
| `startLiveKitCallV2` | idempotent intent + single-room lock |
| `getLiveKitTokenV2` | membership、lease、joinable state 與 publish-source grant |
| `confirmLiveKitCall` | caller `creating -> ringing`；callee `ringing -> active` |
| `respondLiveKitCall` | accepted／rejected durable response |
| `heartbeatLiveKitCall` | caller lease renewal |
| `failLiveKitCall` | failed connection rollback |
| `endLiveKitCallV2` | idempotent ending + terminal state + lock release |
| `syncCallSignals` | per-user incoming signal 與獨立 call push payload |
| `cleanupStaleLiveKitCalls` | bounded stale lifecycle recovery |
| `cleanupExpiredCallSignals` | bounded per-user signal retention |

V2 名稱是 rollout boundary：production舊三支 `startLiveKitCall`／`getLiveKitToken`／`endLiveKitCall` 在 Hosting切換前保持原樣；新版 client只呼叫 V2。舊 active call有四小時 migration grace，期間會阻擋同房 V2 start；過期後 cleanup回收。觀察期後明確刪除舊三支，repo不保留 legacy implementation或 dual-read。每支 replay-sensitive RTC callable都使用相同 `rtc` App Check gate；client每次都傳 `limitedUseAppCheckTokens: true`。不得只對 start或 token啟用。

## Incoming signaling

真正來電位於 `users/{uid}/incomingCalls/{callId}`，不是從聊天 system message 推論。只有收件者可讀、client 不可寫；Functions 根據 active room membership 建立 signal。FCM data payload 使用 `type=call`，service worker 以不同 tag、TTL、action 與普通聊天通知分流。

`syncCallSignals` 的文件建立是 create-if-missing，避免 trigger retry 把 `accepted`／`rejected` 蓋回 `ringing`。推播使用 durable claim 提供 at-most-once dispatch；claim 前 incoming signal 已落盤，因此 crash 時仍可由 foreground listener 收到。FCM 本身沒有跨 request idempotency key，這是刻意選擇 durable signal correctness 優先於重複 push。

## Client lifecycle

- provisional call state 在 provider join 前建立，所以 initial participant callback 不會早於 controller adoption。
- call 與 global presence 由 `SessionScope` 擁有；切換 room 不會掛斷或把本人設為 offline。
- LiveKit listeners、attached audio/video elements、tracks 與 AbortSignal 都由 session cleanup。
- reconnect 顯示明確 phase；provider terminal disconnect 會嘗試 end，server lease 是最後 recovery line。
- 語音通話不顯示 camera control；不支援 `getDisplayMedia` 時不顯示 screen-share control。
- desktop 是可拖動 compact panel；mobile 是 safe-area aware active screen，可縮成 call bar；incoming call 是 focus-contained bottom sheet。

## Startup sequence and latency

按下通話鍵到看見通話畫面之間橫跨一個 dynamic import、三支 callable、一次 provider handshake 與一次媒體授權。感知延遲與實際延遲的修法不同，兩者分開處理：

- **感知**：`chat.controller.ts` 在 click handler 同一個 task 內（任何 `await` 之前）就顯示 `#call-pending`、鎖住兩顆通話鍵。它不等 call chunk、不等 LiveKit、不等 callable。取消鍵在 call 尚未建立時直接放棄；已建立時走一般掛斷路徑，room lock 仍由 server 釋放。
- **實際**：`livekit-client`（約 139 kB gzip，全 app 最大的 chunk）的下載透過 `CallProvider.prepare()` 在 `startLiveKitCallV2` 之前啟動，並與 `getLiveKitTokenV2` 平行。它仍然只在真的要通話時才下載——**不得**改成 eager import，也不得進 signed-in core chunk，`scripts/check-bundle-budget.mjs` 的 forbidden-chunk 檢查會擋。

分段量測在 `src/calls/call-timing.ts`：`uiClicked → uiAcknowledged → modulesReady → callCreated → tokenReceived → sdkReady → providerConnected → mediaReady → serverConfirmed`。預設靜默，於瀏覽器 console 設定 `localStorage['chat-lite:call-timing'] = '1'` 後對該 session 生效，只輸出階段名稱與毫秒，不輸出任何 id、名稱、token 或 provider 回應。**任何 latency 變更都必須附上前後的分段數字**；沒有數字的就不是 latency fix。

### BEFORE 基準（2026-08-15，production，語音通話，PR #43 之前）

冷啟動 1 通、暖機 3 通，同一房間、同一 client、真實 LiveKit 與已部署的 callables。暖機欄為 3 通中位數。**這組數字是歷史基準，任何後續量測都以它為對照，不得覆寫。**

| 階段 | 冷啟動 | 暖機中位數 | 暖機佔比 | 歸屬 |
|---|---|---|---|---|
| uiClicked → uiAcknowledged | 0 ms | 0 ms | 0% | client |
| → modulesReady | 450 ms | 11 ms | 0.2% | client（chunk 載入） |
| → callCreated | 5937 ms | 864 ms | 17% | `startLiveKitCallV2` |
| → tokenReceived | 3566 ms | 724 ms | 14% | `getLiveKitTokenV2` |
| → sdkReady | **0 ms** | **0 ms** | **0%** | `livekit-client` 下載 |
| → providerConnected | 4168 ms | 1701 ms | 33% | LiveKit 協商 |
| → mediaReady | 1169 ms | 1177 ms | 23% | `getUserMedia` |
| → serverConfirmed | 3302 ms | 646 ms | 13% | `confirmLiveKitCall` |
| **總計** | **18613 ms** | **5101 ms** | | |

**Critical path**：不能只讀 log 順序。`CallProvider.prepare()` 讓 `livekit-client`（139 kB gzip）的下載與 `startLiveKitCallV2` + `getLiveKitTokenV2` 平行，四次量測的 `sdkReady` 全部是 **+0 ms** —— 也就是 SDK 早在 token 回來前就備妥，**完全不在 critical path 上**。這條最佳化已經做完，沒有剩餘空間。

三支 callable 合計佔冷啟動 **12805 ms（69%）**、暖機 **2234 ms（44%）**。`mediaReady` 的 1.2 秒在冷／暖幾乎不變（1169 / 1177 ms），符合裝置初始化而非網路的特徵。

### 修正：這些秒數不是 Functions 在算（2026-08-16，server 端對照）

2026-08-15 的結案把瓶頸歸給「Cloud Function 冷啟動」，並據此宣告 `MEASURED-BUT-NOT-CLIENT-FIXABLE`、不要再改 client。用 Cloud Logging 對**同一批請求**做 server 端對照後，這個歸因**冷啟動只有一部分成立，暖機完全不成立**。

每支 callable 都是獨立的 Cloud Run service，一次呼叫在 server 端留下兩筆紀錄：CORS preflight（`204`）與實際的 POST（`200`）。

暖機（2026-08-15T17:16–17:17Z，對應上表暖機中位數）：

| callable | preflight `204` | POST `200` | server 合計 | client 觀測 | 差額＝瀏覽器端 |
|---|---|---|---|---|---|
| `startLiveKitCallV2` | 2.7 ms | 73 ms | 76 ms | 864 ms | 788 ms（91%） |
| `getLiveKitTokenV2` | 3.3 ms | 51 ms | 54 ms | 724 ms | 670 ms（93%） |
| `confirmLiveKitCall` | 3.4 ms | 79 ms | 82 ms | 646 ms | 564 ms（87%） |
| **合計** | | | **212 ms** | **2234 ms** | **2022 ms（91%）** |

冷啟動（2026-08-15T17:15Z，對應上表冷啟動欄）：

| callable | preflight `204` | POST `200` | server 合計 | client 觀測 | 差額 |
|---|---|---|---|---|---|
| `startLiveKitCallV2` | 1941 ms | 409 ms | 2350 ms | 5937 ms | 3587 ms |
| `getLiveKitTokenV2` | 2145 ms | 333 ms | 2478 ms | 3566 ms | 1088 ms |
| `confirmLiveKitCall` | 2241 ms | 310 ms | 2551 ms | 3302 ms | 751 ms |
| **合計** | | | **7379 ms** | **12805 ms** | **5426 ms** |

三件事：

- **Function 自身的處理從來不是瓶頸。** POST handler 暖機 51–79 ms、冷啟動 310–409 ms，`jsonPayload.durationMs` 也一致（46–120 ms 暖）。這是數十到數百毫秒的量級，不是秒。
- **冷啟動確實存在，但它壓在 CORS preflight 上**（每支 1.9–2.2 秒），而且三支各自獨立冷啟。它佔 18613 ms 冷通話的 7379 ms，是 **40%**，說「主要」已經過頭，說「全部」是錯的。
- **暖機時 server 只佔 212 ms／2234 ms（9%）**，其餘 **91% 全在瀏覽器端**：每支 replay-sensitive callable 都要一枚新的 limited-use App Check token，而 session 內第一次取得時還得先載入 reCAPTCHA Enterprise 腳本並完成 handshake。

因此「後續若要再快……**不是**繼續改 client」這句是錯的，已作廢：真正可動的成本就在 client 這一側。PR #43 據此修正方向。

不得為了帳面數字把 `serverConfirmed` 移出使用者可見的連線判定 —— server-authoritative call state 是 invariant，不是 latency budget。這一條不因上面的修正而改變。

### PR #43 的三項架構調整（2026-08-16 部署）

1. **Inline transport grant。** `startLiveKitCallV2` 與 accepted 的 `respondLiveKitCall` 在回應中直接夾帶 LiveKit grant（`{url, token, expiresIn}`）。這兩支在回應前就已經確認呼叫者可以入房，所以再要求 client 打一次 `getLiveKitTokenV2` 是白付一次 round trip ——**以及一枚新的 limited-use App Check token**，而那正是上面量到的主要成本。grant 只在 lock 與 transition 都 commit 之後才鑄造，且鑄造失敗只降級為不夾帶（`grant: 'deferred'`），絕不讓 token 問題卡住一個已建立的 call。`getLiveKitTokenV2` **保留**，用於 legacy server、out-of-band 的 callee 加入、retry，以及鑄造失敗的 fallback。`isGrantableCallStatus` 擋掉 `ending`，避免發出比 call 活得久的 grant。publish sources 一律由 server 依 call kind 推導，語音通話拿不到 camera grant。
2. **App Check session warm-up。** `beginSession()` 一登入就以 dynamic import 起始 App Check，不再等第一支 callable 才觸發。原本第一個用到 Firebase 的功能要獨自付掉 reCAPTCHA Enterprise 腳本載入與 provider handshake，冷 session 通常就是通話鍵。enforcement 與 limited-use token 語意**完全未動**：`enforceAppCheck` / `consumeAppCheckToken` 仍掛在全部六支 RTC callable 上，client 仍每次送 `limitedUseAppCheckTokens: true`。warm-up 失敗只 swallow，不影響其他 UI。
3. **本地媒體與 LiveKit 協商平行化。** `createLocalTracks()` 與 `room.connect()` 同時進行，連上後才 `publishTrack`。`mediaReady` 標記在**發佈後**而非取得後，所以階段語意仍是「本地媒體已在通話中」，平行化的效果會表現為這個階段變短，而不是階段位移。取消時 `releaseCapture()` 不 await pending 的授權提示，但提示一旦結算就把 track `stop()` 掉，避免麥克風被留著。語音通話的 `video: false`，不會開相機。

### AFTER 量測（尚未取得）

**狀態：`PENDING-PRODUCTION-MEASUREMENT`。**

上述三項已於 2026-08-16 部署到 production（backend run `31953276095`、hosting run `31953496673`，皆為 `aa646ac`），但**尚未取得任何一組部署後的分段數字**。取得方式與 BEFORE 相同：

```text
localStorage['chat-lite:call-timing'] = '1'
```

重載後用兩個真實帳號、真實音訊裝置量測，最少 5 通暖機語音、1 通真正冷啟動語音、1 通視訊，逐階段記錄並與 BEFORE 表對照。

在拿到這組數字之前，下列都是**假設，不是結論**：

- 假設 1：inline grant 之後，`tokenReceived` 階段趨近 0 ms 或整段離開 critical path。
- 假設 2：App Check session warm-up 縮短 session 內第一通的瀏覽器端成本。
- 假設 3：媒體與協商平行化縮短 `providerConnected → mediaReady`。

**在量到之前不得寫「延遲已修好」。** 沒有數字的就不是 latency fix —— 這條規則對 #43 和對 #42 一視同仁。

## Staging smoke gate

正式部署前在受保護 staging 使用兩個真實帳號測：concurrent start、double click、caller media denial、callee join、remote already present、remote late join、reconnect、tab close、network loss、idempotent end、voice/video/screen share、320/390px mobile、App Check enforcement。確認 DOM 無殘留 call audio/video、Firestore 無永久 live call、Cloud Logging 不含 token 或完整聊天內容。

部署順序與 rollback 見 [MIGRATION](MIGRATION.md) 及 [FEATURE-ENABLEMENT](FEATURE-ENABLEMENT.md)。
