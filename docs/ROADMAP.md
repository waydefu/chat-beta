# Roadmap and delivery status

Production rollout status and the next operator checklist are recorded in [HANDOFF](HANDOFF.md). The repository-delivery table below remains the feature map; HANDOFF is authoritative for what is actually live.

| Phase | Repository delivery | External/staging gate |
| --- | --- | --- |
| 0–1 | audit findings、schema、runbooks、ADRs、local/online preflight | production exports、billing/data-volume inventory |
| 2 | bootstrap、module boundaries、Functions TS workspace、Hosting headers、phased deploy gates | Hosting site/WIF/variables setup、Pages redirect |
| 3 | Firestore/RTDB ACL、journal、sync、fail-closed revoke、migration | staged migration、24h monitor、7d cleanup |
| 4–7 | ARIA mentions、Gemini stream、RTDB draft、reactions | Gemini model/secret、quota smoke |
| 8–11 | R2 grant/finalize、attachments、voice pause/preview/cancel、built-in＋custom R2 stickers | R2 CORS/lifecycle、orphan cleanup smoke |
| 12–13 | LiveKit provider/token/lifecycle、Algolia sync/search | provider projects/keys、real-service smoke |
| 14 | security headers、lazy provider chunks、199.80 kB gzip production-config budget gate、5k model fixture、signed-out axe smoke | authenticated three-user E2E、render/memory profile、privacy approval、final legacy removal |

「Repository delivery」代表程式與可測契約已存在，不代表 production provider 已配置或 migration 已執行。任何正式 rollout 都依 MIGRATION runbook 前進。
