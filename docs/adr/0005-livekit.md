# ADR-0005: LiveKit RTC

Status: accepted. LiveKit Cloud 負責 media 與 participant state；Firestore 僅保存 call lifecycle。token callable 依 active membership 與 call state 簽發短 TTL、source-scoped JWT。
