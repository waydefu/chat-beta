# ADR-0001: Room membership and ACL

Status: accepted. Firestore membership 是唯一 canonical authorization；同一 Firestore transaction 維護 user room index。RTDB mirror 是 eventual derivative。跨產品不宣稱原子性，removal 採 revoking → RTDB atomic revoke → Firestore finalize，所有故障方向 fail closed。
