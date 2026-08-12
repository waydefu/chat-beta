# Chat Lite 3.0

Chat Lite 是以 vanilla TypeScript、Firebase Hosting、Firestore 與 Realtime Database 建立的多人聊天室。3.0 將授權來源收斂到 Firestore room membership，並把 presence、typing 與 AI draft 限制在具 Room ACL 的 RTDB ephemeral namespace。

## 本機開發

需求：Node.js 22、pnpm 11、Java 21（Rules emulator）。

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm emulators
pnpm dev
```

品質門檻：

```bash
pnpm lint
pnpm typecheck
pnpm test:unit --coverage
pnpm test:functions
pnpm test:rules
pnpm test:e2e
pnpm build
pnpm audit --prod --audit-level high
```

上線前先執行 `pnpm preflight:rollout`；重新登入 Firebase CLI 後可用 `pnpm preflight:rollout:online` 取得唯讀 inventory。Functions secret 以 `firebase functions:secrets:set NAME` 設定；瀏覽器端只放 `.env.example` 所列的公開 Firebase/App Check/FCM 設定。正式發布前依 [MIGRATION](docs/MIGRATION.md) 的順序先備份、dry-run、部署 additive backend，再收緊 Rules。

架構與操作文件位於 [docs](docs/ARCHITECTURE.md)。
