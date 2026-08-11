/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Web Push certificate public key from Firebase console →
   * Project settings → Cloud Messaging → Web configuration.
   * Push registration stays disabled while this is empty.
   */
  readonly VITE_FCM_VAPID_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
