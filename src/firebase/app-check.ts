import { firebaseApp } from './app';

let appCheckReady: Promise<void> | undefined;

export function initializeClientAppCheck(): Promise<void> {
  if (appCheckReady) return appCheckReady;
  const siteKey = import.meta.env.VITE_APP_CHECK_SITE_KEY;
  if (!siteKey) return Promise.resolve();
  appCheckReady = import('firebase/app-check').then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) => {
    initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  });
  return appCheckReady;
}
