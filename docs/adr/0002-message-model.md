# ADR-0002: Discriminated message model

Status: accepted. `ChatMessage.kind` 判別 text/image/video/file/audio/sticker/system/call；structured mentions 和 attachment IDs 是資料，不把 HTML 存進訊息。只有 user text 保留 client offline direct write。
