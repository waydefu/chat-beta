# Chat Lite SAO UI 規格

> 狀態：主聊天正式介面已採用。本文件是唯一規格來源；不存在平行 Demo。

## 證據等級與來源

| 等級 | 定義 | 可如何使用 |
| --- | --- | --- |
| 官方實測 | 使用者提供的《SWORD ART ONLINE: Integral Factor》遊戲客戶端錄影逐幀量測 | 可引用幾何、色彩與時序數字 |
| 官方網路來源 | Bandai Namco、SAO 官方網站或官方頻道公開內容 | 可補足整體表現；未量測畫面不宣稱精確數值 |
| Chat Lite 適配 | 原作沒有聊天對應元件，依已確認的設計語言延伸 | 必須明確標為適配，不宣稱是官方規格 |

本機量測來源保存在忽略版控的 `D:\chat\sao-reference-materials`，共兩支 MP4 與 13 張圖片。主要影片 `Screenrecorder-2026-08-18-19-21-04-829.mp4` 為 HEVC 2608×1200、5204 幀、83.841 秒、平均 62.07 fps 的 VFR 畫面；時間必須使用實際 PTS，不得以幀序乘固定幀距推算。網路交叉參考使用 [Bandai Namco 官方 Integral Factor 預告](https://www.youtube.com/watch?v=PR05WMvw0MQ)。

## 官方實測

### Tier 1／Tier 2 選單

| 項目 | 實測值 |
| --- | --- |
| Tier 1 外環／內盤 | 116 px／94 px |
| Tier 1、Tier 2 共用中心節距 | 130.6 px |
| Tier 1 節點空隙 | 約 15 px |
| Tier 2 板面 | 367×109 px，比例 3.37:1 |
| Tier 2 列間空隙 | 22 px |
| Tier 2 徽章 | 75 px |
| Tier 2 板面色 | `#F4F8FC`，帶自身垂直明暗變化 |

七個 Tier 1 取樣點與六個穩定 Tier 2 狀態交叉驗證後，節距與邊界一致。列在出現的第一幀即為完整寬度，沒有水平滑出或 `scaleX`；展開順序由上而下。精確 stagger 量測訊號互相矛盾，因此正式 UI 使用 **32 ms／列、180 ms 顯現**，屬 Chat Lite 適配。

> **2026-08-26 修正（UI M2／M3）**：顯現原本同時動 `opacity` 與 `filter: brightness(1.35)`，現只剩 `opacity`。`filter` 會讓每一列在每一幀都進 paint，而房間清單會因為任何房間收到訊息而重新渲染——這是主執行緒成本，與回應使用者輸入搶同一份預算。亮度這一項本來就標為適配而非實測，因此以它換掉 paint 是划算的。stagger 的 32 ms／列不變，但**第 9 列之後補上上限**：原本 `nth-child` 只寫到第 8 列，第 9 個房間會與第 1 列同時出現。

Tier 2 的獨立 alpha 無法可靠解算：七個取樣有六個得到物理上不可能的 alpha > 1，原因是板面自身漸層蓋過背景透出訊號。正式 UI 使用 Alert 已驗證的 `0.94`，必須視為借用值。

### Tier 3 面板

| 項目 | 實測值 |
| --- | --- |
| 標準高度 | 1048 px，占 1200 px 畫面高 87.3% |
| 垂直位置 | y 76…1123，上下各 76 px，精準置中 |
| 寬度 | 隨內容為 773／950／973／1128 px |
| 選單附屬面板左緣 | x=728，距 Tier 2 右緣 48 px |

素材中沒有左側 Tier 3 面板，也沒有左右鏡像規則的證據。Chat Lite 成員面板固定在右側；手機改為右側抽屜。受其他元件重疊的開窗樣本約 258 ms，未列為官方定案；正式 UI 採 240 ms 的面板顯現，屬適配。

> **2026-08-26 修正（UI M2）**：該面板原本同時掛著兩套動效——`layout.css` 的 `transform: translateX(105%) → none` 轉場，以及 `components.css` 的 `clip-path` 由下而上開窗動畫。兩者互相衝突：animation 的 `transform` 會蓋過 transition 的，所以開窗是疊在滑入之上，而 `clip-path` 每一幀都要 paint。已移除 `clip-path` 那一套，面板動效由 `transform` 轉場單獨擁有。240 ms 與 `--ease-panel` 不變，「自下向上」的描述改為滑入，因為那才是實際看得到的動作。

### Alert

| 項目 | 實測值 |
| --- | --- |
| 卡片 | 845×642 px，比例 1.3162，畫面置中 |
| 底板 alpha | 約 0.94 |
| 標題／內文／按鍵帶 | 126／360／139 px |
| 標題與按鍵帶 | `#F4F8FC` |
| 內文帶 | `#DDE0E4`，無漸層 |
| Cancel／OK 膠囊 | 262×96／97 px；間距 142 px |
| Cancel 色 | 本體 `#E4C9D5`、徽章 `#E2637D` |
| OK 色 | 本體 `#CDE7F4`、徽章 `#56AAD2` |

開啟前一幀與背景逐位元相同，沒有前導淡入。第一階段從約 0.498 倍直接出現並以線性比例在 97 ms 到達完整寬度；第二階段鎖定寬度，使用近似 `cubic-bezier(.51,.78,.40,.99)` 在總計 193–209 ms 內完成高度展開。按鍵不交換、沒有 3D 翻轉，且都在卡片內。

## Chat Lite 元件對照

| 主聊天元件 | 表現 | 證據 |
| --- | --- | --- |
| 登入 | 置中系統面板、圓形身份徽章、Link Start 膠囊 | 適配 |
| 房間導航 | Tier 1 圓形房間徽章＋Tier 2 完整寬度板面 | 幾何實測＋內容適配 |
| Header／連線 | 薄型 HUD、圓形操作井、狀態點 | 適配 |
| 訊息／AI／附件 | 淺色資訊板、左右邊色區分發送者 | 適配 |
| Composer／提及／貼圖 | 膠囊主操作、圓形工具井、Tier 2 選單語言 | 適配 |
| Presence／設定／通話 | 右側 Tier 3 資訊面板 | 幾何實測＋內容適配 |
| 確認與來電 | 三分帶 Alert 與雙膠囊操作 | 官方實測＋語意適配 |
| Toast／搜尋 | 薄型系統訊息板 | 適配 |

主聊天沿用既有 `chat-light.webp`／`chat-dark.webp`，但以完整畫幅映射到訊息區，避免窄螢幕使用 `cover` 時只裁到中央近似純色的區域。字體僅使用裝置內建的繁中 UI 字型堆疊（Microsoft JhengHei UI、Microsoft JhengHei、PingFang TC、Noto Sans TC 與系統後備），不下載外部字型。

## 響應式與互動合約

- `>1050px`：房間、訊息、成員三欄；`721–1050px`：成員為右側浮層；`<=720px`：房間與成員皆為抽屜。
- 所有既有 DOM ID、`hidden`／`open`、`aria-expanded`、`inert`、`data-message-id`、light／dark 儲存鍵與 keyed rendering 不變。
- 互動表面不使用 `preserve-3d`。斜角或連接器只能放在 `pointer-events:none` 的裝飾層，避免父層遮蔽命中測試。
- 主要觸控目標至少 44×44 px；320 px 寬不得出現水平捲動。
- `prefers-reduced-motion: reduce` 將動畫與交錯延遲縮至近零，但狀態改變仍須可見。
- Inline SVG 保留；六個內建 Unicode 貼圖屬訊息內容，不轉換為 UI 圖示。

## 完成狀態

- [x] 登入、導航、Header、訊息、Composer、搜尋、Presence、設定、Dialog、Toast 與通話視覺整合
- [x] light／dark 與三段響應式版面
- [x] 舊獨立 Demo 路徑移除，不建立第二套行為
- [x] 官方量測與 Chat Lite 適配分開標示
- [x] 2026-08-24 基準通過 `pnpm check`、`pnpm test:e2e`、九個指定寬度、light／dark、減少動態與 serious／critical axe 零違規

後續每次 UI 修改仍須重跑相同品質門檻；QA 截圖只作暫時比對，不納入版本控制。
