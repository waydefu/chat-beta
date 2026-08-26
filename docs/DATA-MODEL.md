# Data model

Firestore：

- `rooms/{roomId}`：`schemaVersion=3`、name、type、visibility、ownerId、lastMessage；live call 期間有 server-only `activeCallId`。
- `rooms/{roomId}/members/{uid}`：唯一 canonical membership，role、status、version 與顯示 snapshot。
- `users/{uid}/roomStates/{roomId}`：與 membership 同一 Firestore transaction 維護的 query index 與個人 read/mute state。
- `membershipOperations/{roomId_uid}`：activate/revoke durable journal；version 單調增加。
- room 子集合：messages、readStates、reactions、attachments、aiRequests、calls、bots。
- `rooms/{roomId}/calls/{callId}`：operation ID、kind、state-machine status、starter、participant confirmations、lease、timestamps 與 terminal outcome。
- `users/{uid}/incomingCalls/{callId}`：server-written recipient signaling，含 room/call/kind/caller/status/expiry。
- `pushTokenClaims/{tokenHash}`：server-only canonical FCM ownership；`tokenHash=sha256(token)`，保存uid、token、userAgent、schemaVersion與timestamps。
- `users/{uid}/pushTokens/{tokenHash}`：server-written owner-private mirror；不是authorization source，client不可寫。
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

Typing connection 保存 `displayName` 與 `updatedAt`。與 global presence 同樣的規則：liveness 是 timestamp 判斷，不是節點存在與否。撰寫端每次按鍵刷新 `updatedAt`、停止 `TYPING_IDLE_CLEAR_MS` 後移除節點；讀取端以 server 時鐘判定 `TYPING_STALE_AFTER_MS` 內才算新鮮，並定期 sweep——孤兒節點不再變動，`onValue` 不會再為它觸發。常數集中在 `src/realtime/typing-state.ts`。

`roomKey` 是 UTF-8 room ID 的 base64url。RTDB members 是 room ephemeral ACL 的 authorization mirror，不是 membership 查詢來源。`membershipVersions` 是 server-only monotonic tombstone/operation guard，避免 stale add event 覆蓋較新的撤銷。Legacy `realtime/rooms/{roomKey}/presence` 已於 2026-08-26 移除（TD-L2）：Rules 不再宣告該節點，因此落到 default-deny，任何 client（包含仍在該房的 active 成員）都寫不進去；`membership.ts` 的撤銷與 orphan 兩個 transaction 也不再處理它。房間在線名單是 active membership ∩ global `realtime/presence/{uid}` 的推導結果，不再第二次儲存。**production 若仍有殘留節點，需由 operator 一次性刪除**，見 [HANDOFF](HANDOFF.md)〈Immediate follow-up〉。

Message 以 `kind` 判別 text、image、video、file、audio、sticker、system、call。client 可直接建立的永久訊息只有 `senderType=user` 的 text；其他受信任 metadata 由 Functions 建立。

Client的message store分離moving live window與已載入historical pages，兩者合併到normalized ID map並以createdAt/id穩定排序。`rooms/{roomId}/readStates/{uid}`和`users/{uid}/roomStates/{roomId}`仍是mirrors，但每次read advancement由同一write batch原子提交。

Built-in sticker 使用版本化 pack ID。Custom sticker object 位於 R2，`users/{uid}/stickerPacks/custom-v1` 只保存 server-written metadata；訊息仍只引用 `stickerPackId`／`stickerId`。下載 callable 同時驗證 active room membership、訊息引用與 sticker ready 狀態，metadata 刪除後 renderer 顯示 unavailable fallback。
