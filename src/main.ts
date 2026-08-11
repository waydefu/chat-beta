import './style.css';

import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  clearIndexedDbPersistence,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  terminate,
  updateDoc,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  serverTimestamp as databaseServerTimestamp,
  set,
  type DatabaseReference,
} from 'firebase/database';

import {
  OFFLINE_PREFERENCE_KEY,
  auth,
  firestore,
  persistentCacheEnabled,
  provider,
  rtdb,
} from './firebase';
import {
  PUSH_PREFERENCE_KEY,
  disablePush,
  enablePush,
  pushSupported,
  stopForegroundPush,
  watchForegroundPush,
} from './push';
import type { ChatMessage, OnlineUser, RoomPreview, RoomReadState, UserProfile, Unsubscribe } from './types';
import {
  compareMessages,
  encodeRoomKey,
  formatMessageTime,
  initialOf,
  normalizeRoomName,
  truncate,
  validateMessage,
  validateRoomName,
} from './utils';

const PAGE_SIZE = 50;
const THEME_KEY = 'chat-lite:theme';
const CHAT_HEADS_KEY = 'chat-lite:chat-heads';
const MAX_CHAT_HEADS = 3;
const CHAT_HEAD_MARGIN = 14;

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

const authView = byId<HTMLElement>('auth-view');
const appView = byId<HTMLElement>('app-view');
const loginBtn = byId<HTMLButtonElement>('login-btn');
const logoutBtn = byId<HTMLButtonElement>('logout-btn');
const roomSidebar = byId<HTMLElement>('room-sidebar');
const sidebarScrim = byId<HTMLButtonElement>('sidebar-scrim');
const openSidebarBtn = byId<HTMLButtonElement>('open-sidebar-btn');
const closeSidebarBtn = byId<HTMLButtonElement>('close-sidebar-btn');
const roomInput = byId<HTMLInputElement>('room-name');
const roomError = byId<HTMLElement>('room-error');
const joinRoomBtn = byId<HTMLButtonElement>('join-room-btn');
const roomList = byId<HTMLElement>('room-list');
const roomCount = byId<HTMLElement>('room-count');
const currentRoomTitle = byId<HTMLElement>('current-room-title');
const connectionStatus = byId<HTMLElement>('connection-status');
const emptyState = byId<HTMLElement>('empty-state');
const messageView = byId<HTMLElement>('message-view');
const messageList = byId<HTMLElement>('message-list');
const loadOlderBtn = byId<HTMLButtonElement>('load-older-btn');
const messageInput = byId<HTMLTextAreaElement>('message-input');
const sendBtn = byId<HTMLButtonElement>('send-btn');
const messageCounter = byId<HTMLElement>('message-counter');
const typingIndicator = byId<HTMLElement>('typing-indicator');
const replyBanner = byId<HTMLElement>('reply-banner');
const replySummary = byId<HTMLElement>('reply-summary');
const cancelReplyBtn = byId<HTMLButtonElement>('cancel-reply-btn');
const editBanner = byId<HTMLElement>('edit-banner');
const cancelEditBtn = byId<HTMLButtonElement>('cancel-edit-btn');
const searchBar = byId<HTMLElement>('search-bar');
const messageSearch = byId<HTMLInputElement>('message-search');
const searchToggleBtn = byId<HTMLButtonElement>('search-toggle-btn');
const closeSearchBtn = byId<HTMLButtonElement>('close-search-btn');
const themeToggle = byId<HTMLInputElement>('theme-toggle');
const offlineToggle = byId<HTMLInputElement>('offline-toggle');
const pushToggle = byId<HTMLInputElement>('push-toggle');
const presencePanel = byId<HTMLElement>('presence-panel');
const membersToggleBtn = byId<HTMLButtonElement>('members-toggle-btn');
const closeMembersBtn = byId<HTMLButtonElement>('close-members-btn');
const presenceList = byId<HTMLElement>('presence-list');
const presenceCount = byId<HTMLElement>('presence-count');
const accountAvatar = byId<HTMLElement>('account-avatar');
const accountName = byId<HTMLElement>('account-name');
const accountEmail = byId<HTMLElement>('account-email');
const chatHeads = byId<HTMLElement>('chat-heads');
const toastRegion = byId<HTMLElement>('toast-region');
const confirmDialog = byId<HTMLDialogElement>('confirm-dialog');
const confirmTitle = byId<HTMLElement>('confirm-title');
const confirmCopy = byId<HTMLElement>('confirm-copy');
const confirmActionBtn = byId<HTMLButtonElement>('confirm-action-btn');

let currentUser: User | null = null;
let currentRoom = '';
let rooms = new Map<string, RoomPreview>();
let roomReadStates = new Map<string, RoomReadState>();
const messages = new Map<string, ChatMessage>();
let oldestCursor: QueryDocumentSnapshot<DocumentData> | null = null;
let activeWrites = 0;
let loggingOut = false;
let replyToId: string | null = null;
let editing: { roomId: string; messageId: string } | null = null;
let typingTimer: ReturnType<typeof setTimeout> | null = null;
let typingConnectionRef: DatabaseReference | null = null;
let presenceConnectionRef: DatabaseReference | null = null;
let presenceDisconnectRef: ReturnType<typeof onDisconnect> | null = null;
let lastOnlineDisconnectRef: ReturnType<typeof onDisconnect> | null = null;
let messageUnsub: Unsubscribe | null = null;
let roomUnsub: Unsubscribe | null = null;
let roomStateUnsub: Unsubscribe | null = null;
let readReceiptUnsub: Unsubscribe | null = null;
let readReceipts = new Map<string, RoomReadState>();
let usersUnsub: Unsubscribe | null = null;
let userProfiles = new Map<string, UserProfile>();
let chatHeadsPos: { x: number; y: number } | null = null;
let chatHeadsDrag: {
  pointerId: number;
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  moved: boolean;
} | null = null;
let lastChatHeadDragEnd = 0;
let typingUnsubs: Unsubscribe[] = [];
let presenceUnsubs: Unsubscribe[] = [];
let legacyPresence: Record<string, unknown> = {};
let v2Presence: Record<string, unknown> = {};
let legacyTyping: Record<string, unknown> = {};
let v2Typing: Record<string, unknown> = {};
const lastMarkedByRoom = new Map<string, string>();
const failedOutbox = new Map<string, { roomId: string; text: string; replyToId?: string }>();
const pendingMessageIds = new Set<string>();

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const node = document.createElement('div');
  node.className = `toast ${kind === 'error' ? 'error' : ''}`;
  node.textContent = message;
  toastRegion.append(node);
  window.setTimeout(() => node.remove(), 4200);
}

function showConfirm(title: string, copy: string, action = '確認'): Promise<boolean> {
  confirmTitle.textContent = title;
  confirmCopy.textContent = copy;
  confirmActionBtn.textContent = action;
  confirmDialog.returnValue = 'cancel';
  confirmDialog.showModal();
  return new Promise((resolve) => {
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'confirm'), { once: true });
  });
}

function trackWrite<T>(promise: Promise<T>, onFailure?: (error: unknown) => void): void {
  activeWrites += 1;
  void promise
    .catch((error: unknown) => {
      onFailure?.(error);
      if (!onFailure) toast('資料同步失敗，請稍後再試。', 'error');
    })
    .finally(() => {
      activeWrites = Math.max(0, activeWrites - 1);
    });
}

function hasPendingWork(): boolean {
  return activeWrites > 0 || pendingMessageIds.size > 0;
}

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme;
  themeToggle.checked = theme === 'dark';
  localStorage.setItem(THEME_KEY, theme);
}

const savedTheme = localStorage.getItem(THEME_KEY);
applyTheme(savedTheme === 'dark' ? 'dark' : 'light');

try {
  const saved = recordOf(JSON.parse(localStorage.getItem(CHAT_HEADS_KEY) ?? 'null'));
  if (typeof saved.x === 'number' && typeof saved.y === 'number') chatHeadsPos = { x: saved.x, y: saved.y };
} catch { chatHeadsPos = null; }

offlineToggle.checked = persistentCacheEnabled;

themeToggle.addEventListener('change', () => applyTheme(themeToggle.checked ? 'dark' : 'light'));
offlineToggle.addEventListener('change', async () => {
  offlineToggle.checked = persistentCacheEnabled;
  if (hasPendingWork()) {
    toast('尚有待同步資料，現在不能切換離線設定。', 'error');
    return;
  }
  const target = !persistentCacheEnabled;
  const confirmed = await showConfirm(
    target ? '啟用可信裝置離線資料？' : '停用離線資料？',
    target
      ? '聊天記錄會保存在這台裝置，直到你明確登出。請只在私人裝置啟用。'
      : '頁面將重新載入，現有的本機聊天快取會在登出時清除。',
    target ? '啟用並重新載入' : '停用並重新載入',
  );
  if (!confirmed) return;
  localStorage.setItem(OFFLINE_PREFERENCE_KEY, String(target));
  window.location.reload();
});

/**
 * The row stays hidden unless push can actually work here, so we never offer a
 * switch that silently does nothing.
 */
async function setupPushToggle(uid: string): Promise<void> {
  const row = pushToggle.closest('.setting-row');
  if (!(await pushSupported())) {
    row?.setAttribute('hidden', '');
    return;
  }
  row?.removeAttribute('hidden');
  const wanted = localStorage.getItem(PUSH_PREFERENCE_KEY) === 'true' && Notification.permission === 'granted';
  pushToggle.checked = wanted;
  if (wanted) {
    const failure = await enablePush(uid);
    if (failure) {
      pushToggle.checked = false;
      localStorage.setItem(PUSH_PREFERENCE_KEY, 'false');
    }
  }
  watchForegroundPush((message) => toast(message));
}

pushToggle.addEventListener('change', async () => {
  if (!currentUser) return;
  if (!pushToggle.checked) {
    localStorage.setItem(PUSH_PREFERENCE_KEY, 'false');
    await disablePush(currentUser.uid);
    toast('已關閉推播通知。');
    return;
  }
  pushToggle.disabled = true;
  const failure = await enablePush(currentUser.uid);
  pushToggle.disabled = false;
  if (failure) {
    pushToggle.checked = false;
    localStorage.setItem(PUSH_PREFERENCE_KEY, 'false');
    toast(failure, 'error');
    return;
  }
  localStorage.setItem(PUSH_PREFERENCE_KEY, 'true');
  toast('已開啟推播，關閉頁面後也會收到新訊息通知。');
});

function setSidebar(open: boolean): void {
  roomSidebar.classList.toggle('open', open);
  openSidebarBtn.setAttribute('aria-expanded', String(open));
  syncScrim();
}

function setPresencePanel(open: boolean): void {
  presencePanel.classList.toggle('open', open);
  membersToggleBtn.setAttribute('aria-expanded', String(open));
  syncScrim();
}

function syncScrim(): void {
  const sidebarOverlay = window.matchMedia('(max-width: 720px)').matches && roomSidebar.classList.contains('open');
  const presenceOverlay = window.matchMedia('(max-width: 1050px)').matches && presencePanel.classList.contains('open');
  sidebarScrim.hidden = !sidebarOverlay && !presenceOverlay;
}

openSidebarBtn.addEventListener('click', () => setSidebar(true));
closeSidebarBtn.addEventListener('click', () => setSidebar(false));
sidebarScrim.addEventListener('click', () => {
  setSidebar(false);
  setPresencePanel(false);
});
membersToggleBtn.addEventListener('click', () => setPresencePanel(true));
closeMembersBtn.addEventListener('click', () => setPresencePanel(false));
window.addEventListener('resize', syncScrim);

searchToggleBtn.addEventListener('click', () => {
  searchBar.hidden = false;
  searchToggleBtn.setAttribute('aria-expanded', 'true');
  messageSearch.focus();
});
closeSearchBtn.addEventListener('click', () => {
  searchBar.hidden = true;
  searchToggleBtn.setAttribute('aria-expanded', 'false');
  messageSearch.value = '';
  filterMessages('');
});
messageSearch.addEventListener('input', () => filterMessages(messageSearch.value));

function filterMessages(value: string): void {
  const needle = value.trim().toLocaleLowerCase('zh-TW');
  messageList.querySelectorAll<HTMLElement>('[data-message-id]').forEach((row) => {
    const message = messages.get(row.dataset.messageId ?? '');
    row.classList.toggle('filtered-out', Boolean(needle && !message?.text.toLocaleLowerCase('zh-TW').includes(needle)));
  });
}

function updateConnectionStatus(): void {
  const dot = connectionStatus.querySelector<HTMLElement>('.status-dot');
  const online = navigator.onLine;
  if (dot) {
    dot.classList.toggle('online', online);
    dot.classList.toggle('offline', !online);
  }
  connectionStatus.lastChild?.remove();
  connectionStatus.append(document.createTextNode(online ? '已連線' : '離線中 · 訊息將待同步'));
}

window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
updateConnectionStatus();

loginBtn.addEventListener('click', () => {
  loginBtn.disabled = true;
  void signInWithPopup(auth, provider)
    .catch((error: unknown) => toast(error instanceof Error ? `登入失敗：${error.message}` : '登入失敗', 'error'))
    .finally(() => { loginBtn.disabled = false; });
});

logoutBtn.addEventListener('click', async () => {
  if (hasPendingWork()) {
    toast('尚有訊息等待同步。請恢復連線並等候完成後再登出。', 'error');
    return;
  }
  const confirmed = await showConfirm('要登出 Chat Lite 嗎？', '登出會清除這台裝置上的聊天快取。', '登出');
  if (!confirmed) return;
  loggingOut = true;
  await signOut(auth);
  cleanupSession();
  await terminate(firestore);
  if (persistentCacheEnabled) await clearIndexedDbPersistence(firestore);
  localStorage.removeItem(OFFLINE_PREFERENCE_KEY);
  window.location.reload();
});

onAuthStateChanged(auth, (user: User | null) => {
  currentUser = user;
  if (user) {
    authView.hidden = true;
    appView.hidden = false;
    accountName.textContent = user.displayName || '匿名使用者';
    accountEmail.textContent = user.email || '';
    accountAvatar.textContent = initialOf(user.displayName || user.email);
    trackWrite(setDoc(doc(firestore, 'users', user.uid), {
      displayName: user.displayName || '匿名使用者',
      ...(user.photoURL ? { photoURL: user.photoURL } : {}),
    }, { merge: true }));
    watchUsers();
    watchRooms();
    watchRoomStates();
    setupPresence(user);
    void setupPushToggle(user.uid);
    void openRequestedRoom();
  } else if (!loggingOut) {
    cleanupSession();
    authView.hidden = false;
    appView.hidden = true;
  }
});

function cleanupSession(): void {
  messageUnsub?.();
  roomUnsub?.();
  roomStateUnsub?.();
  readReceiptUnsub?.();
  usersUnsub?.();
  messageUnsub = roomUnsub = roomStateUnsub = readReceiptUnsub = usersUnsub = null;
  cleanupTyping();
  cleanupPresence();
  stopForegroundPush();
  currentRoom = '';
  rooms.clear();
  messages.clear();
  roomReadStates.clear();
  readReceipts.clear();
  userProfiles.clear();
  messageList.replaceChildren();
}

function watchRooms(): void {
  roomUnsub?.();
  roomUnsub = onSnapshot(collection(firestore, 'rooms'), (snapshot) => {
    rooms = new Map(snapshot.docs.map((roomDoc) => [roomDoc.id, { id: roomDoc.id, ...roomDoc.data() } as RoomPreview]));
    renderRooms();
  }, () => toast('無法載入聊天室列表。', 'error'));
}

function watchRoomStates(): void {
  if (!currentUser) return;
  roomStateUnsub?.();
  roomStateUnsub = onSnapshot(collection(firestore, 'users', currentUser.uid, 'roomStates'), (snapshot) => {
    roomReadStates = new Map(snapshot.docs.map((stateDoc) => [stateDoc.id, stateDoc.data() as RoomReadState]));
    renderRooms();
  }, () => toast('無法載入未讀狀態。', 'error'));
}

function watchUsers(): void {
  usersUnsub?.();
  usersUnsub = onSnapshot(collection(firestore, 'users'), (snapshot) => {
    userProfiles = new Map(snapshot.docs.map((userDoc) => [userDoc.id, userDoc.data() as UserProfile]));
    refreshAvatars();
  }, () => { /* avatars fall back to initials */ });
}

/**
 * Renders a photo when the user has one, initials otherwise. A broken photo URL
 * falls back to initials rather than leaving an empty circle.
 */
function paintAvatar(node: HTMLElement, uid: string | undefined, name: string): void {
  const photo = uid ? userProfiles.get(uid)?.photoURL : undefined;
  const initials = initialOf(name);
  if (!photo) {
    node.classList.remove('has-photo');
    node.replaceChildren(document.createTextNode(initials));
    return;
  }
  const existing = node.querySelector('img');
  if (existing?.src === photo) return;
  const image = document.createElement('img');
  image.src = photo;
  image.alt = '';
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => {
    node.classList.remove('has-photo');
    node.replaceChildren(document.createTextNode(initials));
  }, { once: true });
  node.classList.add('has-photo');
  node.replaceChildren(image);
}

function refreshAvatars(): void {
  for (const row of messageList.querySelectorAll<HTMLElement>('[data-message-id]')) {
    const message = messages.get(row.dataset.messageId ?? '');
    const node = row.querySelector<HTMLElement>('.avatar');
    if (message && node) paintAvatar(node, message.uid, message.user);
  }
  if (currentUser) paintAvatar(accountAvatar, currentUser.uid, currentUser.displayName || currentUser.email || '');
  renderPresence();
}

function watchReadReceipts(roomId: string): void {
  readReceiptUnsub?.();
  readReceipts.clear();
  readReceiptUnsub = onSnapshot(collection(firestore, 'rooms', roomId, 'readStates'), (snapshot) => {
    if (roomId !== currentRoom) return;
    readReceipts = new Map(snapshot.docs.map((stateDoc) => [stateDoc.id, stateDoc.data() as RoomReadState]));
    refreshReadReceipts();
  }, () => toast('無法載入已讀狀態。', 'error'));
}

/**
 * A message counts as read by someone once their lastReadAt is at or past the
 * message timestamp. The sender is never counted as a reader of their own message.
 */
function readCountFor(message: ChatMessage): number {
  const sentAt = message.timestamp?.toMillis?.();
  if (sentAt == null) return 0;
  let count = 0;
  for (const [uid, state] of readReceipts) {
    if (uid === message.uid) continue;
    const readAt = state.lastReadAt?.toMillis?.();
    if (readAt != null && readAt >= sentAt) count += 1;
  }
  return count;
}

function paintReadReceipt(row: HTMLElement, message: ChatMessage): void {
  const node = row.querySelector<HTMLElement>('[data-role="read"]');
  if (!node) return;
  const count = message.uid === currentUser?.uid && !message.pending ? readCountFor(message) : 0;
  node.textContent = count > 1 ? `已讀 ${count}` : count === 1 ? '已讀' : '';
}

function refreshReadReceipts(): void {
  for (const row of messageList.querySelectorAll<HTMLElement>('.message-row.you[data-message-id]')) {
    const message = messages.get(row.dataset.messageId ?? '');
    if (message) paintReadReceipt(row, message);
  }
}

function renderRooms(): void {
  const sorted = [...rooms.values()].sort((a, b) => {
    const aTime = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
    const bTime = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
    return bTime - aTime || a.id.localeCompare(b.id, 'zh-TW');
  });
  roomCount.textContent = String(sorted.length);
  roomList.replaceChildren(...sorted.map(createRoomButton));
  renderChatHeads();
}

function isUnread(room: RoomPreview): boolean {
  if (room.id === currentRoom) return false;
  const readState = roomReadStates.get(room.id);
  return Boolean(room.lastMessage?.id && room.lastMessage.id !== readState?.lastReadMessageId);
}

function renderChatHeads(): void {
  const unread = [...rooms.values()]
    .filter(isUnread)
    .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
  chatHeads.hidden = unread.length === 0;
  if (!unread.length) {
    chatHeads.replaceChildren();
    return;
  }
  const shown = unread.slice(0, MAX_CHAT_HEADS);
  const nodes: HTMLElement[] = shown.map((room) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-head';
    button.dataset.roomId = room.id;
    button.title = `${room.id}：${room.lastMessage?.text ? truncate(room.lastMessage.text, 40) : '新訊息'}`;
    button.setAttribute('aria-label', `開啟聊天室 ${room.id}，有未讀訊息`);
    const face = document.createElement('span');
    face.className = 'chat-head-face';
    paintAvatar(face, room.lastMessage?.uid, room.lastMessage?.user || room.id);
    const badge = document.createElement('span');
    badge.className = 'chat-head-badge';
    badge.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'chat-head-name';
    name.textContent = room.id;
    button.append(face, badge, name);
    button.addEventListener('click', () => {
      // A drag ends with a click event on the bubble; ignore it so dragging the
      // stack around never opens a room by accident.
      if (Date.now() - lastChatHeadDragEnd < 250) return;
      void openRoom(room.id);
    });
    return button;
  });
  if (unread.length > shown.length) {
    const more = document.createElement('span');
    more.className = 'chat-head-more';
    more.textContent = `+${unread.length - shown.length}`;
    nodes.push(more);
  }
  chatHeads.replaceChildren(...nodes);
  applyChatHeadsPosition();
}

function applyChatHeadsPosition(): void {
  if (!chatHeadsPos) return;
  const rect = chatHeads.getBoundingClientRect();
  const maxX = Math.max(CHAT_HEAD_MARGIN, window.innerWidth - rect.width - CHAT_HEAD_MARGIN);
  const maxY = Math.max(CHAT_HEAD_MARGIN, window.innerHeight - rect.height - CHAT_HEAD_MARGIN);
  chatHeads.style.left = `${Math.min(Math.max(CHAT_HEAD_MARGIN, chatHeadsPos.x), maxX)}px`;
  chatHeads.style.top = `${Math.min(Math.max(CHAT_HEAD_MARGIN, chatHeadsPos.y), maxY)}px`;
  chatHeads.style.right = 'auto';
  chatHeads.style.bottom = 'auto';
}

function snapChatHeads(): void {
  if (!chatHeadsPos) return;
  const rect = chatHeads.getBoundingClientRect();
  const centre = rect.left + rect.width / 2;
  const maxY = Math.max(CHAT_HEAD_MARGIN, window.innerHeight - rect.height - CHAT_HEAD_MARGIN);
  // Persist the clamped position, not the raw pointer position: dragging past the
  // edge would otherwise store an off-screen value that survives reloads.
  chatHeadsPos = {
    x: centre < window.innerWidth / 2 ? CHAT_HEAD_MARGIN : window.innerWidth - rect.width - CHAT_HEAD_MARGIN,
    y: Math.min(Math.max(CHAT_HEAD_MARGIN, chatHeadsPos.y), maxY),
  };
  applyChatHeadsPosition();
  try {
    localStorage.setItem(CHAT_HEADS_KEY, JSON.stringify(chatHeadsPos));
  } catch { /* private mode: position just is not remembered */ }
}

chatHeads.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const rect = chatHeads.getBoundingClientRect();
  chatHeadsDrag = {
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
  chatHeads.setPointerCapture(event.pointerId);
});

chatHeads.addEventListener('pointermove', (event) => {
  if (!chatHeadsDrag || event.pointerId !== chatHeadsDrag.pointerId) return;
  if (!chatHeadsDrag.moved) {
    if (Math.hypot(event.clientX - chatHeadsDrag.startX, event.clientY - chatHeadsDrag.startY) < 5) return;
    chatHeadsDrag.moved = true;
    chatHeads.classList.add('dragging');
  }
  chatHeadsPos = { x: event.clientX - chatHeadsDrag.offsetX, y: event.clientY - chatHeadsDrag.offsetY };
  applyChatHeadsPosition();
});

function endChatHeadDrag(event: PointerEvent): void {
  if (!chatHeadsDrag || event.pointerId !== chatHeadsDrag.pointerId) return;
  const { moved } = chatHeadsDrag;
  if (chatHeads.hasPointerCapture(event.pointerId)) chatHeads.releasePointerCapture(event.pointerId);
  chatHeads.classList.remove('dragging');
  chatHeadsDrag = null;
  if (!moved) return;
  lastChatHeadDragEnd = Date.now();
  snapChatHeads();
}

chatHeads.addEventListener('pointerup', endChatHeadDrag);
chatHeads.addEventListener('pointercancel', endChatHeadDrag);
window.addEventListener('resize', applyChatHeadsPosition);

function createRoomButton(room: RoomPreview): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `room-item${room.id === currentRoom ? ' active' : ''}`;
  button.dataset.roomId = room.id;
  button.setAttribute('aria-current', room.id === currentRoom ? 'page' : 'false');

  const initial = document.createElement('span');
  initial.className = 'room-initial';
  initial.textContent = initialOf(room.id);
  const copy = document.createElement('span');
  copy.className = 'room-copy';
  const title = document.createElement('strong');
  title.textContent = room.id;
  const preview = document.createElement('span');
  preview.textContent = room.lastMessage?.text ? truncate(room.lastMessage.text, 30) : '尚無訊息';
  copy.append(title, preview);
  button.append(initial, copy);

  if (isUnread(room)) {
    const dot = document.createElement('span');
    dot.className = 'unread-dot';
    dot.title = '有未讀訊息';
    button.append(dot);
  }
  button.addEventListener('click', () => void openRoom(room.id));
  return button;
}

async function joinRoom(): Promise<void> {
  const error = validateRoomName(roomInput.value);
  roomError.textContent = error ?? '';
  if (error || !currentUser) return;
  const roomId = normalizeRoomName(roomInput.value);
  joinRoomBtn.disabled = true;
  try {
    const roomRef = doc(firestore, 'rooms', roomId);
    const existing = await getDoc(roomRef);
    if (!existing.exists()) {
      await setDoc(roomRef, {
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
        updatedAt: serverTimestamp(),
      });
    }
    roomInput.value = '';
    await openRoom(roomId);
  } catch (error_) {
    toast(error_ instanceof Error ? `無法加入聊天室：${error_.message}` : '無法加入聊天室', 'error');
  } finally {
    joinRoomBtn.disabled = false;
  }
}

joinRoomBtn.addEventListener('click', () => void joinRoom());
roomInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void joinRoom();
});

async function openRoom(roomId: string): Promise<void> {
  if (!currentUser || roomId === currentRoom) {
    setSidebar(false);
    return;
  }
  cleanupTyping();
  messageUnsub?.();
  readReceiptUnsub?.();
  messageUnsub = readReceiptUnsub = null;
  readReceipts.clear();
  currentRoom = roomId;
  messages.clear();
  pendingMessageIds.clear();
  oldestCursor = null;
  replyToId = null;
  editing = null;
  messageList.replaceChildren();
  failedOutbox.forEach((item, id) => { if (item.roomId === roomId) renderFailedOutbox(id, item); });
  messageSearch.value = '';
  currentRoomTitle.textContent = roomId;
  emptyState.hidden = true;
  messageView.hidden = false;
  messageInput.disabled = false;
  messageInput.placeholder = `傳送訊息到「${roomId}」`;
  sendBtn.disabled = false;
  replyBanner.hidden = true;
  editBanner.hidden = true;
  renderRooms();
  setSidebar(false);
  setupTyping(roomId);
  watchReadReceipts(roomId);

  const latestQuery = query(
    collection(firestore, 'rooms', roomId, 'messages'),
    orderBy('timestamp', 'desc'),
    limit(PAGE_SIZE),
  );
  messageUnsub = onSnapshot(latestQuery, { includeMetadataChanges: true }, (snapshot) => {
    if (roomId !== currentRoom) return;
    oldestCursor = snapshot.docs.at(-1) ?? oldestCursor;
    loadOlderBtn.hidden = snapshot.size < PAGE_SIZE;
    for (const change of snapshot.docChanges()) {
      const id = change.doc.id;
      if (change.type === 'removed') {
        void getDoc(change.doc.ref).then((current) => {
          if (!current.exists() && roomId === currentRoom) removeMessage(id);
        });
        continue;
      }
      const data = change.doc.data({ serverTimestamps: 'estimate' });
      const message = { id, ...data, pending: change.doc.metadata.hasPendingWrites } as ChatMessage;
      if (message.pending) pendingMessageIds.add(id); else pendingMessageIds.delete(id);
      messages.set(id, message);
      if (change.type === 'modified') patchMessage(id, message); else insertMessage(message);
    }
    filterMessages(messageSearch.value);
    const latest = [...messages.values()].sort(compareMessages).at(-1);
    if (latest) markRoomRead(roomId, latest.id);
  }, () => toast('訊息同步中斷，請重新選擇聊天室。', 'error'));
}

/** Opens the room a push notification pointed at, then drops the parameter so a
 *  later refresh does not keep yanking the user back to it. */
async function openRequestedRoom(): Promise<void> {
  const requested = new URLSearchParams(window.location.search).get('room');
  if (!requested) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  window.history.replaceState(null, '', url);
  await openRoom(requested);
}

navigator.serviceWorker?.addEventListener('message', (event) => {
  const data = recordOf(event.data);
  if (data.type === 'open-room' && typeof data.roomId === 'string') void openRoom(data.roomId);
});

loadOlderBtn.addEventListener('click', async () => {
  if (!currentRoom || !oldestCursor) return;
  loadOlderBtn.disabled = true;
  const oldHeight = messageList.scrollHeight;
  try {
    const olderQuery = query(
      collection(firestore, 'rooms', currentRoom, 'messages'),
      orderBy('timestamp', 'desc'),
      startAfter(oldestCursor),
      limit(PAGE_SIZE),
    );
    const snapshot = await getDocs(olderQuery);
    for (const messageDoc of snapshot.docs) {
      const message = { id: messageDoc.id, ...messageDoc.data({ serverTimestamps: 'estimate' }) } as ChatMessage;
      messages.set(message.id, message);
      insertMessage(message, false);
    }
    oldestCursor = snapshot.docs.at(-1) ?? oldestCursor;
    loadOlderBtn.hidden = snapshot.size < PAGE_SIZE;
    messageList.scrollTop += messageList.scrollHeight - oldHeight;
    filterMessages(messageSearch.value);
  } catch {
    toast('無法載入更早訊息。', 'error');
  } finally {
    loadOlderBtn.disabled = false;
  }
});

function createMessageRow(message: ChatMessage): HTMLElement {
  const row = document.createElement('article');
  row.className = `message-row${message.uid === currentUser?.uid ? ' you' : ''}`;
  row.dataset.messageId = message.id;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  paintAvatar(avatar, message.uid, message.user);
  const profile = document.createElement('div');
  profile.className = 'message-profile';
  const wrap = document.createElement('div');
  wrap.className = 'message-wrap';
  const author = document.createElement('p');
  author.className = 'message-author';
  author.textContent = message.uid === currentUser?.uid ? '你' : message.user;
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  const quote = document.createElement('div');
  quote.className = 'reply-quote';
  quote.hidden = true;
  const text = document.createElement('p');
  text.className = 'message-text';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const time = document.createElement('span');
  time.dataset.role = 'time';
  const sync = document.createElement('span');
  sync.dataset.role = 'sync';
  const read = document.createElement('span');
  read.dataset.role = 'read';
  meta.append(time, sync, read);
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  actions.append(actionButton('回覆', () => setReply(message.id)));
  if (message.uid === currentUser?.uid) {
    actions.append(
      actionButton('編輯', () => startEdit(message.id)),
      actionButton('刪除', () => void requestDelete(message.id), 'danger'),
    );
  }
  profile.append(avatar, author);
  bubble.append(quote, text, meta);
  wrap.append(bubble, actions);
  row.append(profile, wrap);
  patchMessageElement(row, message);
  return row;
}

function actionButton(label: string, action: () => void, variant?: 'danger'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  if (variant) button.className = variant;
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

function insertMessage(message: ChatMessage, scroll = true): void {
  if (messageList.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)) {
    patchMessage(message.id, message);
    return;
  }
  const row = createMessageRow(message);
  const sorted = [...messages.values()].sort(compareMessages);
  const index = sorted.findIndex((item) => item.id === message.id);
  const next = sorted[index + 1];
  const nextRow = next ? messageList.querySelector(`[data-message-id="${CSS.escape(next.id)}"]`) : null;
  messageList.insertBefore(row, nextRow);
  if (scroll && index === sorted.length - 1) messageList.scrollTop = messageList.scrollHeight;
}

function patchMessage(id: string, message: ChatMessage): void {
  const row = messageList.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
  if (!row) insertMessage(message);
  else patchMessageElement(row, message);
}

function patchMessageElement(row: HTMLElement, message: ChatMessage): void {
  row.classList.toggle('pending', Boolean(message.pending));
  row.querySelector<HTMLElement>('.message-text')!.textContent = message.text;
  row.querySelector<HTMLElement>('[data-role="time"]')!.textContent = `${formatMessageTime(message)}${message.editedAt ? ' · 已編輯' : ''}`;
  row.querySelector<HTMLElement>('[data-role="sync"]')!.textContent = message.pending ? '待同步' : '';
  paintReadReceipt(row, message);
  const quote = row.querySelector<HTMLElement>('.reply-quote')!;
  if (!message.replyToId) {
    quote.hidden = true;
  } else {
    quote.hidden = false;
    const target = messages.get(message.replyToId);
    if (target) quote.textContent = `${target.user}：${truncate(target.text)}`;
    else {
      quote.textContent = '正在載入引用…';
      const roomAtRequest = currentRoom;
      void getDoc(doc(firestore, 'rooms', currentRoom, 'messages', message.replyToId)).then((snapshot) => {
        if (!row.isConnected || roomAtRequest !== currentRoom) return;
        const data = snapshot.data();
        quote.textContent = snapshot.exists() ? `${String(data?.user ?? '使用者')}：${truncate(String(data?.text ?? ''))}` : '原訊息已刪除';
      }).catch(() => { quote.textContent = '無法載入引用'; });
    }
  }
}

function removeMessage(id: string): void {
  messages.delete(id);
  pendingMessageIds.delete(id);
  messageList.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.remove();
}

function setReply(messageId: string): void {
  const message = messages.get(messageId);
  if (!message) return;
  cancelEdit();
  replyToId = messageId;
  replySummary.textContent = `${message.user}：${truncate(message.text)}`;
  replyBanner.hidden = false;
  messageInput.focus();
}

function cancelReply(): void {
  replyToId = null;
  replyBanner.hidden = true;
}

cancelReplyBtn.addEventListener('click', cancelReply);

function startEdit(messageId: string): void {
  const message = messages.get(messageId);
  if (!message || message.uid !== currentUser?.uid) return;
  cancelReply();
  editing = { roomId: currentRoom, messageId };
  messageInput.value = message.text;
  messageCounter.textContent = `${message.text.length} / 1000`;
  editBanner.hidden = false;
  sendBtn.setAttribute('aria-label', '更新訊息');
  messageInput.focus();
}

function cancelEdit(): void {
  editing = null;
  editBanner.hidden = true;
  sendBtn.setAttribute('aria-label', '送出訊息');
  messageInput.value = '';
  resizeComposer();
}

cancelEditBtn.addEventListener('click', cancelEdit);

async function requestDelete(messageId: string): Promise<void> {
  const message = messages.get(messageId);
  if (!message || message.uid !== currentUser?.uid) return;
  if (!await showConfirm('刪除這則訊息？', '刪除後無法復原，引用它的訊息會顯示原訊息已刪除。', '刪除')) return;
  trackWrite(deleteDoc(doc(firestore, 'rooms', currentRoom, 'messages', messageId)));
}

function renderFailedOutbox(id: string, item: { roomId: string; text: string; replyToId?: string }): void {
  if (item.roomId !== currentRoom || messageList.querySelector(`[data-failed-id="${CSS.escape(id)}"]`)) return;
  const row = document.createElement('article');
  row.className = 'message-row you failed';
  row.dataset.failedId = id;
  const wrap = document.createElement('div');
  wrap.className = 'message-wrap';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  const text = document.createElement('p');
  text.className = 'message-text';
  text.textContent = item.text;
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = '傳送失敗';
  const retry = actionButton('重試', () => {
    failedOutbox.delete(id);
    row.remove();
    sendPayload(item.text, item.replyToId);
  });
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  actions.style.opacity = '1';
  actions.append(retry);
  bubble.append(text, meta);
  wrap.append(bubble, actions);
  row.append(wrap);
  messageList.append(row);
}

function sendPayload(text: string, replyId?: string): void {
  if (!currentUser || !currentRoom) return;
  const roomAtSend = currentRoom;
  const messageRef = doc(collection(firestore, 'rooms', roomAtSend, 'messages'));
  const roomRef = doc(firestore, 'rooms', roomAtSend);
  const batch = writeBatch(firestore);
  const messageData: Record<string, unknown> = {
    uid: currentUser.uid,
    user: currentUser.displayName || '匿名使用者',
    text,
    timestamp: serverTimestamp(),
    clientCreatedAt: Date.now(),
  };
  if (replyId) messageData.replyToId = replyId;
  batch.set(messageRef, messageData);
  batch.set(roomRef, {
    updatedAt: serverTimestamp(),
    lastMessage: {
      id: messageRef.id,
      uid: currentUser.uid,
      user: currentUser.displayName || '匿名使用者',
      text: truncate(text, 120),
      timestamp: serverTimestamp(),
    },
  }, { merge: true });
  trackWrite(batch.commit(), () => {
    const failedId = crypto.randomUUID();
    const item = { roomId: roomAtSend, text, ...(replyId ? { replyToId: replyId } : {}) };
    failedOutbox.set(failedId, item);
    renderFailedOutbox(failedId, item);
    toast('訊息被伺服器拒絕，已移到失敗匣。', 'error');
  });
}

function submitMessage(): void {
  const text = messageInput.value.trim();
  const error = validateMessage(text);
  if (error || !currentUser || !currentRoom) {
    if (error) toast(error, 'error');
    return;
  }
  if (editing) {
    if (editing.roomId !== currentRoom) {
      cancelEdit();
      toast('切換聊天室後無法更新原訊息。', 'error');
      return;
    }
    trackWrite(updateDoc(doc(firestore, 'rooms', currentRoom, 'messages', editing.messageId), {
      text,
      editedAt: serverTimestamp(),
    }));
    cancelEdit();
  } else {
    sendPayload(text, replyToId ?? undefined);
    messageInput.value = '';
    cancelReply();
  }
  resizeComposer();
}

sendBtn.addEventListener('click', submitMessage);
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submitMessage();
  }
});
messageInput.addEventListener('input', () => {
  resizeComposer();
  sendTyping();
});

function resizeComposer(): void {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 150)}px`;
  messageCounter.textContent = `${messageInput.value.length} / 1000`;
}

function markRoomRead(roomId: string, messageId: string): void {
  if (!currentUser || document.hidden || roomId !== currentRoom || lastMarkedByRoom.get(roomId) === messageId) return;
  lastMarkedByRoom.set(roomId, messageId);
  const batch = writeBatch(firestore);
  const value = { lastReadAt: serverTimestamp(), lastReadMessageId: messageId, updatedAt: serverTimestamp() };
  batch.set(doc(firestore, 'rooms', roomId, 'readStates', currentUser.uid), value, { merge: true });
  batch.set(doc(firestore, 'users', currentUser.uid, 'roomStates', roomId), value, { merge: true });
  trackWrite(batch.commit());
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentRoom) {
    const latest = [...messages.values()].sort(compareMessages).at(-1);
    if (latest) markRoomRead(currentRoom, latest.id);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  setSidebar(false);
  setPresencePanel(false);
  if (!searchBar.hidden) closeSearchBtn.click();
});

function setupPresence(user: User): void {
  cleanupPresence();
  const connectionsRef = ref(rtdb, `presenceV2/${user.uid}/connections`);
  presenceConnectionRef = push(connectionsRef);
  const lastOnlineRef = ref(rtdb, `presenceV2/${user.uid}/lastOnline`);
  const profileRef = ref(rtdb, `presenceV2/${user.uid}/profile`);
  void set(profileRef, { displayName: user.displayName || '匿名使用者' })
    .catch(() => toast('在線資料同步失敗。', 'error'));

  const connectedUnsub = onValue(ref(rtdb, '.info/connected'), (snapshot) => {
    if (snapshot.val() !== true || !presenceConnectionRef) return;
    presenceDisconnectRef = onDisconnect(presenceConnectionRef);
    lastOnlineDisconnectRef = onDisconnect(lastOnlineRef);
    void presenceDisconnectRef.remove()
      .then(() => lastOnlineDisconnectRef?.set(databaseServerTimestamp()))
      .then(() => set(presenceConnectionRef!, { connectedAt: databaseServerTimestamp() }))
      .catch(() => toast('在線狀態同步失敗。', 'error'));
  });
  const legacyUnsub = onValue(ref(rtdb, 'presence'), (snapshot) => {
    legacyPresence = recordOf(snapshot.val());
    renderPresence();
  });
  const v2Unsub = onValue(ref(rtdb, 'presenceV2'), (snapshot) => {
    v2Presence = recordOf(snapshot.val());
    renderPresence();
  });
  presenceUnsubs = [connectedUnsub, legacyUnsub, v2Unsub];
}

function cleanupPresence(): void {
  presenceUnsubs.forEach((unsubscribe) => unsubscribe());
  presenceUnsubs = [];
  if (presenceConnectionRef) void remove(presenceConnectionRef);
  void presenceDisconnectRef?.cancel();
  void lastOnlineDisconnectRef?.cancel();
  presenceConnectionRef = null;
  presenceDisconnectRef = null;
  lastOnlineDisconnectRef = null;
}

function renderPresence(): void {
  const users = new Map<string, OnlineUser>();
  for (const [uid, value] of Object.entries(legacyPresence)) {
    const legacy = recordOf(value);
    if (legacy.state === 'online') users.set(uid, { uid, displayName: String(legacy.displayName || '匿名使用者'), online: true });
  }
  for (const [uid, value] of Object.entries(v2Presence)) {
    const data = recordOf(value);
    const connections = recordOf(data.connections);
    if (Object.keys(connections).length) {
      const profile = recordOf(data.profile);
      users.set(uid, { uid, displayName: String(profile.displayName || users.get(uid)?.displayName || '匿名使用者'), online: true });
    }
  }
  const online = [...users.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-TW'));
  presenceCount.textContent = `${online.length} 位在線`;
  presenceList.replaceChildren(...online.map((user) => {
    const item = document.createElement('div');
    item.className = 'presence-item';
    const avatar = document.createElement('div');
    avatar.className = 'presence-avatar';
    paintAvatar(avatar, user.uid, user.displayName);
    const copy = document.createElement('div');
    copy.className = 'presence-copy';
    const name = document.createElement('strong');
    name.textContent = user.uid === currentUser?.uid ? `${user.displayName}（你）` : user.displayName;
    const status = document.createElement('span');
    status.textContent = '在線';
    copy.append(name, status);
    item.append(avatar, copy);
    return item;
  }));
}

function setupTyping(roomId: string): void {
  cleanupTyping();
  const roomKey = encodeRoomKey(roomId);
  if (!currentUser) return;
  typingConnectionRef = push(ref(rtdb, `typingV2/${roomKey}/${currentUser.uid}`));
  void onDisconnect(typingConnectionRef).remove();
  const v2Unsub = onValue(ref(rtdb, `typingV2/${roomKey}`), (snapshot) => {
    v2Typing = recordOf(snapshot.val());
    renderTyping();
  });
  typingUnsubs.push(v2Unsub);
  if (![...roomId].some((character) => ['.', '#', '$', '[', ']', '/'].includes(character))) {
    const legacyUnsub = onValue(ref(rtdb, `typing/${roomId}`), (snapshot) => {
      legacyTyping = recordOf(snapshot.val());
      renderTyping();
    });
    typingUnsubs.push(legacyUnsub);
  }
}

function cleanupTyping(): void {
  typingUnsubs.forEach((unsubscribe) => unsubscribe());
  typingUnsubs = [];
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = null;
  if (typingConnectionRef) void remove(typingConnectionRef);
  typingConnectionRef = null;
  legacyTyping = {};
  v2Typing = {};
  typingIndicator.replaceChildren();
}

function sendTyping(): void {
  if (!currentUser || !currentRoom || !typingConnectionRef) return;
  if (typingTimer) clearTimeout(typingTimer);
  void set(typingConnectionRef, {
    displayName: currentUser.displayName || '匿名使用者',
    updatedAt: databaseServerTimestamp(),
  }).catch(() => toast('打字狀態同步失敗。', 'error'));
  typingTimer = setTimeout(() => {
    if (typingConnectionRef) void remove(typingConnectionRef);
    typingTimer = null;
  }, 1800);
}

function renderTyping(): void {
  const names = new Set<string>();
  for (const [uid, value] of Object.entries(legacyTyping)) {
    const entry = recordOf(value);
    if (uid !== currentUser?.uid && entry.name) names.add(String(entry.name));
  }
  for (const [uid, value] of Object.entries(v2Typing)) {
    if (uid === currentUser?.uid) continue;
    const connections = recordOf(value);
    for (const connection of Object.values(connections)) {
      const entry = recordOf(connection);
      if (entry.displayName) names.add(String(entry.displayName));
    }
  }
  const list = [...names];
  typingIndicator.replaceChildren();
  if (!list.length) return;
  const chip = document.createElement('span');
  chip.className = 'typing-chip';
  const dots = document.createElement('span');
  dots.className = 'typing-dots';
  dots.setAttribute('aria-hidden', 'true');
  dots.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  const label = document.createElement('span');
  label.className = 'typing-label';
  label.textContent = list.length > 2
    ? `${list.slice(0, 2).join('、')} 等 ${list.length} 人正在輸入`
    : `${list.join('、')} 正在輸入`;
  chip.append(dots, label);
  typingIndicator.append(chip);
}

window.addEventListener('beforeunload', (event) => {
  if (hasPendingWork()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

/**
 * onDisconnect alone leaves us online for however long the Realtime Database takes
 * to notice the socket died (tens of seconds). Releasing the connection node on
 * pagehide makes departures show up on other clients immediately. pagehide fires on
 * mobile Safari/Chrome where beforeunload does not.
 */
window.addEventListener('pagehide', () => {
  if (typingConnectionRef) void remove(typingConnectionRef);
  if (presenceConnectionRef) void remove(presenceConnectionRef);
});

// Production only. Against the dev server the cached shell shadows every edit,
// so changes appear to do nothing until the cache is cleared by hand.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}firebase-messaging-sw.js`, { scope: import.meta.env.BASE_URL })
      .then((registration) => {
        if (registration.waiting) toast('有新版本可用，重新載入即可更新。');
        registration.addEventListener('updatefound', () => {
          registration.installing?.addEventListener('statechange', () => {
            if (registration.waiting && navigator.serviceWorker.controller) toast('Chat Lite 已更新，重新載入即可套用。');
          });
        });
      })
      .catch(() => toast('離線功能暫時無法啟用。', 'error'));
  });
}
