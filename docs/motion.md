# Chat Lite 動效規範

目標：高科技感、有儀式感，但不犧牲效能與可及性。

## 依據

- **web.dev**：瀏覽器只有 `transform` 和 `opacity` 兩個屬性能純由 compositor 處理。動任何其他屬性都會觸發 layout 或 paint，難以維持 60fps。`will-change` 只在確實遇到效能問題時才用。
- **NN/g**：非必要動效應落在 **100–500ms**。0.1 秒是使用者感覺「直接操作」的上限。
- **Material Design 3**：進場用 emphasized decelerate、出場用 emphasized accelerate；動效應有階層與節奏，不是所有元素同時animate。

## 現況稽核

檔案 `src/style.css`。以下是實際違反上述原則的地方：

| 動畫 | 動的屬性 | 頻率 | 問題 |
|---|---|---|---|
| `conversation-background-drift` | `background-position` | **34s 無限循環** | 全 App 最大的元素，背景是 cover 尺寸的圖，每一幀都在 paint。最嚴重。 |
| `pending-shimmer` | `background-position` | 1.6s 無限 | 每顆待送出的泡泡都在 paint |
| `status-pulse` | `box-shadow` | 2.4s 無限 | paint |
| `chat-head-ping` | `box-shadow` | 2.2s 無限 | paint |
| `auth-card-enter` | 含 `filter:blur(6px)` | 一次性 720ms | `filter` 昂貴；720ms 超出 100–500ms 區間 |
| `.message-actions button` | `backdrop-filter:blur(8px)` | 常駐 | 訊息列表裡會有大量實例 |

合格的（動 transform/opacity，維持不動）：`orb-drift`、`brand-float`、`typing-bounce`、`message-enter`、`panel-enter-*`、`chat-head-pop`。

## 做法

### 1. 動效 token

把時間與曲線收斂成 CSS 變數，全檔一處可調。曲線採 M3 的值：

```
--ease-emphasized-decel: cubic-bezier(.05,.7,.1,1)   進場
--ease-emphasized-accel: cubic-bezier(.3,0,.8,.15)   出場
--ease-standard:         cubic-bezier(.2,0,0,1)      狀態變化
--ease-spring:           cubic-bezier(.2,1.25,.4,1)  儀式感的過衝
--dur-1..5: 120 / 180 / 260 / 360 / 480ms            全在 NN/g 區間內
```

### 2. 把 paint 動畫改寫成 compositor 動畫

效果保留，換成偽元素 + `transform`：

- **背景漂移**：圖移到 `.conversation::before`（`position:absolute; z-index:-1`，父層 `isolation:isolate`，沿用 `.auth-view::before` 既有模式），改動 `transform: scale()+translate()`。
- **待送出微光**：`::after` 疊層 + `translateX()`。
- **在線脈衝 / 未讀脈衝**：`::after` 圓環 + `scale()` + `opacity`，取代 `box-shadow` 擴散。

### 3. 儀式感 = 編排，不是加更多動畫

登入後三個面板依 sidebar → conversation → presence 的順序錯開進場（0 / 60 / 120ms），全部用 emphasized decelerate。訊息列表逐則錯開但上限很低，避免長列表拖尾。

### 4. 收斂

`auth-card-enter` 拿掉 `filter`，縮到 480ms。`.message-actions button` 拿掉 `backdrop-filter`。

### 5. 可及性

`prefers-reduced-motion: reduce` 既有的全域覆蓋保留（`animation-duration:.01ms`、`animation-iteration-count:1`），確保所有無限動畫在該設定下完全停止。
