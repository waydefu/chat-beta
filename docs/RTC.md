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

### 實測結果（2026-08-15，production，語音通話）

冷啟動 1 通、暖機 3 通，同一房間、同一 client、真實 LiveKit 與已部署的 callables。暖機欄為 3 通中位數。

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

三支 callable 合計佔冷啟動 **12805 ms（69%）**、暖機 **2234 ms（44%）**。client 端自身只有 `modulesReady` 的 11–450 ms，即 **0.2%–2.4%**。

**TD-C1 結案：`MEASURED-BUT-NOT-CLIENT-FIXABLE`。** 主要瓶頸是 Cloud Function 冷啟動與 provider／媒體裝置，不在 client。後續若要再快，方向是 Functions 的 min instances、App Check 驗證成本與 region 延遲，**不是**繼續改 client。不得為了帳面數字把 `serverConfirmed` 移出使用者可見的連線判定 —— server-authoritative call state 是 invariant。

`mediaReady` 的 1.2 秒在冷／暖幾乎不變（1169 / 1177 ms），符合裝置初始化而非網路的特徵；視訊未單獨量測。

## Staging smoke gate

正式部署前在受保護 staging 使用兩個真實帳號測：concurrent start、double click、caller media denial、callee join、remote already present、remote late join、reconnect、tab close、network loss、idempotent end、voice/video/screen share、320/390px mobile、App Check enforcement。確認 DOM 無殘留 call audio/video、Firestore 無永久 live call、Cloud Logging 不含 token 或完整聊天內容。

部署順序與 rollback 見 [MIGRATION](MIGRATION.md) 及 [FEATURE-ENABLEMENT](FEATURE-ENABLEMENT.md)。
