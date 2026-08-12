# ADR-0004: AI provider boundary

Status: accepted. core 只依賴 `AIProvider` async iterable；Gemini 在 callable gateway 執行。draft 屬 ephemeral stream/RTDB，final answer 才屬 Firestore permanent data。
