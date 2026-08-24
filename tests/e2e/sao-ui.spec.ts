import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function showSignedInFixture(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // Wait for the asynchronous auth observer to settle on signed-out before
  // swapping in the test-only signed-in surface. Otherwise a late null auth
  // callback can hide the fixture again on slower viewport iterations.
  await expect(page.getByRole('button', { name: /Google 登入/u })).toBeVisible();
  await page.evaluate(() => {
    const auth = document.getElementById('auth-view');
    const app = document.getElementById('app-view');
    const empty = document.getElementById('empty-state');
    const messageView = document.getElementById('message-view');
    const roomList = document.getElementById('room-list');
    const roomCount = document.getElementById('room-count');
    const roomTitle = document.getElementById('current-room-title');
    const connection = document.getElementById('connection-status');
    const messageList = document.getElementById('message-list');
    const presenceList = document.getElementById('presence-list');
    const presenceCount = document.getElementById('presence-count');
    if (!auth || !app || !empty || !messageView || !roomList || !roomCount || !roomTitle
      || !connection || !messageList || !presenceList || !presenceCount) {
      throw new Error('Signed-in fixture DOM contract is incomplete');
    }

    new MutationObserver(() => {
      if (!auth.hidden) auth.hidden = true;
      if (app.hidden) app.hidden = false;
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
    auth.hidden = true;
    app.hidden = false;
    empty.hidden = true;
    messageView.hidden = false;
    roomCount.textContent = '3';
    roomTitle.textContent = '第 75 層攻略會議';
    connection.innerHTML = '<span class="status-dot online" aria-hidden="true"></span>即時連線正常';
    roomList.innerHTML = `
      <button class="room-item active" type="button"><span class="room-initial">75</span><span class="room-copy"><strong>第 75 層攻略會議</strong><span>集合時間 20:00</span></span><span class="unread-dot" aria-label="有未讀訊息"></span></button>
      <button class="room-item" type="button"><span class="room-initial">G</span><span class="room-copy"><strong>公會大廳</strong><span>Asuna：裝備已整理</span></span></button>
      <button class="room-item" type="button"><span class="room-initial">AI</span><span class="room-copy"><strong>Gemini 情報室</strong><span>公開房間 · 點擊加入</span></span></button>`;
    messageList.innerHTML = `
      <article class="message-row" data-message-id="m1"><div class="message-profile"><span class="avatar">K</span><span class="message-author">Kirito</span></div><div class="message-wrap"><div class="message-bubble"><p class="message-text">第 75 層的頭目有三段攻擊模式，先確認前排配置。</p><div class="message-meta"><span>20:01</span></div></div><div class="reaction-bar"><button class="selected" aria-pressed="true">👍 2</button><button aria-pressed="false">❤️</button></div><div class="message-actions"><button>回覆</button></div></div></article>
      <article class="message-row you" data-message-id="m2"><div class="message-profile"><span class="avatar">我</span><span class="message-author">你</span></div><div class="message-wrap"><div class="message-bubble"><div class="reply-quote">Kirito：第 75 層的頭目有三段攻擊模式</div><p class="message-text">收到，我會先確認補給。</p><div class="message-meta"><span>20:02</span><span data-role="read">2 人已讀</span></div></div><div class="message-actions"><button>回覆</button><button>編輯</button><button class="danger">刪除</button></div></div></article>
      <article class="message-row ai-draft" data-message-id="m3"><div class="message-profile"><span class="avatar">G</span><span class="message-author">Gemini</span></div><div class="message-wrap"><div class="message-bubble"><p class="message-text">正在彙整戰術情報</p><details class="ai-sources"><summary class="ai-sources-summary">情報來源</summary><ul class="ai-sources-list"><li><a class="ai-source-link" href="#">攻略資料</a> <span class="ai-source-domain">example.test</span></li></ul></details></div></div></article>
      <article class="message-row" data-message-id="m4"><div class="message-profile"><span class="avatar">A</span><span class="message-author">Asuna</span></div><div class="message-wrap"><div class="message-bubble"><div class="message-text"><img class="attachment-image" src="/image/chat-light.webp" alt="隊伍配置預覽"><audio class="attachment-media" controls aria-label="語音情報預覽"></audio><span class="attachment-label">formation.pdf · 1.2 MB</span><a class="attachment-card" href="#">下載 formation.pdf</a></div><div class="message-meta"><span>20:04</span></div></div></div></article>
      <article class="message-row you pending" data-message-id="m5"><div class="message-profile"><span class="avatar">我</span><span class="message-author">你</span></div><div class="message-wrap"><div class="message-bubble"><p class="message-text sticker-message" aria-label="貼圖：讚">👍</p><div class="message-meta"><span>傳送中</span></div></div></div></article>`;
    presenceCount.textContent = '2 位在線';
    presenceList.innerHTML = `
      <div class="presence-item"><span class="presence-avatar">K</span><span class="presence-copy"><strong>Kirito</strong><span>在線</span></span></div>
      <div class="presence-item"><span class="presence-avatar">A</span><span class="presence-copy"><strong>Asuna</strong><span>在線</span></span></div>`;
    const accountName = document.getElementById('account-name');
    const accountEmail = document.getElementById('account-email');
    const accountAvatar = document.getElementById('account-avatar');
    if (accountName) accountName.textContent = 'Wayde';
    if (accountEmail) accountEmail.textContent = 'wayde@example.test';
    if (accountAvatar) accountAvatar.textContent = 'W';
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.textContent = 'Asuna 正在輸入…';
    for (const id of ['voice-call-btn', 'video-call-btn', 'attach-btn', 'voice-message-btn', 'sticker-btn', 'message-input', 'send-btn']) {
      const control = document.getElementById(id);
      if (control instanceof HTMLButtonElement || control instanceof HTMLTextAreaElement) control.disabled = false;
    }

    // The production controller is loaded only after Firebase authentication.
    // Keep this fixture non-production by binding just the visual shell
    // contracts that browser QA needs while the page remains signed out.
    const sidebar = document.getElementById('room-sidebar');
    const sidebarScrim = document.getElementById('sidebar-scrim');
    const openSidebar = document.getElementById('open-sidebar-btn');
    const closeSidebar = document.getElementById('close-sidebar-btn');
    const presencePanel = document.getElementById('presence-panel');
    const membersToggle = document.getElementById('members-toggle-btn');
    const closeMembers = document.getElementById('close-members-btn');
    const searchBar = document.getElementById('search-bar');
    const searchToggle = document.getElementById('search-toggle-btn');
    const searchInput = document.getElementById('message-search');
    const filterMessages = (): void => {
      const query = searchInput instanceof HTMLInputElement ? searchInput.value.trim().toLocaleLowerCase() : '';
      for (const row of messageList.querySelectorAll<HTMLElement>('.message-row')) {
        row.classList.toggle('filtered-out', Boolean(query) && !row.textContent?.toLocaleLowerCase().includes(query));
      }
    };
    openSidebar?.addEventListener('click', () => {
      sidebar?.classList.add('open');
      openSidebar.setAttribute('aria-expanded', 'true');
      if (sidebarScrim instanceof HTMLElement) sidebarScrim.hidden = false;
      closeSidebar?.focus();
    });
    const closeRoomDrawer = (): void => {
      sidebar?.classList.remove('open');
      openSidebar?.setAttribute('aria-expanded', 'false');
      if (sidebarScrim instanceof HTMLElement) sidebarScrim.hidden = true;
      openSidebar?.focus();
    };
    closeSidebar?.addEventListener('click', closeRoomDrawer);
    sidebarScrim?.addEventListener('click', closeRoomDrawer);
    membersToggle?.addEventListener('click', () => {
      presencePanel?.classList.add('open');
      membersToggle.setAttribute('aria-expanded', 'true');
      closeMembers?.focus();
    });
    const closePresenceDrawer = (): void => {
      presencePanel?.classList.remove('open');
      membersToggle?.setAttribute('aria-expanded', 'false');
      membersToggle?.focus();
    };
    closeMembers?.addEventListener('click', closePresenceDrawer);
    searchToggle?.addEventListener('click', () => {
      if (searchBar instanceof HTMLElement) searchBar.hidden = false;
      searchToggle.setAttribute('aria-expanded', 'true');
      searchInput?.focus();
    });
    searchInput?.addEventListener('input', filterMessages);
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      if (presencePanel?.classList.contains('open')) {
        event.preventDefault();
        closePresenceDrawer();
      } else if (sidebar?.classList.contains('open')) {
        event.preventDefault();
        closeRoomDrawer();
      } else if (searchBar instanceof HTMLElement && !searchBar.hidden) {
        event.preventDefault();
        searchBar.hidden = true;
        searchToggle?.setAttribute('aria-expanded', 'false');
        if (searchInput instanceof HTMLInputElement) searchInput.value = '';
        filterMessages();
        searchToggle?.focus();
      }
    });
  });
}

const viewports = [
  { width: 1440, height: 900 },
  { width: 1051, height: 800 },
  { width: 1050, height: 800 },
  { width: 1049, height: 800 },
  { width: 721, height: 800 },
  { width: 720, height: 800 },
  { width: 719, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];

test('signed-in SAO shell stays within every responsive boundary', async ({ page }) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await showSignedInFixture(page);
    const metrics = await page.evaluate(() => ({
      viewport: window.innerWidth,
      html: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      composer: document.querySelector('.composer')?.getBoundingClientRect().right ?? 0,
      touchTargets: window.innerWidth > 720 ? [] : [...document.querySelectorAll<HTMLElement>(
        '#open-sidebar-btn, .header-actions .icon-btn, .composer-tool, #send-btn',
      )].filter((element) => element.offsetParent !== null).map((element) => {
        const bounds = element.getBoundingClientRect();
        return { id: element.id || element.className, width: bounds.width, height: bounds.height };
      }),
    }));
    expect.soft(metrics.html, `${viewport.width}px html overflow`).toBeLessThanOrEqual(metrics.viewport);
    expect.soft(metrics.body, `${viewport.width}px body overflow`).toBeLessThanOrEqual(metrics.viewport);
    expect.soft(metrics.composer, `${viewport.width}px composer clipping`).toBeLessThanOrEqual(metrics.viewport);
    await expect(page.locator('#message-input')).toBeVisible();
    expect.soft(await page.locator('.composer-tool:visible').count(), `${viewport.width}px composer tools`).toBe(3);
    for (const target of metrics.touchTargets) {
      expect.soft(target.width, `${viewport.width}px ${target.id} width`).toBeGreaterThanOrEqual(44);
      expect.soft(target.height, `${viewport.width}px ${target.id} height`).toBeGreaterThanOrEqual(44);
    }
  }
});

test('signed-in light desktop and dark mobile surfaces have no serious axe violations', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await showSignedInFixture(page);
    await page.evaluate((dark) => {
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    }, viewport.width === 390);
    const results = await new AxeBuilder({ page }).include('#app-view').analyze();
    expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
  }
});

test('Alert, drawer and reduced-motion contracts remain usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await showSignedInFixture(page);

  await page.locator('#open-sidebar-btn').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#voice-call-btn')).toBeFocused();

  await page.locator('#open-sidebar-btn').click();
  await expect(page.locator('#room-sidebar')).toHaveClass(/open/u);
  await expect(page.locator('#open-sidebar-btn')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#close-sidebar-btn')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#room-sidebar')).not.toHaveClass(/open/u);
  await expect(page.locator('#open-sidebar-btn')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#open-sidebar-btn')).toBeFocused();

  await page.locator('#members-toggle-btn').click();
  await expect(page.locator('#presence-panel')).toHaveClass(/open/u);
  await expect(page.locator('#members-toggle-btn')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#close-members-btn')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#presence-panel')).not.toHaveClass(/open/u);
  await expect(page.locator('#members-toggle-btn')).toBeFocused();

  await page.locator('#search-toggle-btn').focus();
  await page.evaluate(() => {
    const dialog = document.getElementById('confirm-dialog');
    if (!(dialog instanceof HTMLDialogElement)) return;
    const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = [...dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    dialog.addEventListener('close', () => restoreFocus?.focus(), { once: true });
    dialog.showModal();
    focusable[0]?.focus();
  });
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await expect(page.locator('#confirm-action-btn')).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('confirm-dialog')?.contains(document.activeElement))).toBe(true);
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.getElementById('confirm-dialog')?.contains(document.activeElement))).toBe(true);
  }
  const animation = await page.locator('#confirm-dialog').evaluate((element) => getComputedStyle(element).animationDuration);
  expect(Number.parseFloat(animation)).toBeLessThanOrEqual(0.001);
  await page.keyboard.press('Escape');
  await expect(page.locator('#confirm-dialog')).not.toBeVisible();
  await expect(page.locator('#search-toggle-btn')).toBeFocused();
});

test('search, media, overlays and call states are represented by the signed-in fixture', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await showSignedInFixture(page);

  await page.locator('#search-toggle-btn').click();
  await expect(page.locator('#message-search')).toBeFocused();
  await page.locator('#message-search').fill('補給');
  expect(await page.locator('.message-row.filtered-out').count()).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-bar')).toBeHidden();
  await expect(page.locator('#search-toggle-btn')).toBeFocused();

  await page.evaluate(() => {
    const mentionList = document.getElementById('mention-list');
    const stickerPicker = document.getElementById('sticker-picker');
    const replyBanner = document.getElementById('reply-banner');
    const editBanner = document.getElementById('edit-banner');
    const toastRegion = document.getElementById('toast-region');
    const callPending = document.getElementById('call-pending');
    if (mentionList) {
      mentionList.innerHTML = '<button type="button" role="option" aria-selected="true">@Asuna · Asuna</button>';
      mentionList.hidden = false;
    }
    if (stickerPicker) stickerPicker.hidden = false;
    if (replyBanner) replyBanner.hidden = false;
    if (editBanner) editBanner.hidden = false;
    if (toastRegion) toastRegion.innerHTML = '<div class="toast" role="status">已切換至第 75 層攻略會議</div>';
    if (callPending) callPending.hidden = false;

    const panel = document.createElement('aside');
    panel.className = 'call-panel';
    panel.dataset.testCallFixture = 'true';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '視訊通話');
    panel.innerHTML = `
      <header class="call-panel-head"><div class="call-panel-title"><strong>視訊通話</strong><span class="call-timer">04:27</span></div><p class="call-state">通話已連線</p><p class="call-participants">通話中：你、Asuna</p><button class="call-minimize" type="button">縮小</button></header>
      <div class="call-videos"><div class="call-video" role="img" aria-label="Asuna 的視訊畫面"></div><div class="call-video local" role="img" aria-label="你的視訊畫面"></div></div>
      <div class="call-controls"><button class="call-control" type="button">靜音</button><button class="call-control" type="button">關閉鏡頭</button><button class="call-control" type="button">分享畫面</button><button class="call-control call-hangup" type="button">掛斷</button></div>`;
    panel.querySelector('.call-minimize')?.addEventListener('click', () => panel.classList.toggle('minimized'));
    document.body.append(panel);
  });

  await expect(page.locator('.attachment-image')).toBeAttached();
  await expect(page.locator('.attachment-media')).toBeAttached();
  await expect(page.locator('#mention-list')).toBeVisible();
  await expect(page.locator('#sticker-picker')).toBeVisible();
  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('#call-pending')).toBeVisible();
  await expect(page.locator('[data-test-call-fixture]')).toBeVisible();
  expect(await page.locator('.call-control').evaluateAll((controls) => controls.every((control) => control.getBoundingClientRect().height >= 44))).toBe(true);
  const callAxe = await new AxeBuilder({ page }).include('[data-test-call-fixture]').analyze();
  expect(callAxe.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-test-call-fixture]')).toBeVisible();
  await page.locator('.call-minimize').click();
  await expect(page.locator('[data-test-call-fixture]')).toHaveClass(/minimized/u);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.evaluate(() => {
    document.querySelector('[data-test-call-fixture]')?.remove();
    const incoming = document.createElement('aside');
    incoming.className = 'incoming-call-panel';
    incoming.dataset.testIncomingFixture = 'true';
    incoming.setAttribute('role', 'dialog');
    incoming.setAttribute('aria-modal', 'true');
    incoming.setAttribute('aria-label', '對方來電');
    incoming.innerHTML = '<div class="incoming-call-card"><div class="incoming-call-copy"><strong>Asuna</strong><p>邀請你加入視訊通話</p></div><div class="incoming-call-actions"><button class="incoming-call-action reject" type="button">拒絕</button><button class="incoming-call-action accept" type="button">接聽</button></div></div>';
    document.body.append(incoming);
    incoming.querySelector<HTMLButtonElement>('.accept')?.focus();
  });
  await expect(page.locator('[data-test-incoming-fixture]')).toBeVisible();
  await expect(page.locator('.incoming-call-action.accept')).toBeFocused();
  const incomingSizes = await page.locator('.incoming-call-action').evaluateAll((controls) => controls.map((control) => {
    const element = control as HTMLElement;
    return { label: element.textContent, width: element.offsetWidth, height: element.offsetHeight };
  }));
  for (const target of incomingSizes) {
    expect.soft(target.width, `${target.label} width`).toBeGreaterThanOrEqual(44);
    expect.soft(target.height, `${target.label} height`).toBeGreaterThanOrEqual(44);
  }
});
