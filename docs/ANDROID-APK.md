# Android APK 規劃與可行性評估

Last updated: 2026-08-13 (Asia/Taipei)

這份文件回答「現有的 Firebase 專案要怎麼做出 APK」。第 1 到 4 節是路線評估與各自的代價，第 5 節之後是已經拍板的決定。

功能啟用的順序與 gate 在 [FEATURE-ENABLEMENT](FEATURE-ENABLEMENT.md)。production 現況在 [HANDOFF](HANDOFF.md)。

## 決策紀錄（2026-08-13）

| 項目 | 決定 |
| --- | --- |
| 路線 | **B：Capacitor**，把 `dist` 打包進原生 App |
| package name | `com.waydefu.fchat` |
| 分發方式 | **側載，不上架 Google Play** |
| 簽章 keystore 保管 | 雲端硬碟一份，密碼記在桌面文字檔（風險見第 6 節） |
| 螢幕分享 | **待決**，見 4.2 第 4 點。技術上 Android 沒有這個 API，「保留」需要另外決定實作方式 |

前置條件不變：**這些工作都排在通話後端（FEATURE-ENABLEMENT 批次 B）上線之後**。通話沒開就做 APK，做出來是一個按下去會失敗的通話鍵，也無從驗收。

## 0. 現況盤點

### 應用程式

Chat Lite 是 Vite 打包的 vanilla TypeScript web app，部署在 Firebase Hosting。沒有任何原生程式碼，也沒有 Android 專案。

PWA 的完成度只到「可安裝」的最低限度：

- [public/manifest.webmanifest](../public/manifest.webmanifest) 有 `name`／`start_url`／`scope`／`display: standalone`／`theme_color`，但 `icons` 只有一顆 512 的 `logo-v2.png`，**沒有 192 尺寸，也沒有 `purpose: maskable`**。
- Service Worker 只有 `firebase-messaging-sw.js`，在 [src/app/bootstrap.ts](../src/app/bootstrap.ts) 註冊。它只處理推播，**沒有離線快取**。
- 沒有 `.well-known/assetlinks.json`（見第 2 節，這件事有陷阱）。

### 開發機工具鏈

| 項目 | 狀態 |
| --- | --- |
| JDK | 21.0.12（Microsoft build），可用 |
| Node.js | 24.18.0，可用 |
| Android SDK | **未安裝** |
| Gradle | **未安裝** |
| Android Studio | **未安裝** |

兩條路線都需要補 Android 工具鏈。差別是 Bubblewrap 會自己下載一份 JDK 與 Android SDK，Capacitor 則實務上需要完整的 Android Studio。

## 1. 兩條路線

| 維度 | 路線 A：TWA | 路線 B：Capacitor |
| --- | --- | --- |
| 本質 | Android 殼呼叫 Chrome 開你的網站 | 把 `dist` 打包進 App，用 WebView 執行 |
| 初次工作量 | 半天到一天 | 一到兩週 |
| 需要改的 web 程式碼 | 幾乎沒有 | 五處，見 4.2 |
| 網站更新 | Hosting 一部署就生效，不必重新送審 | 要重新出版本（除非另接 OTA） |
| 通話（麥克風／相機） | 走 Chrome，可用；WebView fallback 不可用（見 3.3） | 可用，但要處理權限 |
| 螢幕分享 | 走 Chrome，可用 | **不可用**，見 4.2 |
| 推播 | Chrome 委派通知給 App，需實測 | 原生 FCM，但後端要改 |
| 背景來電響鈴 | 做不到 | 可做，但要額外投入 |
| Firebase 要新增 Android app | 不需要 | 需要 |
| Play 上架風險 | 低（Google 官方推廣的路徑） | 中（遠端載入會有 minimum functionality 疑慮，見 4.4） |

## 2. 共通阻礙：Hosting 現在不會部署 `.well-known`

TWA 必須靠 `https://f-chat-wayde-fu.web.app/.well-known/assetlinks.json` 做 Digital Asset Links 驗證，驗不過的話 App 開起來會帶著網址列。Capacitor 若要用 App Links 也需要同一個檔案。

[firebase.json](../firebase.json) 的 `hosting.ignore` 目前是：

```
["firebase.json", "**/.*", "**/node_modules/**", "**/*.map"]
```

`**/.*` 會把整個 `.well-known/` 排除掉，檔案根本不會被上傳。

**網路上流傳的解法是加一條否定樣式 `"!**/.well-known/**"`，那在 Firebase Hosting 上無效。** Hosting 的檔案列舉走 `listFiles()` → `glob.sync()` 的 `ignore` 選項，而 glob（本專案鎖定的是 10.5.0）的 `Ignore` 類別建構 minimatch 時帶了 `nonegate: true`。開頭的 `!` 不會被當成否定，而是被當成字面字元，於是那條規則變成比對「路徑真的以 `!` 開頭」——一個永遠不會命中的 no-op。加了它不會報錯，只會讓人以為修好了。

也不能單純把 `**/.*` 刪掉：`dist/.vite/` 確實存在（Vite 的建置產物），刪掉規則會把它一起上傳。

正確做法是把規則改窄，明列要排除的東西：

```
["firebase.json", "**/.vite/**", "**/node_modules/**", "**/*.map"]
```

`**/*.map` 要留著，那是 PR #2 刻意排除 source map 的結果。

驗收方式（部署後）：

```bash
curl -s https://f-chat-wayde-fu.web.app/.well-known/assetlinks.json
```

必須回傳實際的 JSON 陣列內容。回 `[]` 或 404 就是沒上傳成功——注意 Firebase Hosting 對這個路徑有內建行為，拿不到檔案時可能回空陣列而不是 404，很容易誤判成「有部署但內容錯」。

## 3. 路線 A：TWA（Bubblewrap）

### 3.1 工具現況

Bubblewrap CLI 由 Google Chrome Labs 維護，目前版本 1.25.0，維護活躍。PWABuilder 是它的網頁版包裝，底層同一套；不想在本機裝 Android SDK 的話可以用 PWABuilder 產出，但簽章金鑰的保管仍然是你的責任。

### 3.2 步驟

1. 補 manifest 的 icon：加 192 與 512 各一份，並加一份 `purpose: "maskable"`。現有的 `logo-v2.png` 是 213 KB 的 512 圖，需要另外產生尺寸與 maskable 版本（maskable 要留安全邊距，不能直接沿用）。
2. `npx @bubblewrap/cli init --manifest https://f-chat-wayde-fu.web.app/manifest.webmanifest`。它會提示下載 JDK 與 Android SDK，同意即可，不必先自行安裝。
3. 決定 package name（例如 `com.waydefu.chatlite`）。**這個值一旦上架就不能改**，先想清楚。
4. 產生簽章 keystore。keystore 與密碼不得進 Git，遺失等同失去更新該 App 的能力；決定保管位置並寫進交接文件。
5. 取出簽章憑證的 SHA-256，填進 `assetlinks.json`，放到 `public/.well-known/assetlinks.json`，連同第 2 節的 `ignore` 修正一起走 `hosting_client` 部署，並用第 2 節的 curl 驗收。
6. `bubblewrap build` 產出 APK／AAB。

### 3.3 已知限制

- **WebView fallback 無法存取相機與麥克風。** TWA 正常情況下把畫面委派給 Chrome，通話可用；但在沒有安裝 Chrome、或使用者停用 Chrome 的裝置上，android-browser-helper 會退回自帶的 WebView，而該 fallback 沒有實作相機／麥克風權限橋接（GoogleChrome/android-browser-helper#309）。對通話 App 來說，這是一個會靜默失效的裝置區段。
- **背景來電響鈴做不到。** TWA 沒有辦法整合 Android 的 ConnectionService／來電 UI。App 沒開就沒有來電。
- **推播需要實測。** Chrome 支援把 Web Push 通知委派給 TWA App 顯示，Android 13 以上還需要 `POST_NOTIFICATIONS` 執行階段權限。這條路徑在本專案沒有驗證過，排程時要留出實測時間。
- **Google 登入需要實測。** 目前用的是 `signInWithPopup`。TWA 底下是完整的 Chrome，理論上可行，但 popup 在 Custom Tab 情境的行為需要實機確認；不行的話改用 `signInWithRedirect`，那是 client 端的小改動。

### 3.4 Firebase 端要做什麼

不需要在 Firebase 專案新增 Android 應用程式。TWA 載入的就是那個網站，用的是既有的 web 設定、既有的 App Check reCAPTCHA Enterprise key、既有的 Auth 授權網域。

## 4. 路線 B：Capacitor

### 4.1 Firebase 端要做什麼

不需要新的 Firebase 專案。同一個 `f-chat-wayde-fu` 底下多平台 App 共用 Firestore、RTDB、Functions、Auth。

1. Firebase Console → 專案設定 → 新增應用程式 → Android，填入 package name，下載 `google-services.json` 放進 `android/app/`。
2. 在該 Android App 的設定裡加入 SHA-1 與 SHA-256 憑證指紋。**debug keystore 與 release／Play App Signing 兩組都要加**，否則其中一種建置的 Google 登入會失敗。
3. App Check → 註冊這個 Android App，使用 Play Integrity provider，並在 Google Play Console 啟用 Play Integrity API、連結 Firebase 專案。web 那把 reCAPTCHA Enterprise site key 對 Android 完全無效，兩個平台是分開註冊的。

### 4.2 必須改的 web 程式碼

這五項不是設定，是程式碼。排工時要算進去。

1. **Google 登入**。[src/firebase/auth-client.ts](../src/firebase/auth-client.ts) 用的 `signInWithPopup` 在 WebView 裡不會動。要換成原生登入（`@capacitor-firebase/authentication` 的 `signInWithGoogle()`）取得 credential，再交給 JS SDK 的 `signInWithCredential()`，並確保原生與 JS 兩邊的登入狀態同步。
2. **推播 payload**。[functions/src/notifications/push.ts](../functions/src/notifications/push.ts) 目前只送 data-only 訊息加 `webpush` 選項。Android 原生端在 App 被系統結束時，data-only 訊息不會顯示通知；而且 FCM 會以七天的行為紀錄判斷，若高優先級訊息長期不產生使用者可見的通知，會把它降級成一般優先級。要補 `android` 區塊帶 `notification` 與 `priority: 'high'`。這是後端改動，會同時影響 web 端，要一起回歸測試。
3. **App Check provider**。[src/firebase/app-check.ts](../src/firebase/app-check.ts) 寫死 `ReCaptchaEnterpriseProvider`。Android 要走 Play Integrity，需要依執行環境分支。目前 `APP_CHECK_ENFORCED_FEATURES` 是空的所以不會擋，但在啟用強制之前必須處理，否則 APK 使用者會被全面擋下。
4. **螢幕分享——待決，且不是取捨問題而是能力問題**。`getDisplayMedia` 至今仍是桌面瀏覽器限定；Chromium 在 Android 上刻意把這個 API 隱藏起來，好讓 JavaScript 的功能偵測能正確回報「不支援」。也就是說 Capacitor 的 WebView 裡**不存在**可用的螢幕擷取 API，這不是設定或權限能解決的。可選的三條路：

   - **(a) 保留在 web 版，APK 版隱藏按鈕**（成本最低）。功能本身不刪，桌面瀏覽器照常可用，只有 Android App 上看不到這個鍵。
   - **(b) 做原生螢幕分享**。要寫一個 Capacitor plugin 走 Android MediaProjection，加上前景服務（Android 14 起沒有前景服務會拋 SecurityException），再透過原生 LiveKit Android SDK 把畫面推進同一個 room——因為 WebView 裡的 JS SDK 拿不到 MediaProjection 的串流。這等於在 App 裡同時跑 JS 與原生兩套 LiveKit，架構複雜度與工時都是數量級的增加。
   - **(c) 按鈕留著讓它失敗**。不建議，使用者會得到一個看起來能按但永遠壞掉的功能。

   在做出決定之前，[src/calls/call-ui.controller.ts](../src/calls/call-ui.controller.ts) 的 `toggleScreenShare` 不要動。
5. **AndroidManifest 權限**。至少要宣告 `RECORD_AUDIO`、`CAMERA`、`MODIFY_AUDIO_SETTINGS`、`POST_NOTIFICATIONS`。注意 Android WebView 是兩層權限：OS 執行階段權限授予之後，WebView 還要在 `onPermissionRequest` 再放行一次，兩層都過才拿得到裝置。少了 `MODIFY_AUDIO_SETTINGS`，即使使用者已授權，音訊子系統仍可能拒絕把麥克風交給 WebView。

### 4.3 工具鏈需求（Capacitor 8）

| 項目 | 需求 | 本機現況 |
| --- | --- | --- |
| Node.js | 22+ | 24.18.0 ✅ |
| JDK | 17+ | 21.0.12 ✅ |
| Android Studio | Otter 2025.2.1 或更新 | ❌ 未安裝 |
| Gradle wrapper | 8.14.3 | 隨專案產生 |
| AGP | 8.13.0 | 隨專案產生 |
| minSdk / target SDK | 24 / 36 | — |

Gradle 與 AGP 對 JDK 版本很挑，實務上用 Android Studio 內建的 JBR 最省事，不要花時間手動配 JDK。

### 4.4 上架注意

不要用 Capacitor 的 `server.url` 直接指向 `https://f-chat-wayde-fu.web.app`。那等於遠端載入一個網站，容易被 Play 以 minimum functionality 政策判定為單純的網頁包裝而拒審。要把 `dist` 打包進 App（`webDir: 'dist'`）。

打包進 App 之後，Firebase Hosting 的 CSP 標頭就不會套用到 App 內的頁面，安全邊界要另外在 Android 端設定。

## 5. 可行性結論

**兩條路線都可行，沒有技術上的死路。** 差別在於限制的位置：

- 路線 A 的限制在能力上限：沒有背景來電，且在 WebView fallback 的裝置上通話會靜默失效。但它幾乎不動現有程式碼，且網站更新不必重新送審。
- 路線 B 沒有能力上限的問題，但要付出 4.2 那五項程式碼改動、一套 Android 工具鏈、以及每次更新都要出版本的長期成本。螢幕分享在這條路線上要放棄。

### 已選定路線 B

理由是背景來電與通話可靠度。路線 A 在沒有 Chrome 的裝置上會靜默失效，對一個以通話為主張的 App 來說不可接受。

代價照單全收：4.2 的程式碼改動、一套 Android 工具鏈、每次更新都要重新出版本。

## 6. 決定帶來的後果與風險

### 6.1 不上架 Play 的影響（好壞都有）

**變簡單的事**：不需要資料安全表單、內容分級、審核週期，也沒有 minimum functionality 政策的拒審風險。package name 的鎖定程度也大幅降低——側載時使用者大不了移除重裝，不像上架後永遠不能改。

**變麻煩的事**：

- 使用者要自行開啟「安裝未知來源應用程式」，每個人第一次安裝都會看到系統警告。
- **沒有自動更新。** 出新版要自己想辦法通知使用者並讓他們重新安裝。
- **App Check 的 Play Integrity 需要留意。** Play Integrity 可以驗證非 Play 通路安裝的 App，但要在 Firebase Console 的 App Check 設定裡把 verdict 標籤調成允許 Play 以外的通路，預設值可能會把側載安裝判定為不合格。這件事要在啟用 App Check 強制之前實測，否則會把所有 APK 使用者擋在門外。

隱私說明仍然要更新——那是因為通話啟用（見 FEATURE-ENABLEMENT 4.7），與上不上架無關。

### 6.2 keystore 保管方式的風險

已決定：雲端硬碟放一份，密碼記在桌面文字檔。

這個做法有實質風險，接手的人要知道自己在承擔什麼：**keystore 加上密碼，等於簽發這個 App 的權力。** 取得兩者的人可以簽出一個 Android 會當成「同一個 App 的更新」而直接覆蓋安裝的 APK。桌面明文檔案是這條鏈上最弱的一環——同步軟體、備份工具、螢幕分享、以及任何跑在這台機器上的程式都碰得到它。

在不改變決定的前提下，有兩個幾乎沒有成本的補強，建議至少做一個：

- 密碼改放密碼管理器，keystore 仍放雲端硬碟。兩個因素就不會同時暴露在同一台機器的同一個地方。
- 或者把 keystore 與密碼一起放進一個有密碼的壓縮檔再上傳雲端，桌面只留提示而非密碼本身。

另外，遺失 keystore 的後果在側載情境下比上架情境輕：使用者移除重裝即可，不會像 Play 那樣永久失去更新該 App 的能力。所以這裡真正要防的是**外洩**，不是遺失。

### 6.3 還沒解決的一件事

**螢幕分享要怎麼處理**（見 4.2 第 4 點）。這是唯一還沒拍板、且會影響工時估算的項目。在決定之前不要動通話相關的 client 程式碼。

## 7. 這份文件沒有驗證的事

誠實記錄，避免接手的人誤以為都查過了。以下都是路線 B 定案後仍待實測的項目：

- **LiveKit 在 Android WebView 的實際通話品質沒有測過。** 這是最大的未知數，建議在投入其他改動之前先做一個最小驗證：空白的 Capacitor 專案載入現有 `dist`，能不能接通一通語音。
- **Play Integrity 對側載安裝的判定沒有實測過**（見 6.1）。
- **原生登入與 JS SDK 的登入狀態同步沒有實作過**（見 4.2 第 1 點）。原生端登入成功但 JS SDK 那側沒接上，會是很難查的問題。
- 第 3 節的路線 A 是評估紀錄，其中關於 TWA 推播委派與 `signInWithPopup` 行為的部分同樣未實測。既然沒有選這條路，那些就不再驗證，保留是為了說明當初為什麼沒選。
