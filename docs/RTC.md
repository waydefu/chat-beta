# RTC

`CallProvider` 隔離 LiveKit。`startLiveKitCall` 先驗證 active membership，建立 Firestore call lifecycle 與 system call message；`getLiveKitToken` 再確認 call 仍為 active，簽發 10 分鐘 JWT，identity 綁 Firebase uid、LiveKit room、publish source 與 subscribe grant。

Firestore 只保存 started/ended lifecycle 與 history。participant、track、speaker、network quality 不鏡射到 Firestore/RTDB。交付順序是 1:1 voice、1:1 video、group、screen share；每一階段都在受保護 staging 使用真實 LiveKit Cloud smoke test。

client 動態載入 `livekit-client`，因此 RTC 不進首屏 chunk。中止 RoomScope 會斷線並移除已 attach 的 remote audio element。
