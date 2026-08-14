# Data model

Firestore：

- `rooms/{roomId}`：`schemaVersion=3`、name、type、visibility、ownerId、lastMessage；live call 期間有 server-only `activeCallId`。
- `rooms/{roomId}/members/{uid}`：唯一 canonical membership，role、status、version 與顯示 snapshot。
- `users/{uid}/roomStates/{roomId}`：與 membership 同一 Firestore transaction 維護的 query index 與個人 read/mute state。
- `membershipOperations/{roomId_uid}`：activate/revoke durable journal；version 單調增加。
- room 子集合：messages、readStates、reactions、attachments、aiRequests、calls、bots。
- `rooms/{roomId}/calls/{callId}`：operation ID、kind、state-machine status、starter、participant confirmations、lease、timestamps 與 terminal outcome。
- `users/{uid}/incomingCalls/{callId}`：server-written recipient signaling，含 room/call/kind/caller/status/expiry。
- global：users、bots、directRoomKeys、rateLimits。

RTDB：

```text
realtime/rooms/{roomKey}/members/{uid}
realtime/rooms/{roomKey}/membershipVersions/{uid}
realtime/presence/{uid}/connections/{connectionId}
realtime/rooms/{roomKey}/typing/{uid}/{connectionId}
realtime/rooms/{roomKey}/activity/{uid}/{connectionId}
realtime/rooms/{roomKey}/aiDrafts/{runId}
```

Global Presence connection 保存 `state`、`connectedAt`、`updatedAt`；multi-tab/multi-device 各有一個 connection，最後一個 connection 消失才 offline。聊天室成員面板只讀已知 member UID 的個別 subtree，取 `room members ∩ global online users` 並排除自己；Rules 禁止列舉 global presence root。

`roomKey` 是 UTF-8 room ID 的 base64url。RTDB members 是 room ephemeral ACL 的 authorization mirror，不是 membership 查詢來源。`membershipVersions` 是 server-only monotonic tombstone/operation guard，避免 stale add event 覆蓋較新的撤銷。Legacy `realtime/rooms/{roomKey}/presence` 在 additive migration window 暫留 Rules，但新版 client 不再讀寫；驗證流量歸零後必須移除。

Message 以 `kind` 判別 text、image、video、file、audio、sticker、system、call。client 可直接建立的永久訊息只有 `senderType=user` 的 text；其他受信任 metadata 由 Functions 建立。

Built-in sticker 使用版本化 pack ID。Custom sticker object 位於 R2，`users/{uid}/stickerPacks/custom-v1` 只保存 server-written metadata；訊息仍只引用 `stickerPackId`／`stickerId`。下載 callable 同時驗證 active room membership、訊息引用與 sticker ready 狀態，metadata 刪除後 renderer 顯示 unavailable fallback。
