# Chat Lite 動效規範

這份文件是**規範**，不是稽核紀錄。它描述動效必須遵守什麼、為什麼，以及哪一個 gate 會在違反時失敗。

- 視覺語言（幾何、色彩、版面）在 [SAO-UI](SAO-UI.md)。
- 一次性的稽核與分批計畫在 [UI-EVOLUTION](UI-EVOLUTION.md)。
- 本檔的規則由 `tests/motion-contract.test.ts` 強制，屬 `pnpm test:unit`。

> **2026-08-26 全文重寫。** 上一版寫於 2026-08-11，稽核對象是 `src/style.css`（PR #57 已拆解，不存在），列舉的八個 keyframes 現在一個都不存在，其中 `chat-head-ping` 甚至連功能都已於 PR #56 移除。它描述的是一套被整個換掉的樣式表，因此不是修正而是重寫。TD-D1 隨此關閉。

---

## 1. 只動 `transform` 與 `opacity`

瀏覽器只有這兩個屬性能完全交給 compositor 執行緒處理，不觸發 layout 或 paint。動任何其他屬性都會把工作推回主執行緒——而主執行緒同時要負責回應使用者輸入。

具體代價是可量的：INP（Interaction to Next Paint）的「良好」門檻是 **200 ms**，而每一幀的 paint 都從同一份預算裡扣。

**不可用於 keyframes 的常見屬性**：`filter`、`clip-path`、`box-shadow`、`background-position`、`width`／`height`、`top`／`left`。要相同的視覺效果，改用疊層的 `opacity` 或 `transform`。

**強制方式**：`tests/motion-contract.test.ts` 解析 `src/styles/*.css` 的每一個 `@keyframes`，出現白名單之外的屬性即失敗。該測試同時斷言「有找到 keyframes」，避免解析失敗時假性通過。

*來源*：[web.dev — high-performance CSS animations](https://web.dev/articles/animations-guide)、[web.dev — Why are some animations slow?](https://web.dev/articles/animations-overview)、[web.dev — Stick to compositor-only properties](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count)、[web.dev — INP](https://web.dev/articles/inp)、[MDN — Performance fundamentals](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Fundamentals)

## 2. `will-change` 要有量到的理由才加

官方建議是 sparingly，且只在確實遇到效能問題之後。長期掛著會強迫瀏覽器維持額外的合成層，記憶體成本是實的。

**目前全 repo 零使用，這是正確狀態。** 要加之前先量，並把量到的數字寫進 PR。

*來源*：[MDN — `will-change`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/will-change)、[web.dev — Stick to compositor-only properties](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count)

## 3. 時長落在 100–500 ms

0.1 秒是使用者感覺「直接操作」的上限；超過就會被察覺為延遲。另一端，非必要的動效超過半秒會開始擋路。

現有 token（`src/styles/tokens.css`）全部落在區間內：

```
--dur-1: 120ms   即時回饋（狀態點、開關）
--dur-2: 180ms   列與訊息的顯現
--dur-3: 200ms   Alert 兩階段合計的目標
--dur-4: 240ms   面板
--dur-5: 320ms   最大；保留給少數需要節奏的時刻
```

曲線：

```
--ease-standard: cubic-bezier(.2,0,0,1)        狀態變化
--ease-panel:    cubic-bezier(.51,.78,.40,.99) SAO Alert 第二階段的實測近似
--ease-spring:   cubic-bezier(.2,.9,.3,1)      需要一點過衝的時刻
```

**進場用減速、出場用加速**，且出場短於進場——出場沒有資訊要傳達，只需要交代「東西走了」。

*來源*：[NN/g — Response Time Limits](https://www.nngroup.com/articles/response-times-3-important-limits/)、[Material Design 3 — Easing and duration](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)、[Material Design 3 — Applying transitions](https://m3.material.io/styles/motion/transitions/applying-transitions)、[IBM Carbon — Motion](https://carbondesignsystem.com/elements/motion/overview/)

## 4. `prefers-reduced-motion` 是必須，不是加分

WCAG 2.2 的 SC 2.3.3 要求由互動觸發的動作可被關閉，除非該動作是功能本身所必需；SC 2.2.2 另外要求超過五秒的自動動作可暫停。前庭系統疾患的反應包含暈眩、噁心與頭痛，而**縮放、旋轉與視差是最常被點名的觸發**。

本專案的 `alert-card-open` 正是一個縮放動畫（`scale(.5,.45)` → `scale(1)`）。它忠實還原實測的 SAO 開窗，也正好落在文獻點名的類型裡——**全域覆蓋是它可以留下來的唯一理由**。

規範：

- 覆蓋必須同時涵蓋 `*`、`*::before`、`*::after`。`status-ring` 與 `pending-sheen` 都掛在 `::after` 上，只選 `*` 會讓它們繼續轉。
- 必須同時壓制 `animation-duration` 與 `transition-duration`，並把 `animation-iteration-count` 設為 1。
- 每一條宣告都要 `!important`，否則任何更具體的選擇器都能蓋過去。
- **動作停掉，但狀態改變仍須看得見**：時長縮到近零而不是 `display:none`。

**強制方式**：`tests/motion-contract.test.ts` 對以上四點各有一則斷言。刪除或縮小該區塊會失敗。

*來源*：[WCAG 2.2 SC 2.3.3](https://www.w3.org/TR/WCAG22/#animation-from-interactions)、[Understanding SC 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)、[Understanding SC 2.2.2](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html)、[技術 C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)、[MDN — `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)、[Apple — Reduced Motion evaluation criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria/)、[A11Y Project — 前庭疾患入門](https://www.a11yproject.com/posts/understanding-vestibular-disorders/)

## 5. 進場動畫屬於「元素第一次出現」，不屬於「每次渲染」

這條沒有單一外部出處，是把前四條套進本專案架構得到的，而它有本地證據。

房間清單原本每次渲染都 `replaceChildren()` 重建，而 `.room-item` 帶著進場動畫，`render()` 又位於 `watchAvailableRooms` 訂閱裡——結果是**任何房間收到訊息，整份側邊欄都會閃一次**（UI M1 已修）。

規範：**任何帶進場動畫的清單，都必須以鍵值差異更新**。已經在正確位置的節點不得移動或重新插入，因為重新插入就會重播動畫。

`.claude/rules/client.md` 對訊息列已有同樣的規則（keyed by `data-message-id`）。房間清單現在也是。

**強制方式**：`tests/room-view.test.ts` 以 `toBe` 斷言節點同一性。`toEqual` 在全量重建下也會通過，因此不可用。

## 6. 交錯（stagger）

SAO 實測適配值是 **32 ms／列**，由上而下。

CSS 目前沒有可安全依賴的計數式延遲，所以階梯是用 `nth-child` 列舉的。**列舉一定要有收尾**：原本只寫到第 8 列，第 9 個房間會與第 1 列同時出現。現在第 9 列之後一律停在上限，這同時避免長清單拖尾。

**強制方式**：`tests/motion-contract.test.ts` 斷言存在 `nth-child(n+N)` 的收尾規則。

## 7. 目前的 keyframes

七個，全部合規（`src/styles/components.css`）：

| Keyframe | 動的屬性 | 用途 |
|---|---|---|
| `tier-two-reveal` | `opacity` | 房間列顯現 |
| `alert-card-open` | `transform`、`opacity` | SAO 兩階段開窗 |
| `message-enter` | `transform`、`opacity` | 新訊息 |
| `toast-enter` | `transform`、`opacity` | 通知 |
| `pending-sheen` | `transform` | 待送出泡泡（infinite） |
| `ai-cursor` | `opacity` | AI 串流游標（infinite） |
| `status-ring` | `transform`、`opacity` | 在線點、錄音鍵（infinite） |

三個 infinite 動畫全部只動合成屬性，且都被 reduced-motion 覆蓋停下。

## 8. 尚未採用，以及為什麼

- **View Transitions API**。跨文件轉場已在 Chrome 126＋與 Safari 18.2 支援，Firefox 144 跟上，並列入 Interop 2026。技術上可用，但本專案是單頁應用，房間切換不是導覽；同文件 view transition 會需要重新設計訊息列的 keyed rendering，而那正是 TD-U1 尚未收斂的區域。等 TD-U1 的狀態歸屬決定之後再評估。
- **Scroll-driven animations**。訊息列有「不得重建、不得掉捲動位置」的硬規則，捲動驅動動畫會讓那件事更難推理。
- **出場動畫**。目前所有關閉都是直接消失。這是 [UI-EVOLUTION](UI-EVOLUTION.md) 的 M4，尚未實作；`--ease-exit` 也還不存在。

*來源*：[MDN — View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API)、[Chrome — Smooth transitions with the View Transition API](https://developer.chrome.com/docs/web-platform/view-transitions)、[WebKit — Interop 2026](https://webkit.org/blog/17818/announcing-interop-2026/)

## 9. 改動動效時要跑什麼

```bash
pnpm test:unit      # 含 motion-contract 與 room-view 的節點同一性
pnpm lint
pnpm build          # 核心 bundle 預算 210 kB gzip
pnpm test:e2e       # 九個寬度、light／dark、reduced motion、axe
```

視覺回歸沒有終端可跑的等價 gate。`pnpm test:e2e` 檢查結構與 axe，不比對像素；動效的「看起來對不對」目前只能由人在真實裝置上判斷，這是既有限制，不是疏漏。
