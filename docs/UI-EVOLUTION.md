# UI 超進化規劃書 — 動效系統

> **建立日期**：2026-08-26
> **範圍**：`src/styles/`、`src/rooms/room.view.ts`、`docs/motion.md`
> **不在範圍**：視覺語言。SAO 幾何、色彩與版面已由 [SAO-UI](SAO-UI.md) 定案並上線（PR #65），本文件不改動任何一項；它處理的是**這套視覺如何動起來**。

---

## 0. 為什麼是動效，而不是「再改一次視覺」

`docs/motion.md` 寫於 2026-08-11，此後發生三件事讓它整份失效：

| motion.md 的內容 | 現況 |
|---|---|
| 稽核對象是 `src/style.css` | 該檔已於 PR #57 拆成 `src/styles/` 五個檔案，不存在 |
| 稽核表列出 `chat-head-ping` | 該功能於 PR #56 連同 DOM 一併刪除 |
| 稽核表列出 `conversation-background-drift`、`auth-card-enter`、`orb-drift`、`brand-float`、`typing-bounce` | 這五個 keyframes 目前**一個都不存在** |
| 「合格的」清單列出 `panel-enter-*`、`chat-head-pop` | 同樣不存在 |

也就是說，這份文件描述的是一套已經被整個換掉的樣式表。它同時也是 TD-D1 登記的那個錯誤引用（`chat-head-ping` 實際為 `chat-head-pop`）的來源——但那條登記已經追不上現實：兩個名字現在都不存在。

**因此本規劃書的第一個產出是重新稽核**，而不是沿用任何既有敘述。

---

## 1. 現況稽核（2026-08-26，對 `06a4064`）

八個 keyframes，全部定義在 `src/styles/components.css:188-195`。逐一對照「只動 `transform` 與 `opacity`」這條規則：

| Keyframe | 動的屬性 | 合規 | 用在哪 | 頻率 |
|---|---|---|---|---|
| `tier-two-reveal` | `opacity`、**`filter: brightness()`** | ✗ 觸發 paint | `.room-item`（每一列房間） | 每次房間清單渲染 |
| `tier-three-open` | `opacity`、**`clip-path`** | ✗ 觸發 paint | `.presence-panel.open`（≤1050px） | 每次開成員面板 |
| `alert-card-open` | `transform`、`opacity` | ✓ | Alert 卡 | 每次開對話框 |
| `message-enter` | `transform`、`opacity` | ✓ | `.message-row` | 每則新訊息 |
| `toast-enter` | `transform`、`opacity` | ✓ | Toast | 每則通知 |
| `pending-sheen` | `transform` | ✓ | 待送出泡泡 | **infinite** |
| `ai-cursor` | `opacity` | ✓ | AI 串流游標 | **infinite** |
| `status-ring` | `transform`、`opacity` | ✓ | 在線點、錄音鍵 | **infinite** |

八個裡有六個已經合規。這比 motion.md 描述的舊狀態好得多——SAO 那次改版順手修掉了大部分 paint 動畫。**剩下兩個不合規的，正好都在最常出現的互動路徑上。**

### 1.1 最嚴重的一項：房間清單每次更新都整份重播進場動畫

這不是效能顧慮，是**使用者看得到的缺陷**。

`src/rooms/room.view.ts:40` 的 `render()` 第一行是 `deps.list.replaceChildren()`，整份清單先清空再重建。而 `.room-item` 帶著 `animation: tier-two-reveal var(--dur-2) linear both`（`components.css:29`），所以**每一個新建的 `<button>` 都會重新播一次進場動畫**。

`render()` 的三個呼叫點中，`chat.controller.ts:1051` 位於 `watchAvailableRooms` 的訂閱回呼裡——那是一條活的 Firestore 訂閱。任何房間的 `lastMessage`、未讀狀態或成員資格變動都會觸發它。

**結果**：別人在**任何**一個房間送出一則訊息，你的整份側邊欄會閃一次。每一列都從 `opacity:.18` ＋ `brightness(1.35)` 重新亮起。而因為動的是 `filter`，這一閃在每一列上都是完整的 paint。

`.claude/rules/client.md` 已經有一條「Never rebuild the message list」——同樣的失效模式套在房間清單上，只是規則沒寫到它，而且加上動畫之後後果更明顯。

### 1.2 交錯延遲寫死到第 8 列

`components.css:32` 以 `nth-child(2)` 到 `nth-child(8)` 硬寫了 32ms 遞增的 `animation-delay`。32ms/列來自 [SAO-UI](SAO-UI.md) 的實測適配值，數字本身沒問題；問題是**第 9 列之後沒有延遲**，會與第 1 列同時出現。房間數超過 8 就會看到節奏斷掉。

### 1.3 token 缺一整類

`tokens.css:48-55` 有五個時長與三條曲線：

```
--dur-1..5: 120 / 180 / 200 / 240 / 320ms
--ease-standard: cubic-bezier(.2,0,0,1)
--ease-panel:    cubic-bezier(.51,.78,.40,.99)
--ease-spring:   cubic-bezier(.2,.9,.3,1)
```

五個時長全部落在 100–500ms 之間，符合可用性文獻的建議區間。`--ease-panel` 是 SAO Alert 第二階段的實測近似值，有來源。

**缺的是出場曲線。** 三條曲線都是進場或狀態變化用的；沒有任何一條是加速離場。目前所有關閉動作（面板收起、對話框關閉、toast 消失）都沒有動畫，直接消失——這在「進場很講究、離場很突兀」之間造成不對稱。

### 1.4 reduced motion：做對了，但只有一半

`components.css:229-231` 有全域覆蓋，把 `animation-duration`、`transition-duration` 壓到 `.01ms`，`animation-iteration-count` 設 1。這正是 WCAG 技術文件 C39 描述的做法，而且用 `!important` ＋ `*` 確保無法被個別規則繞過。

**但沒有任何測試釘住它。** e2e 有跑 reduced-motion（PR #65 的紀錄），但那是視覺與 axe 檢查；沒有任何斷言說「這個宣告存在且涵蓋 `*::before`/`*::after`」。刪掉這三行，CI 不會有任何反應。

---

## 2. 依據：權威來源

以下 35 筆全部為標準組織、瀏覽器廠商、平台官方設計系統，或具名的可用性研究機構。分類列出，實際引用處在第 3 節。

### 2.1 標準與無障礙規範（W3C / WAI）

1. [WCAG 2.2 — Success Criterion 2.3.3 Animation from Interactions](https://www.w3.org/TR/WCAG22/#animation-from-interactions)
2. [Understanding SC 2.3.3: Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
3. [Understanding SC 2.2.2: Pause, Stop, Hide](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html)
4. [C39: Using the CSS prefers-reduced-motion query to prevent motion](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)
5. [SCR40: Using prefers-reduced-motion in JavaScript to prevent motion](https://www.w3.org/WAI/WCAG21/Techniques/client-side-script/SCR40)
6. [WCAG WG wiki — Animation caused by user interaction](https://www.w3.org/WAI/GL/wiki/Animation_caused_by_user_interaction)
7. [WCAG working example — Motion triggered by user interaction](https://www.w3.org/WAI/WCAG22/working-examples/css-reduced-motion-query/)

### 2.2 瀏覽器廠商工程文件

8. [web.dev — How to create high-performance CSS animations](https://web.dev/articles/animations-guide)
9. [web.dev — Why are some animations slow?](https://web.dev/articles/animations-overview)
10. [web.dev — Animations and performance](https://web.dev/articles/animations-and-performance)
11. [web.dev — Stick to compositor-only properties and manage layer count](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count)
12. [web.dev — Interaction to Next Paint (INP)](https://web.dev/articles/inp)
13. [web.dev — Optimize Interaction to Next Paint](https://web.dev/articles/optimize-inp)
14. [web.dev — How the Core Web Vitals thresholds were defined](https://web.dev/articles/defining-core-web-vitals-thresholds)
15. [MDN — `will-change`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/will-change)
16. [MDN — Performance fundamentals](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Fundamentals)
17. [MDN — `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
18. [MDN — Using media queries for accessibility](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Using_for_accessibility)
19. [MDN — Using CSS transitions](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Transitions/Using)
20. [MDN — `@starting-style`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@starting-style)
21. [MDN — `transition-behavior`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transition-behavior)
22. [MDN — View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API)
23. [MDN — CSS view transitions](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/View_transitions)
24. [Chrome for Developers — Smooth transitions with the View Transition API](https://developer.chrome.com/docs/web-platform/view-transitions)
25. [Chrome for Developers — What's new in view transitions (2025 update)](https://developer.chrome.com/blog/view-transitions-in-2025)
26. [WebKit — Announcing Interop 2026](https://webkit.org/blog/17818/announcing-interop-2026/)

### 2.3 平台與企業設計系統

27. [Material Design 3 — Easing and duration tokens & specs](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)
28. [Material Design 3 — Motion overview specs](https://m3.material.io/styles/motion/overview/specs)
29. [Material Design 3 — Applying transitions](https://m3.material.io/styles/motion/transitions/applying-transitions)
30. [Apple Human Interface Guidelines — Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
31. [Apple — Reduced Motion evaluation criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria/)
32. [IBM Carbon Design System — Motion](https://carbondesignsystem.com/elements/motion/overview/)

### 2.4 可用性研究與無障礙實務

33. [NN/g — Response Time Limits: Article by Jakob Nielsen](https://www.nngroup.com/articles/response-times-3-important-limits/)
34. [NN/g — Progress Indicators Make a Slow System Less Insufferable](https://www.nngroup.com/articles/progress-indicators/)
35. [The A11Y Project — A primer to vestibular disorders](https://www.a11yproject.com/posts/understanding-vestibular-disorders/)

補充實務參考（非計數內）：[A11Y Project — Designing accessible animation](https://www.a11yproject.com/posts/design-accessible-animation/)、[Smashing Magazine — Designing With Reduced Motion For Motion Sensitivities](https://www.smashingmagazine.com/2020/09/design-reduced-motion-sensitivities/)、[NN/g — When UX Is Too Fast](https://www.nngroup.com/articles/too-fast-ux/)。

---

## 3. 從來源推導出的五條規則

規則只有在能指出「違反它會怎樣」時才寫進來。

### 規則 1 — 只動 `transform` 與 `opacity`

瀏覽器只有這兩個屬性能完全交給 compositor 執行緒，不經過 layout 或 paint（來源 8、9、10、11、16）。動其他屬性會把工作推回主執行緒，而主執行緒同時要處理輸入事件。

**違反的後果在本專案是可量的**：INP 的「良好」門檻是 200ms（來源 12、14），而主執行緒上的 paint 會直接吃掉這個預算。目前 `.room-item` 的 `filter` 動畫會在每一列上觸發 paint，而房間清單會因為別人送訊息而重播。

**處置**：`tier-two-reveal` 的 `filter: brightness()` 換成疊在 `::after` 上的一層純 `opacity` 亮光；`tier-three-open` 的 `clip-path` 換成 `transform: scaleY()` ＋ `transform-origin: bottom`。兩者視覺結果等價，但都退回 compositor。

### 規則 2 — `will-change` 只在量到問題之後才用

明確的官方建議是「sparingly，只在遇到效能問題時」（來源 15、11）。長期掛在元素上會強迫瀏覽器維持額外的合成層，記憶體成本是實的。

**處置**：本次不新增任何 `will-change`。目前全 repo 零使用，這是正確狀態，寫進規範避免日後有人「順手加上」。

### 規則 3 — 時長落在 100–500ms，且進場慢於出場

0.1 秒是使用者感覺「直接操作」的上限（來源 33）。M3 的指引是進場用 decelerate、出場用 accelerate（來源 27、29），Carbon 用 productive／expressive 兩套時長表達同一件事：日常操作要快到不擋路，重要時刻才給節奏（來源 32）。

**處置**：保留現有五個時長（全部在區間內），**補上出場曲線** `--ease-exit`，並規定出場時長比對應的進場短一階。

### 規則 4 — reduced motion 要停掉動作，但不能停掉「狀態改變看得見」

WCAG 2.3.3 要求由互動觸發的動作可被關閉，除非該動作是功能本身所必需（來源 1、2）。2.2.2 另外要求超過五秒的自動動作可暫停（來源 3）。前庭系統疾患的反應包含暈眩、噁心與頭痛，而**縮放與旋轉是最常見的觸發**（來源 35、2）。

值得注意的是 `alert-card-open` 正是一個縮放動畫（`scale(.5,.45)` → `scale(1)`）。它忠實還原了實測的 SAO 開窗，但它也正是文獻點名的那一類。全域覆蓋已經涵蓋它，這條規則要確保那層覆蓋不會被誰不小心刪掉。

**處置**：把全域覆蓋**變成機器可檢查的**——新增一個單元測試直接讀 `components.css`，斷言該 media query 存在、涵蓋 `*`、`*::before`、`*::after`，且同時壓制 `animation-duration` 與 `transition-duration`。刪掉它就會有測試失敗。

### 規則 5 — 進場動畫屬於「元素第一次出現」，不屬於「每次渲染」

這條沒有單一出處，是把規則 1 與 3 套進本專案架構得到的結論，而 §1.1 的稽核給了它證據。

**處置**：房間清單改為以 `data-room-id` 做鍵的差異更新，沿用訊息列已經在用的同一套做法（`.claude/rules/client.md` 的第五條）。只有真正新增的列才會建立節點，因此只有它們會播進場動畫。

---

## 4. 分批實作

一批一個 PR，一個 PR 一個回滾邊界。

| 批次 | 內容 | 為何獨立 | 驗收 |
|---|---|---|---|
| **M1** | 房間清單改鍵值差異更新 | 這是**行為**修正，與樣式無關，必須能單獨回滾 | 新增 `tests/room-view.test.ts` 案例：同一份資料重渲染後，DOM 節點必須是同一個物件（`toBe`），且不得重新建立 |
| **M2** | `tier-two-reveal` 去 `filter`、`tier-three-open` 去 `clip-path` | 純樣式，視覺等價 | 兩個 keyframes 只剩 `transform`／`opacity`；新增機器檢查 |
| **M3** | 交錯延遲改用 CSS 變數 ＋ 上限，移除 `nth-child` 硬寫 | 同上，但會動到選擇器 | 第 9 列之後仍有節奏；`--stagger-max` 之後不再累加，避免長清單拖尾 |
| **M4** | 補 `--ease-exit`，關閉動作接上出場動畫 | 新增行為（原本無動畫） | 面板、對話框、toast 關閉時有出場；reduced motion 下維持立即消失 |
| **M5** | reduced-motion 契約測試 ＋ 動效機器檢查 | 測試與 gate，獨立於任何視覺變更 | 刪掉 reduced-motion 區塊或在 keyframe 引入非合成屬性，`pnpm test:unit` 必須失敗 |
| **M6** | 重寫 `docs/motion.md` | 文件 | 內容對得上 `src/styles/`；TD-D1 隨之關閉 |

### 刻意不做的事

- **View Transitions API**（來源 22–26）。跨文件轉場已在 Chrome 126＋與 Safari 18.2 支援，Firefox 144 跟上，且列入 Interop 2026。技術上可用，但本專案是單頁應用，房間切換不是導覽；同文件 view transition 會需要重新設計訊息列的 keyed rendering，而那正是 TD-U1 尚未收斂的區域。**等 TD-U1 的狀態歸屬決定之後再評估**，現在動會與那件事互相踩。
- **Scroll-driven animations**。訊息列是虛擬捲動的候選區域，加上捲動驅動動畫會讓捲動位置的保持更難推理，而「訊息列不得重建、不得掉捲動位置」是既有的硬規則。
- **任何視覺語言的變更**。SAO-UI 是唯一規格，本批次不碰幾何、色彩與版面。

---

## 5. 驗收與門檻

每一批都要過既有矩陣（`AGENTS.md` §Validation Matrix）。動效批次額外要求：

- `pnpm build` 的核心 bundle 預算 210 kB gzip 不得被突破（目前 206.06 kB，餘裕 3.94 kB——**很緊，因此 M1 的差異更新必須注意不要引入額外程式碼**）。
- `pnpm test:e2e` 的九個寬度、light／dark、reduced motion、axe serious／critical 零違規，全部維持。
- 新增的機器檢查納入 `pnpm test:unit`，與 `scripts/index-contract.mjs` 同樣的思路：把規範變成會失敗的東西，而不是文件裡的一句話。

---

## 6. 風險

| 風險 | 判斷 |
|---|---|
| M1 改渲染路徑，可能影響未讀點與 active 狀態 | 這是本批唯一有真實回歸風險的一項，因此排在最前面且單獨成 PR。測試以「節點同一性」而非「內容相符」斷言，才抓得到重建 |
| bundle 餘裕只剩 3.94 kB | M1 是唯一新增 JS 的批次。若超出預算，先縮 M1 的實作而不是調高預算——PR #17 的紀錄顯示預算被調高過一次，不該再有第二次 |
| `alert-card-open` 是縮放動畫，屬文獻點名的前庭觸發類型 | 保留：它是實測還原的 SAO 開窗，且已被 reduced-motion 全域覆蓋涵蓋。M5 的測試正是為了確保那層覆蓋不會消失 |
| 出場動畫（M4）可能讓關閉「感覺變慢」 | 出場時長訂為進場的下一階（較短），且 NN/g 對「太快」與「太慢」都有警告；以實際操作感受決定，必要時只保留 opacity |
