# ADR-0003: Cloudflare R2 media

Status: accepted. R2 保存 object，Firestore 保存 quarantined/ready metadata。後端產生 key、簽發短效 URL並以 HEAD/range 驗證；client 永遠不持有 R2 credential。
