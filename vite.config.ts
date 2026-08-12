import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/',
  build: {
    target: 'esnext',
    manifest: true,
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        terms: resolve(__dirname, 'terms.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/livekit-client/')) return 'rtc-livekit';
          if (id.includes('/node_modules/firebase/') || id.includes('/node_modules/@firebase/')) {
            if (id.includes('/database')) return 'firebase-realtime';
            if (id.includes('/functions')) return 'firebase-functions';
            if (id.includes('/messaging')) return 'firebase-messaging';
            if (id.includes('/app-check')) return 'firebase-app-check';
            if (id.includes('/firestore') || id.includes('/auth')) return 'firebase-core';
          }
          return undefined;
        },
      },
    },
  },
});
