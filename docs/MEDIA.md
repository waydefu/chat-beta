# Media

client 先呼叫 `requestUpload`；callable 驗證 Auth、App Check、active membership、MIME/size 與 user/room quota，再產生不可預測 object key 和 10 分鐘 R2 PUT URL。完成後 `finalizeUpload` 以 HEAD 與 range read 驗證 Content-Length、Content-Type 和 magic bytes；通過才在一個 Firestore transaction 將 attachment 標為 ready 並建立永久 message。

限制：image 10MB、video 100MB、audio 20MB、file 25MB；user 2GB、room 5GB。SVG、HTML、可執行檔不簽發。R2 CORS 只允許 production/staging origin 進行 PUT/GET/HEAD，不允許 `*`。

client 支援 progress、AbortSignal 與取消上傳。語音錄製由獨立 `VoiceRecorderService` 管理 permission、pause/resume、stop/cancel、preview blob 與 upload，不和 RTC provider 共用 MediaStream。

Custom sticker 使用獨立的 1 MB PNG/JPEG/WebP grant，保存於 `stickers/{uid}/custom-v1/{stickerId}`。pack metadata 與 quota 只由 Functions 寫入；24 小時未 finalize 的 reservation 由排程清除。一般 client 無法自行宣告 ready 或偽造 object key。

repository 已提供 scheduled cleanup：24 小時 quarantined upload／sticker 釋放 reservation，七天 orphan attachment object 刪除。正式部署仍須確認 scheduler、R2 lifecycle 與告警實際啟用；cleanup 皆需 idempotent。
