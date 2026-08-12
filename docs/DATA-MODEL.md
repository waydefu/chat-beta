# Data model

Firestore：

- `rooms/{roomId}`：`schemaVersion=3`、name、type、visibility、ownerId、lastMessage。
- `rooms/{roomId}/members/{uid}`：唯一 canonical membership，role、status、version 與顯示 snapshot。
- `users/{uid}/roomStates/{roomId}`：與 membership 同一 Firestore transaction 維護的 query index 與個人 read/mute state。
- `membershipOperations/{roomId_uid}`：activate/revoke durable journal；version 單調增加。
- room 子集合：messages、readStates、reactions、attachments、aiRequests、calls、bots。
- global：users、bots、directRoomKeys、rateLimits。

RTDB：

```text
realtime/rooms/{roomKey}/members/{uid}
realtime/rooms/{roomKey}/membershipVersions/{uid}
realtime/rooms/{roomKey}/presence/{uid}/connections/{connectionId}
realtime/rooms/{roomKey}/typing/{uid}/{connectionId}
realtime/rooms/{roomKey}/activity/{uid}/{connectionId}
realtime/rooms/{roomKey}/aiDrafts/{runId}
```

`roomKey` 是 UTF-8 room ID 的 base64url。RTDB members 是 authorization mirror，不是 membership 查詢來源。`membershipVersions` 是 server-only monotonic tombstone/operation guard，避免 stale add event 覆蓋較新的撤銷。

Message 以 `kind` 判別 text、image、video、file、audio、sticker、system、call。client 可直接建立的永久訊息只有 `senderType=user` 的 text；其他受信任 metadata 由 Functions 建立。

Built-in sticker 使用版本化 pack ID。Custom sticker object 位於 R2，`users/{uid}/stickerPacks/custom-v1` 只保存 server-written metadata；訊息仍只引用 `stickerPackId`／`stickerId`。下載 callable 同時驗證 active room membership、訊息引用與 sticker ready 狀態，metadata 刪除後 renderer 顯示 unavailable fallback。
