# UI Phase 3 — 重構計畫

> **範圍**：[TECH-DEBT](TECH-DEBT.md) 的 TD-U1、TD-U2、TD-U3、TD-U4。四項的「最早可處理」欄位皆為 `UI Phase 3`，依賴欄位皆為「UI 方案選定」。
> **建立日期**：2026-08-19
> **狀態**：計畫。尚未動工。

---

## 0. 動工前的前提

四項的依賴都是「UI 方案選定」。該依賴的解除條件是**幾何與動效有可引用的來源**，
而不是「決定要做哪一種風格」。目前的來源是 `chat-lite-linkframe-demo` 的兩份實測規格
（`SAO-ALERT-MEASURED-SPEC.md`、`SAO-MENU-MEASURED-SPEC.md`），它們由官方錄影逐幀量測而得，
並標明了哪些數值已驗證、哪些未定案。TD-U2 需要的 token 分層可以直接由這批數值填充。

**但要寫明兩件事**：該批規格只涵蓋 Alert 卡與 Tier 1／Tier 2 選單，
其餘元件（HUD、面板內部、輸入列）仍無實測依據；且那是另一個倉庫的原型，
不是本專案已採用的設計系統。本計畫因此**不預設任何視覺風格**，
只處理四項技術債本身的結構問題。

---

## 1. 登記簿數字的核對結果

動工前先把 TECH-DEBT 的四列與現況核對。**四列中有三列的數字與現況不符**，
且其中一項若照字面執行會造成損害。

| 登記內容 | 現況 | 判定 |
|---|---|---|
| TD-U1：`chat.controller.ts` 1470 行 | **1496 行** | 已再增長，債務仍在擴大 |
| TD-U1：拆為 4 個模組 | 檔案含 **10 個職責群集** | **覆蓋不足**，見第 2 節 |
| TD-U3：`#chat-heads` 68 行 CSS | style.css 中**僅 4 行** | 數字錯誤 |
| TD-U3：`#chat-heads` 為死碼 | **`index.html:148` 有實際 DOM** | **並非死碼**，見第 4 節 |
| TD-U3：`ring-pulse` 為共用不可刪 | **確有 4 條規則使用**（336／440／525／546） | 警告正確，必須遵守 |
| TD-U4：圖示 13 種 | **18 種、23 處** | 數字偏低 |
| TD-U4：全部改 inline SVG | 其中 **6 種是貼圖表情**，非 UI 圖示 | **照字面執行會破壞貼圖組**，見第 5 節 |

已核對且無誤者：`typing-chip`／`typing-dots`／`typing-label` 確為零引用；
`public/image/background.jpg` 與 `public/image/logo.png` 確為零引用；本專案確實尚無任何 inline SVG。

---

## 2. TD-U1：拆解 `chat.controller.ts`

### 現況

1496 行、73 個頂層函式、19 個 import，佔 `src` 全部 5627 行的 **27%**。
次大的檔案是 `src/calls/call-ui.controller.ts`（398 行）。

耦合指紋：**54 處 DOM 操作、41 個事件監聽、40 個訂閱**，全部集中在這一個檔案。

### 職責群集（依實際函式歸類）

| # | 群集 | 代表函式 |
|---|---|---|
| 1 | 訊息渲染與互動 | `renderMessage`／`renderMessageChanges`／`renderMessageActions`／`renderReactionBar`／`updateReactionBars`／`placeMessageRow`／`refreshMessagePositions`／`firstVisibleMessage`／`pinToEnd`／`applyMessageFilter`／`updateReadReceipts`／`messageReadCount`／`renderCallInvite`／`renderCallMessages`／`appendMentionText`／`textOf`／`watchVisibleReactions`／`reactionSignatures`／`loadOlder` |
| 2 | 輸入列 | `submitMessage`／`setReply`／`cancelReply`／`startEditing`／`cancelEditing`／`deleteMessage`／`updateComposer`／`updateMentionList`／`closeMentionList`／`insertMention` |
| 3 | AI 串流 | `streamGemini`／`renderRemoteDrafts`／`renderAiDraft` |
| 4 | 媒體與語音 | `getMediaController`／`runMediaUpload`／`toggleVoiceRecording`／`getVoiceController`／`runVoiceAction` |
| 5 | 通話 | `beginCall`／`joinCall`／`showCallPending`／`hideCallPending`／`cancelPendingCall`／`getCallController` |
| 6 | 房間與導航 | `renderRooms`／`selectRoom`／`openRoom`／`joinNamedRoom`／`closeRoom`／`roomUnread`／`handleRoomAccessError`／`setSidebar` |
| 7 | 在線與連線 | `renderPresenceList`／`watchMemberPresence`／`setPresence`／`applyConnectionState`／`armConnectionEscalation`／`renderConnectionStatus`／`pushConnection`／`failClosedRealtime`／`failClosedPresence` |
| 8 | Session 生命週期 | `beginSession`／`cleanupSession`／`configurePush`／`connectSessionPresence`／`watchSessionCalls`／`initializeChatController` |
| 9 | 搜尋 | `runHistoricalSearch` |
| 10 | 外殼與工具 | `byId`／`toast`／`errorText`／`setTheme`／`setRoomControls`／`showConfirm` |
| — | 事件綁定 | `bindEvents`（1351–1466，115 行） |

### 與登記簿拆法的落差

TD-U1 記載的四個模組（MessageRenderer／ComposerController／DrawerController／PresenceController）
只對應到群集 1、2、7。**群集 3、4、5、6、8、9 沒有歸屬**，照字面執行後控制器仍會留下可觀的殘餘，
達不到該列「各有明確 ownership」的驗收條件。

此外 `DrawerController` 的命名偏窄：群集 6 的主體是房間清單渲染與切換
（`renderRooms`／`openRoom`／`selectRoom`），不只是抽屜開合。

### 建議的拆法

| 模組 | 承接群集 | 備註 |
|---|---|---|
| `MessageRenderer` | 1 | 最大的一群，單獨成模組已足夠 |
| `ComposerController` | 2、3 | AI 串流的產出進入同一個輸入／訊息流 |
| `MediaController` | 4 | 已有 `media-upload.controller`／`voice-message.controller`，此處只是轉接層，可能可併入 2 |
| `CallController` | 5 | 已有 `call-ui.controller`（398 行），此處同為轉接層 |
| `RoomController` | 6 | 取代登記簿的 `DrawerController` |
| `PresenceController` | 7 | 與登記簿一致 |
| `SessionController` | 8 | 生命週期與訂閱擁有權的收斂點 |
| （保留於 controller） | 9、10、bindEvents | 搜尋僅 1 函式；外殼為共用工具 |

**先確認再動工**：群集 4 與 5 是否值得獨立成模組，取決於它們扣掉轉接樣板後的實際份量。
動工前應先量這兩群的行數，若各自不足百行則併入相鄰模組，避免製造一層只有轉接功能的空殼。

### 驗收

* 每個模組有明確 ownership，不互相反向依賴
* `chat.controller.ts` 僅保留組裝與共用工具
* 54 處 DOM 操作、41 個監聽、40 個訂閱各自落在其擁有者模組內
* 既有測試全綠；訂閱的建立與清除在 session 切換時行為不變

---

## 3. TD-U2：`src/style.css` 分層

### 現況

600 行、12 個 `@media`、三層 append-only 疊加：

| 起始行 | 層 |
|---|---|
| 1 | 初版 |
| 14 | `2026 UI refinement layer` |
| 523 | `Chat Lite 3.0 feature surfaces` |

重複選擇器（次數）：`.message-row` ×11、`.setting-row` ×7、`.auth-view` ×7、
`.app-shell` ×6、`.typing-dots` ×4、`.room-item` ×4、`.presence-avatar` ×4、`.message-actions` ×4。

### 建議分層

```
tokens.css    色彩、間距、字級、緩動曲線、z-index
base.css      reset、元素預設、字體
layout.css    app-shell、sidebar、message-view、composer 的骨架
components.css 各元件
utilities.css  少量共用修飾
```

`@media` 收斂到各層內部，不重複宣告同一組斷點。

### 驗收

* 無重複選擇器（可由腳本檢查，比照 `scripts/index-contract.mjs` 的做法納入 `pnpm test:unit`）
* `.call-video` 只定義一次
* 視覺回歸：改版前後截圖比對無非預期差異

---

## 4. TD-U3：死碼清除

### 修正登記內容

| 項目 | 登記 | 實況 | 處置 |
|---|---|---|---|
| `#chat-heads` | 68 行 CSS、死碼 | style.css **4 行**；`index.html:148` 有 DOM（`hidden` 空 div） | **不可只刪 CSS**。需先確認該功能是否放棄；若放棄則 CSS 與 DOM 一併移除 |
| `.typing-chip`／`.typing-dots`／`.typing-label` | 死碼 | 零引用，確認為死碼 | 可刪 |
| `background.jpg`／`logo.png` | 未使用 | 零引用，確認 | 可刪 |
| `@keyframes ring-pulse` | 共用，不可刪 | **4 條規則使用**（336／440／525／546） | 遵守，不可刪 |

`#chat-heads` 的 DOM 是 `role="group" aria-label="未讀訊息懸浮氣泡"` 的空容器且帶 `hidden`。
它是「功能未啟用」還是「功能已放棄」，登記簿沒有記載，**動工前需要一個決定**。

---

## 5. TD-U4：圖示改 inline SVG

### 清點結果

`index.html` 共 **18 種非 ASCII 字形、23 處**（登記記為 13 種）。但需分成兩類：

**UI 圖示（12 種，應改 SVG）**

| 碼位 | 次數 | 名稱 |
|---|---|---|
| U+00D7 | 4 | MULTIPLICATION SIGN |
| U+FF0B | 3 | FULLWIDTH PLUS SIGN |
| U+2630 | 1 | TRIGRAM FOR HEAVEN |
| U+260E | 1 | BLACK TELEPHONE |
| U+25A3 | 1 | WHITE SQUARE CONTAINING BLACK SMALL SQUARE |
| U+2315 | 1 | TELEPHONE RECORDER |
| U+25CE | 1 | BULLSEYE |
| U+2726 | 1 | BLACK FOUR POINTED STAR |
| U+25CF | 1 | BLACK CIRCLE |
| U+263A | 1 | WHITE SMILING FACE |
| U+27A4 | 1 | BLACK RIGHTWARDS ARROWHEAD |
| U+21AA | 1 | RIGHTWARDS ARROW WITH HOOK |

**貼圖表情（6 種，不可改）**

U+1F44B、U+1F499、U+1F602、U+1F389、U+1F44D、U+2615。

這六個是預設貼圖組的**內容**，不是介面圖示。TD-U4 字面寫「圖示全為平台 Unicode 字形（13 種）
→ 改為 inline SVG」，若不作區分而全數轉換，會把貼圖組一併改掉。**本列的驗收條件應補上這個例外。**

### 驗收

* 12 個 UI 圖示改為 inline SVG，`aria-label` 維持現狀（登記簿既有條件）
* 6 個貼圖表情維持 Unicode 不變
* 各作業系統渲染尺寸一致（該列的原始動機）

---

## 6. 建議順序

1. **TD-U3**（最小、最獨立）——但先取得 `#chat-heads` 的去留決定
2. **TD-U2**——分層後才有穩定的 token 與選擇器基礎
3. **TD-U4**——圖示改 SVG 會動到 markup，宜在 CSS 分層之後
4. **TD-U1**——最大且風險最高，放最後，且應逐模組分次進行而非一次拆完

TD-U1 與 TD-U2 互相牽動（拆模組會移動 markup，影響選擇器），
但兩者不宜合併於同一次變更——那會讓回歸難以歸因。

---

## 7. 動工前待決事項

| # | 事項 | 需要誰決定 |
|---|---|---|
| 1 | `#chat-heads` 是未啟用還是已放棄 | 專案擁有者 |
| 2 | 群集 4（媒體語音）與 5（通話）是否獨立成模組 | 動工前先量行數再定 |
| 3 | 是否更新 TECH-DEBT 的 TD-U1／U3／U4 三列以反映實況 | 建議更新，否則後續接手者仍會照錯誤數字執行 |
