import {
  consumeOfflineRevocationResult,
  enableTrustedOfflineCache,
  OFFLINE_REVOKE_PENDING_KEY,
  offlineRevocationPending,
  persistentCacheEnabled,
  revokeTrustedOfflineCache,
  storeOfflineRevocationResult,
} from './firestore-client';

interface OfflineSettingsElements {
  toggle: HTMLInputElement;
  status: HTMLElement;
  retry: HTMLButtonElement;
}

interface OfflineSettingsActions {
  confirm(): Promise<boolean>;
  beforeRevoke(): void;
  notify(message: string, error?: boolean): void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function bindOfflineSettings(elements: OfflineSettingsElements, actions: OfflineSettingsActions): void {
  const render = (pending = offlineRevocationPending): void => {
    elements.retry.hidden = !pending;
    if (pending) {
      elements.toggle.checked = false;
      elements.status.textContent = '舊資料尚未清除；目前只使用記憶體快取';
      return;
    }
    elements.status.textContent = persistentCacheEnabled ? '登出後仍保留，直到你主動關閉' : '未在此裝置保存聊天資料';
  };

  const revoke = async (requireConfirmation: boolean): Promise<void> => {
    if (!navigator.onLine) {
      elements.toggle.checked = persistentCacheEnabled;
      actions.notify('離線時無法確認待送訊息已同步，因此不會清除資料。', true);
      return;
    }
    if (requireConfirmation && !await actions.confirm()) {
      elements.toggle.checked = persistentCacheEnabled;
      return;
    }
    elements.toggle.disabled = true;
    elements.retry.disabled = true;
    actions.beforeRevoke();
    const result = await revokeTrustedOfflineCache();
    storeOfflineRevocationResult(result);
    window.location.reload();
  };

  elements.toggle.checked = persistentCacheEnabled;
  render();
  const result = consumeOfflineRevocationResult();
  if (result === 'cleared') actions.notify('此裝置的離線聊天資料已清除。');
  if (result === 'blocked-by-other-tabs') actions.notify('其他分頁仍在使用離線資料；關閉後按「重試清除」。', true);
  if (result === 'offline' || result === 'failed') actions.notify('離線資料尚未清除，請確認網路後重試。', true);

  elements.toggle.addEventListener('change', () => {
    if (elements.toggle.checked) {
      enableTrustedOfflineCache();
      elements.status.textContent = '重新載入後才會開始保存';
      actions.notify('可信裝置離線資料會在重新載入後啟用。');
      return;
    }
    void revoke(true).catch((error) => actions.notify(errorText(error), true));
  });
  elements.retry.addEventListener('click', () => {
    void revoke(false).catch((error) => actions.notify(errorText(error), true));
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== OFFLINE_REVOKE_PENDING_KEY || event.newValue !== 'true') return;
    elements.toggle.checked = false;
    elements.retry.hidden = false;
    elements.status.textContent = '另一個分頁已要求清除；請重新載入此分頁';
    actions.notify('另一個分頁正在撤銷離線資料；重新載入此分頁後才能完成清除。');
  });
}
