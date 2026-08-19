import type { AuthenticatedUser } from '../auth/auth.repository';
import { saveOwnProfile } from '../auth/profile.repository';
import type { CallUIController } from '../calls/call-ui.controller';
import { bindOfflineSettings } from '../firebase/offline-settings.controller';
import type { MediaUploadController } from '../media/media-upload.controller';
import type { VoiceMessageController } from '../media/voice-message.controller';
import { PaginatedMessageStore } from '../messages/message-store';
import {
  editTextMessage,
  loadOlderMessages,
  sendTextMessage,
  setReaction,
  softDeleteMessage,
  watchActiveCalls,
  watchReadStates,
  watchReactions,
  watchRecentMessages,
  watchRoomMembers,
  type MessagePage,
} from '../messages/message.repository';
import { requireValidMessage, structuredMentions } from '../messages/message.service';
import type { GlobalPresenceSession, RealtimeRoomSession } from '../realtime/realtime.repository';
import {
  escalateConnectionState,
  INITIAL_CONNECTION_STATE,
  nextConnectionState,
  RECONNECT_GRACE_MS,
  type RealtimeConnectionEvent,
  type RealtimeConnectionState,
} from '../realtime/connection-status';
import { onlineRoomMembers } from '../realtime/presence-state';
import { TypingSignal } from '../realtime/typing-signal';
import { markRoomRead, watchAvailableRooms } from '../rooms/room.repository';
import type {
  ChatMessage,
  OnlineUser,
  Reaction,
  RoomCall,
  RoomMembership,
  RoomPreview,
  RoomReadState,
} from '../types';
import { compareMessages, initialOf, truncate } from '../utils';
import { createPresenceView, renderConnectionStatus, type PresenceView } from '../realtime/presence.view';
import { createRoomListView, type RoomListView } from '../rooms/room.view';
import { RoomScope, SessionScope } from './lifecycle';
import {
  actionButton,
  createMessageView,
  firstVisibleMessage,
  type MessageView,
  pinToEnd,
  reactionSignatures,
  textOf,
} from '../messages/message.view';
import { applyTheme, preferredTheme, storeTheme, watchSystemTheme, type Theme } from './theme';


/**
 * A call the user asked for but that has not reached the call controller yet.
 * It exists so the press is acknowledged in the same task it happened in, long
 * before the call chunk, the callables or the transport SDK have loaded.
 */
interface PendingCall {
  kind: 'voice' | 'video';
  cancelled: boolean;
  /**
   * Set as soon as the call chunk resolves. Cancelling has to reach the
   * controller while `begin()` is still running - that is what aborts the token
   * request, the transport connect and the media prompt - so the button cannot
   * wait for `begin()` to settle before it acts.
   */
  controller: CallUIController | null;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const ui = {
  sidebar: byId<HTMLElement>('room-sidebar'),
  sidebarScrim: byId<HTMLButtonElement>('sidebar-scrim'),
  openSidebar: byId<HTMLButtonElement>('open-sidebar-btn'),
  closeSidebar: byId<HTMLButtonElement>('close-sidebar-btn'),
  roomName: byId<HTMLInputElement>('room-name'),
  roomError: byId<HTMLElement>('room-error'),
  joinRoom: byId<HTMLButtonElement>('join-room-btn'),
  roomList: byId<HTMLElement>('room-list'),
  roomCount: byId<HTMLElement>('room-count'),
  roomTitle: byId<HTMLElement>('current-room-title'),
  connection: byId<HTMLElement>('connection-status'),
  empty: byId<HTMLElement>('empty-state'),
  messageView: byId<HTMLElement>('message-view'),
  messageList: byId<HTMLElement>('message-list'),
  loadOlder: byId<HTMLButtonElement>('load-older-btn'),
  input: byId<HTMLTextAreaElement>('message-input'),
  send: byId<HTMLButtonElement>('send-btn'),
  counter: byId<HTMLElement>('message-counter'),
  typing: byId<HTMLElement>('typing-indicator'),
  replyBanner: byId<HTMLElement>('reply-banner'),
  replySummary: byId<HTMLElement>('reply-summary'),
  cancelReply: byId<HTMLButtonElement>('cancel-reply-btn'),
  editBanner: byId<HTMLElement>('edit-banner'),
  cancelEdit: byId<HTMLButtonElement>('cancel-edit-btn'),
  searchBar: byId<HTMLElement>('search-bar'),
  searchInput: byId<HTMLInputElement>('message-search'),
  searchToggle: byId<HTMLButtonElement>('search-toggle-btn'),
  closeSearch: byId<HTMLButtonElement>('close-search-btn'),
  historicalSearch: byId<HTMLButtonElement>('historical-search-btn'),
  theme: byId<HTMLInputElement>('theme-toggle'),
  offline: byId<HTMLInputElement>('offline-toggle'),
  offlineStatus: byId<HTMLElement>('offline-status'),
  offlineRetry: byId<HTMLButtonElement>('offline-retry-btn'),
  pushRow: byId<HTMLInputElement>('push-toggle').closest<HTMLElement>('.setting-row')!,
  push: byId<HTMLInputElement>('push-toggle'),
  presencePanel: byId<HTMLElement>('presence-panel'),
  membersToggle: byId<HTMLButtonElement>('members-toggle-btn'),
  closeMembers: byId<HTMLButtonElement>('close-members-btn'),
  presenceList: byId<HTMLElement>('presence-list'),
  presenceCount: byId<HTMLElement>('presence-count'),
  accountAvatar: byId<HTMLElement>('account-avatar'),
  accountName: byId<HTMLElement>('account-name'),
  accountEmail: byId<HTMLElement>('account-email'),
  toastRegion: byId<HTMLElement>('toast-region'),
  confirmDialog: byId<HTMLDialogElement>('confirm-dialog'),
  confirmTitle: byId<HTMLElement>('confirm-title'),
  confirmCopy: byId<HTMLElement>('confirm-copy'),
  confirmAction: byId<HTMLButtonElement>('confirm-action-btn'),
  mentionList: byId<HTMLElement>('mention-list'),
  attach: byId<HTMLButtonElement>('attach-btn'),
  attachmentInput: byId<HTMLInputElement>('attachment-input'),
  uploadCancel: byId<HTMLButtonElement>('upload-cancel-btn'),
  voiceMessage: byId<HTMLButtonElement>('voice-message-btn'),
  voiceControls: byId<HTMLElement>('voice-controls'),
  voiceStatus: byId<HTMLElement>('voice-status'),
  voicePause: byId<HTMLButtonElement>('voice-pause-btn'),
  voiceCancel: byId<HTMLButtonElement>('voice-cancel-btn'),
  voiceFinish: byId<HTMLButtonElement>('voice-finish-btn'),
  voicePreviewDialog: byId<HTMLDialogElement>('voice-preview-dialog'),
  voicePreviewAudio: byId<HTMLAudioElement>('voice-preview-audio'),
  sticker: byId<HTMLButtonElement>('sticker-btn'),
  stickerPicker: byId<HTMLElement>('sticker-picker'),
  customSticker: byId<HTMLButtonElement>('custom-sticker-btn'),
  customStickerInput: byId<HTMLInputElement>('custom-sticker-input'),
  uploadStatus: byId<HTMLElement>('upload-status'),
  voiceCall: byId<HTMLButtonElement>('voice-call-btn'),
  videoCall: byId<HTMLButtonElement>('video-call-btn'),
  callPending: byId<HTMLElement>('call-pending'),
  callPendingLabel: byId<HTMLElement>('call-pending-label'),
  callPendingCancel: byId<HTMLButtonElement>('call-pending-cancel'),
};

let user: AuthenticatedUser | null = null;
let sessionScope: SessionScope | null = null;
let roomScope: RoomScope | null = null;
let realtime: RealtimeRoomSession | null = null;
let globalPresence: GlobalPresenceSession | null = null;
let presenceUnsubscribe: (() => void) | null = null;
let roomId = '';
let rooms = new Map<string, RoomPreview>();
let roomStates = new Map<string, RoomReadState>();
const messageStore = new PaginatedMessageStore();
const messages = messageStore.byId;
const messageRows = new Map<string, HTMLElement>();
let messagePositions = new Map<string, number>();
let members: RoomMembership[] = [];
let readStates = new Map<string, RoomReadState>();
let activeCalls = new Map<string, RoomCall>();
let reactions: Reaction[] = [];
let onlineUsers: OnlineUser[] = [];
let oldest: MessagePage['oldest'] = null;
let hasOlder = false;
let historyLoaded = false;
let reactionUnsubscribe: (() => void) | null = null;
let reactionWatchKey = '';
let replyToId: string | undefined;
let editingId: string | undefined;
let typingSignal: TypingSignal | null = null;
let connectionState: RealtimeConnectionState = INITIAL_CONNECTION_STATE;
let connectionEscalation: number | undefined;
let pendingCall: PendingCall | null = null;
let mentionChoices: Array<{ type: 'user' | 'bot'; id: string; label: string }> = [];
let mentionIndex = 0;
let mediaController: MediaUploadController | null = null;
let callController: CallUIController | null = null;
let voiceController: VoiceMessageController | null = null;
let pushConfiguration: Promise<void> | null = null;
const localAiRuns = new Set<string>();

/**
 * The row renderer. Every binding below is read through a getter because the
 * controller reassigns them as rooms and sessions change.
 */
const roomListView: RoomListView = createRoomListView({
  list: ui.roomList,
  count: ui.roomCount,
  rooms: () => rooms.values(),
  roomCount: () => rooms.size,
  roomState: (id) => roomStates.get(id),
  activeRoomId: () => roomId,
  onSelect: (room) => void selectRoom(room),
});

const presenceView: PresenceView = createPresenceView({
  list: ui.presenceList,
  count: ui.presenceCount,
  onlineUsers: () => onlineUsers,
  hasRoom: () => Boolean(roomId),
});

const messageView: MessageView = createMessageView({
  currentUser: () => user,
  message: (id) => messages.get(id),
  messagePosition: (id) => messagePositions.get(id),
  readStates: () => readStates.values(),
  reactions: () => reactions,
  activeCall: (callId) => activeCalls.get(callId),
  callActive: () => Boolean(callController?.active),
  onReply: (message) => setReply(message),
  onEdit: (message) => startEditing(message),
  onDelete: (message) => void deleteMessage(message),
  onJoinCall: (targetRoomId, call) => void joinCall(targetRoomId, call),
  onReact: (messageId, emoji) => {
    if (!user || !roomId) return;
    void setReaction(roomId, messageId, user.uid, emoji).catch((error) => toast(errorText(error), 'error'));
  },
});

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^Firebase(?:Error)?:\s*/u, '');
  return String(error);
}

function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const element = document.createElement('div');
  element.className = `toast${kind === 'error' ? ' error' : ''}`;
  element.textContent = message;
  ui.toastRegion.append(element);
  window.setTimeout(() => element.remove(), 4500);
}

function setTheme(theme: Theme): void {
  applyTheme(theme);
  ui.theme.checked = theme === 'dark';
}

function setSidebar(open: boolean): void {
  ui.sidebar.classList.toggle('open', open);
  ui.openSidebar.setAttribute('aria-expanded', String(open));
  ui.sidebarScrim.hidden = !open;
}

function setPresence(open: boolean): void {
  ui.presencePanel.classList.toggle('open', open);
  ui.membersToggle.setAttribute('aria-expanded', String(open));
}

function setRoomControls(enabled: boolean): void {
  for (const control of [ui.input, ui.send, ui.attach, ui.voiceMessage, ui.sticker]) {
    control.disabled = !enabled;
  }
  // `pendingCall` covers the window between the press and the call controller
  // existing, which is exactly when a second press would start a second call.
  const callBusy = Boolean(callController?.active) || Boolean(pendingCall);
  ui.voiceCall.disabled = !enabled || callBusy;
  ui.videoCall.disabled = !enabled || callBusy;
  ui.input.placeholder = enabled ? '輸入訊息或使用 @ 提及…' : '先選擇聊天室…';
}

function showConfirm(title: string, copy: string, action = '確認'): Promise<boolean> {
  ui.confirmTitle.textContent = title;
  ui.confirmCopy.textContent = copy;
  ui.confirmAction.textContent = action;
  ui.confirmDialog.showModal();
  return new Promise((resolve) => {
    ui.confirmDialog.addEventListener('close', () => resolve(ui.confirmDialog.returnValue === 'confirm'), { once: true });
  });
}

function closeRoom(): void {
  mediaController?.dispose();
  mediaController = null;
  voiceController?.dispose();
  voiceController = null;
  roomScope?.dispose();
  roomScope = null;
  reactionUnsubscribe?.();
  reactionUnsubscribe = null;
  presenceUnsubscribe?.();
  presenceUnsubscribe = null;
  if (realtime) void realtime.close();
  realtime = null;
  roomId = '';
  messageStore.clear();
  messageRows.clear();
  messagePositions.clear();
  historyLoaded = false;
  oldest = null;
  hasOlder = false;
  reactionWatchKey = '';
  members = [];
  onlineUsers = [];
  reactions = [];
  readStates.clear();
  ui.roomTitle.textContent = '選擇聊天室';
  ui.empty.hidden = false;
  ui.messageView.hidden = true;
  ui.messageList.replaceChildren();
  ui.typing.textContent = '';
  // The header and the member list both describe the room that just closed.
  // Leaving them as they were is what made a switched-away room look connected.
  pushConnection({ type: 'closed' });
  presenceView.render();
  setRoomControls(false);
  roomListView.render();
}

function cleanupSession(): void {
  closeRoom();
  callController?.dispose();
  callController = null;
  if (globalPresence) void globalPresence.close();
  globalPresence = null;
  sessionScope?.dispose();
  sessionScope = null;
  void import('../notifications/push').then(({ stopForegroundPush }) => stopForegroundPush());
  rooms.clear();
  roomStates.clear();
  user = null;
}

async function selectRoom(room: RoomPreview): Promise<void> {
  if (!user) return;
  if (roomStates.get(room.id)?.membershipStatus !== 'active') {
    try {
      ui.roomError.textContent = '';
      const { createOrJoinPublicRoom } = await import('../rooms/room.service');
      const result = await createOrJoinPublicRoom(room.name);
      if (!result.realtimeReady) toast('房間已加入；即時狀態同步中。');
    } catch (error) {
      toast(errorText(error), 'error');
      return;
    }
  }
  await openRoom(room.id);
}

async function joinNamedRoom(): Promise<void> {
  ui.roomError.textContent = '';
  ui.joinRoom.disabled = true;
  try {
    const { createOrJoinPublicRoom } = await import('../rooms/room.service');
    const result = await createOrJoinPublicRoom(ui.roomName.value);
    ui.roomName.value = '';
    if (!result.realtimeReady) toast('房間已建立；即時狀態同步中。');
    await openRoom(result.roomId);
  } catch (error) {
    ui.roomError.textContent = errorText(error);
  } finally {
    ui.joinRoom.disabled = false;
  }
}

async function openRoom(nextRoomId: string): Promise<void> {
  if (!user || roomId === nextRoomId) return;
  closeRoom();
  roomId = nextRoomId;
  const selectedRoom = rooms.get(roomId);
  ui.roomTitle.textContent = selectedRoom?.name || roomId;
  ui.empty.hidden = true;
  ui.messageView.hidden = false;
  setRoomControls(true);
  setSidebar(false);
  roomListView.render();
  const scope = new RoomScope();
  roomScope = scope;
  pushConnection({ type: 'opening' });

  scope.add(watchRecentMessages(roomId, (page) => {
    const priorCount = messages.size;
    const merged = messageStore.mergeLive(page.messages, page.changedIds);
    if (!historyLoaded) {
      oldest = page.oldest;
      hasOlder = page.hasMore;
    }
    ui.loadOlder.hidden = !hasOlder;
    renderMessageChanges(merged.changedIds, { scroll: priorCount === 0 });
    if (merged.addedIds.size) watchVisibleReactions();
    const newest = page.messages.at(-1);
    if (newest && user && !document.hidden) void markRoomRead(user.uid, roomId, newest.id).catch(() => undefined);
  }, handleRoomAccessError));
  scope.add(watchRoomMembers(roomId, (value) => {
    members = value;
    updateMentionList();
    watchMemberPresence();
  }, handleRoomAccessError));
  scope.add(watchActiveCalls(roomId, (value) => {
    activeCalls = value;
    renderCallMessages();
  }, handleRoomAccessError));
  scope.add(watchReadStates(roomId, (value) => {
    readStates = value;
    updateReadReceipts();
  }, handleRoomAccessError));
  scope.add(() => reactionUnsubscribe?.());

  try {
    const { connectRealtimeRoom, watchRealtimeConnection } = await import('../realtime/realtime.repository');
    const roomRealtime = await connectRealtimeRoom(roomId, {
      uid: user.uid,
      displayName: user.displayName || '使用者',
    });
    if (scope.signal.aborted) {
      await roomRealtime.close();
      return;
    }
    realtime = roomRealtime;
    const signal = new TypingSignal(roomRealtime, () => failClosedRealtime());
    typingSignal = signal;
    scope.add(() => {
      signal.dispose();
      if (typingSignal === signal) typingSignal = null;
    });
    pushConnection({ type: 'established' });
    // Every one of these can be delivered after the user has already switched
    // rooms — dispose() stops future events, not the one already queued — so the
    // owning scope is checked before any of them touches shared chrome.
    scope.add(watchRealtimeConnection(
      (connected) => {
        if (scope !== roomScope) return;
        pushConnection({ type: 'socket', connected, at: Date.now() });
      },
      () => { if (scope === roomScope) failClosedRealtime(); },
    ));
    scope.add(roomRealtime.watchTyping((names) => {
      if (scope !== roomScope) return;
      ui.typing.textContent = names.length ? `${names.slice(0, 3).join('、')} 正在輸入…` : '';
    }, () => { if (scope === roomScope) failClosedRealtime(); }));
    scope.add(roomRealtime.watchAiDrafts((drafts) => {
      if (scope !== roomScope) return;
      renderRemoteDrafts(drafts);
    }, () => { if (scope === roomScope) failClosedRealtime(); }));
    scope.add(() => void roomRealtime.close());
  } catch {
    if (scope === roomScope) failClosedRealtime();
  }
}

function handleRoomAccessError(error: Error): void {
  toast(`房間已關閉：${errorText(error)}`, 'error');
  closeRoom();
}

function failClosedRealtime(): void {
  pushConnection({ type: 'unauthorized' });
  ui.typing.textContent = '';
}

function failClosedPresence(): void {
  onlineUsers = [];
  presenceView.render();
}

function pushConnection(event: RealtimeConnectionEvent): void {
  applyConnectionState(nextConnectionState(connectionState, event));
}

function applyConnectionState(next: RealtimeConnectionState): void {
  if (next === connectionState) return;
  connectionState = next;
  renderConnectionStatus(ui.connection, connectionState);
  armConnectionEscalation();
}

/**
 * A socket that stays down emits nothing, so `reconnecting` would never become
 * `offline` on its own. The timer is what keeps a debounced blip from turning
 * into a permanently optimistic header.
 */
function armConnectionEscalation(): void {
  if (connectionEscalation !== undefined) window.clearTimeout(connectionEscalation);
  connectionEscalation = undefined;
  if (connectionState.phase !== 'reconnecting' || connectionState.downSince === null) return;
  const wait = Math.max(0, connectionState.downSince + RECONNECT_GRACE_MS - Date.now());
  connectionEscalation = window.setTimeout(() => {
    connectionEscalation = undefined;
    applyConnectionState(escalateConnectionState(connectionState, Date.now()));
  }, wait);
}


/** Set when this client sends, so its own message wins over the follow check. */
let scrollAfterNextRender = false;

interface MessageRenderOptions {
  scroll?: boolean;
  preservePrependAnchor?: boolean;
}

function refreshMessagePositions(ordered: readonly ChatMessage[]): void {
  messagePositions = new Map(ordered.map((message, index) => [message.id, index]));
}

function placeMessageRow(row: HTMLElement, messageId: string, ordered: readonly ChatMessage[]): void {
  const position = messagePositions.get(messageId) ?? -1;
  for (let index = position + 1; index < ordered.length; index += 1) {
    const next = ordered[index];
    const nextRow = next ? messageRows.get(next.id) : undefined;
    if (nextRow?.isConnected) {
      ui.messageList.insertBefore(row, nextRow);
      return;
    }
  }
  const draft = ui.messageList.querySelector<HTMLElement>('.ai-draft');
  ui.messageList.insertBefore(row, draft);
}

/** Updates only changed keyed rows. Unrelated media elements remain mounted. */
function renderMessageChanges(changedMessageIds: Iterable<string>, options: MessageRenderOptions = {}): void {
  const list = ui.messageList;
  const previousTop = list.scrollTop;
  const anchor = options.preservePrependAnchor ? firstVisibleMessage(list) : null;
  const follow = !options.preservePrependAnchor && (options.scroll || scrollAfterNextRender
    || list.scrollHeight - previousTop - list.clientHeight <= 80);
  scrollAfterNextRender = false;
  const ordered = messageStore.ordered();
  refreshMessagePositions(ordered);
  const changed = new Set(changedMessageIds);
  for (const message of ordered) {
    if (message.replyToId && changed.has(message.replyToId)) changed.add(message.id);
  }
  for (const message of ordered) {
    if (!changed.has(message.id) && messageRows.has(message.id)) continue;
    const prior = messageRows.get(message.id);
    const row = messageView.renderMessage(message);
    messageRows.set(message.id, row);
    if (prior?.isConnected) prior.replaceWith(row);
    placeMessageRow(row, message.id, ordered);
  }
  applyMessageFilter();
  if (follow) {
    pinToEnd(list);
  } else if (anchor?.row.isConnected) {
    const currentOffset = anchor.row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTop += currentOffset - anchor.offset;
  } else {
    list.scrollTop = previousTop;
  }
}

function applyMessageFilter(): void {
  const query = ui.searchInput.value.trim().toLocaleLowerCase('zh-Hant');
  for (const [messageId, row] of messageRows) {
    const message = messages.get(messageId);
    const matches = message && (!query || textOf(message).toLocaleLowerCase('zh-Hant').includes(query));
    row.classList.toggle('filtered-out', !matches);
  }
}

function updateReadReceipts(): void {
  for (const [messageId, row] of messageRows) {
    const message = messages.get(messageId);
    const target = row.querySelector<HTMLElement>('[data-role="read"]');
    if (!message || !target || message.senderId !== user?.uid) continue;
    const count = Math.max(0, messageView.messageReadCount(messageId) - 1);
    target.textContent = count ? `${count} 人已讀` : '';
  }
}

function renderCallMessages(): void {
  renderMessageChanges(messageStore.ordered()
    .filter((message) => message.kind === 'call')
    .map((message) => message.id));
}

function watchVisibleReactions(): void {
  const ids = messageStore.ordered().map((message) => message.id).slice(-60);
  const nextWatchKey = ids.join('\n');
  if (nextWatchKey === reactionWatchKey) return;
  reactionWatchKey = nextWatchKey;
  reactionUnsubscribe?.();
  reactionUnsubscribe = watchReactions(roomId, ids, (value) => {
    const priorSignatures = reactionSignatures(reactions);
    const nextSignatures = reactionSignatures(value);
    reactions = value;
    const changed = new Set([...priorSignatures.keys(), ...nextSignatures.keys()]
      .filter((messageId) => priorSignatures.get(messageId) !== nextSignatures.get(messageId)));
    updateReactionBars(changed);
  }, (error) => toast(errorText(error), 'error'));
}

function updateReactionBars(messageIds: Iterable<string>): void {
  for (const messageId of messageIds) {
    const message = messages.get(messageId);
    const row = messageRows.get(messageId);
    const prior = row?.querySelector<HTMLElement>('.reaction-bar');
    if (message && prior) prior.replaceWith(messageView.renderReactionBar(message));
  }
}

function setReply(message: ChatMessage): void {
  replyToId = message.id;
  ui.replySummary.textContent = `${message.senderDisplayName}：${truncate(textOf(message), 80)}`;
  ui.replyBanner.hidden = false;
  ui.input.focus();
}

function cancelReply(): void {
  replyToId = undefined;
  ui.replyBanner.hidden = true;
}

function startEditing(message: ChatMessage): void {
  if (message.kind !== 'text') return;
  editingId = message.id;
  ui.input.value = message.text;
  ui.editBanner.hidden = false;
  cancelReply();
  updateComposer();
  ui.input.focus();
}

function cancelEditing(): void {
  editingId = undefined;
  ui.editBanner.hidden = true;
  ui.input.value = '';
  updateComposer();
}

async function deleteMessage(message: ChatMessage): Promise<void> {
  if (!await showConfirm('刪除訊息', '訊息會標記為已刪除。', '刪除')) return;
  try {
    await softDeleteMessage(message.roomId, message.id);
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

async function submitMessage(): Promise<void> {
  if (!user || !roomId || ui.send.disabled) return;
  try {
    const text = requireValidMessage(ui.input.value);
    const mentions = structuredMentions(text, members);
    ui.send.disabled = true;
    if (editingId) {
      await editTextMessage(roomId, editingId, text, mentions);
      cancelEditing();
      return;
    }
    // Firestore echoes the write locally, so watchRecentMessages can fire while
    // this await is still pending. Arming the flag afterwards is too late - that
    // render has already decided not to scroll, and on a phone the sender is
    // often a little short of the end, so the follow check does not cover it.
    scrollAfterNextRender = true;
    const sourceMessageId = await sendTextMessage({
      roomId,
      senderId: user.uid,
      senderDisplayName: user.displayName || '使用者',
      text,
      mentions,
      ...(replyToId ? { replyToId } : {}),
    });
    ui.input.value = '';
    cancelReply();
    updateComposer();
    if (mentions.some((mention) => mention.type === 'bot' && mention.id === 'gemini')) {
      void streamGemini(sourceMessageId);
    }
  } catch (error) {
    toast(errorText(error), 'error');
  } finally {
    ui.send.disabled = !roomId;
  }
}

async function streamGemini(sourceMessageId: string): Promise<void> {
  const requestedRoom = roomId;
  const controller = new AbortController();
  roomScope?.add(() => controller.abort());
  localAiRuns.add(`${sourceMessageId}_gemini`);
  const row = renderAiDraft(`${sourceMessageId}_gemini`, '', true, () => controller.abort());
  ui.messageList.append(row);
  try {
    const { GeminiProvider } = await import('../bots/providers/gemini-provider');
    const generation = await new GeminiProvider().generate(
      { roomId: requestedRoom, sourceMessageId, botId: 'gemini' },
      controller.signal,
    );
    for await (const chunk of generation.stream) {
      const text = row.querySelector<HTMLElement>('.message-text');
      if (text) text.textContent = `${text.textContent || ''}${chunk.text}`;
      ui.messageList.scrollTop = ui.messageList.scrollHeight;
    }
    await generation.result;
  } catch (error) {
    if (!controller.signal.aborted) toast(`Gemini 回覆失敗：${errorText(error)}`, 'error');
  } finally {
    localAiRuns.delete(`${sourceMessageId}_gemini`);
    row.remove();
  }
}

function renderRemoteDrafts(drafts: Map<string, { botId: string; text: string; status: string }>): void {
  document.querySelectorAll('[data-remote-ai-draft]').forEach((element) => element.remove());
  for (const [runId, draft] of drafts) {
    if (localAiRuns.has(runId) || draft.status !== 'streaming') continue;
    const row = renderAiDraft(runId, draft.text, false);
    row.dataset.remoteAiDraft = 'true';
    ui.messageList.append(row);
  }
}

function renderAiDraft(runId: string, text: string, cancellable: boolean, cancel?: () => void): HTMLElement {
  const row = document.createElement('article');
  row.className = 'message-row ai-draft';
  row.dataset.runId = runId;
  const wrap = document.createElement('div');
  wrap.className = 'message-wrap';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  const content = document.createElement('p');
  content.className = 'message-text';
  content.textContent = text || 'Gemini 正在思考…';
  bubble.append(content);
  wrap.append(bubble);
  if (cancellable && cancel) wrap.append(actionButton('停止生成', cancel));
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = 'G';
  row.append(avatar, wrap);
  return row;
}

function updateComposer(): void {
  ui.counter.textContent = `${ui.input.value.length} / 1000`;
  ui.input.style.height = 'auto';
  ui.input.style.height = `${Math.min(ui.input.scrollHeight, 150)}px`;
  updateMentionList();
  // The signal is bound to one room session and owned by that room's scope, so
  // a delayed cleanup can never reach the room the user switched to.
  typingSignal?.update(Boolean(ui.input.value.trim()));
}

function updateMentionList(): void {
  const beforeCursor = ui.input.value.slice(0, ui.input.selectionStart);
  const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/u);
  if (!match) {
    closeMentionList();
    return;
  }
  const needle = (match[1] || '').toLocaleLowerCase('zh-Hant');
  mentionChoices = [
    { type: 'bot' as const, id: 'gemini', label: 'Gemini' },
    ...members.filter((member) => member.userId !== user?.uid).map((member) => ({
      type: 'user' as const,
      id: member.userId,
      label: member.displayName,
    })),
  ].filter((choice) => choice.label.toLocaleLowerCase('zh-Hant').includes(needle)).slice(0, 8);
  mentionIndex = Math.min(mentionIndex, Math.max(0, mentionChoices.length - 1));
  ui.mentionList.replaceChildren();
  mentionChoices.forEach((choice, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.role = 'option';
    option.id = `mention-option-${index}`;
    option.setAttribute('aria-selected', String(index === mentionIndex));
    option.textContent = `@${choice.label}${choice.type === 'bot' ? ' · AI' : ''}`;
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', () => insertMention(index));
    ui.mentionList.append(option);
  });
  ui.mentionList.hidden = mentionChoices.length === 0;
  ui.input.setAttribute('aria-expanded', String(mentionChoices.length > 0));
  if (mentionChoices.length) ui.input.setAttribute('aria-activedescendant', `mention-option-${mentionIndex}`);
}

function closeMentionList(): void {
  mentionChoices = [];
  ui.mentionList.hidden = true;
  ui.input.setAttribute('aria-expanded', 'false');
  ui.input.removeAttribute('aria-activedescendant');
}

function insertMention(index: number): void {
  const choice = mentionChoices[index];
  if (!choice) return;
  const cursor = ui.input.selectionStart;
  const before = ui.input.value.slice(0, cursor);
  const start = before.lastIndexOf('@');
  ui.input.setRangeText(`@${choice.label} `, start, cursor, 'end');
  closeMentionList();
  updateComposer();
  ui.input.focus();
}

async function loadOlder(): Promise<void> {
  if (!oldest || !roomId) return;
  ui.loadOlder.disabled = true;
  try {
    const page = await loadOlderMessages(roomId, oldest);
    const merged = messageStore.mergeHistorical(page.messages);
    historyLoaded = true;
    oldest = page.oldest;
    hasOlder = page.hasMore;
    ui.loadOlder.hidden = !hasOlder;
    renderMessageChanges(merged.changedIds, { preservePrependAnchor: true });
    watchVisibleReactions();
  } catch (error) {
    toast(errorText(error), 'error');
  } finally {
    ui.loadOlder.disabled = false;
  }
}

function watchMemberPresence(): void {
  presenceUnsubscribe?.();
  presenceUnsubscribe = null;
  const presence = globalPresence;
  const currentUser = user;
  if (!presence || !currentUser || !roomId) {
    onlineUsers = [];
    presenceView.render();
    return;
  }
  presenceUnsubscribe = presence.watchOnlineUsers(
    members.map((member) => member.userId),
    (onlineIds) => {
      if (currentUser !== user) return;
      onlineUsers = onlineRoomMembers(members, onlineIds, currentUser.uid);
      presenceView.render();
    },
    () => failClosedPresence(),
  );
}

async function getMediaController(): Promise<MediaUploadController> {
  if (mediaController) return mediaController;
  if (!roomId) throw new Error('請先選擇聊天室。');
  const { MediaUploadController: Controller } = await import('../media/media-upload.controller');
  mediaController = new Controller(roomId, {
    attachmentInput: ui.attachmentInput,
    customStickerInput: ui.customStickerInput,
    customStickerPicker: ui.stickerPicker,
    cancel: ui.uploadCancel,
    status: ui.uploadStatus,
  });
  return mediaController;
}

async function runMediaUpload(action: (controller: MediaUploadController) => Promise<void>): Promise<void> {
  try {
    await action(await getMediaController());
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      ui.uploadStatus.textContent = '上傳已取消';
      return;
    }
    toast(errorText(error), 'error');
    ui.uploadStatus.textContent = '上傳失敗，可重新選取檔案重試';
  }
}

async function toggleVoiceRecording(): Promise<void> {
  try {
    await (await getVoiceController()).toggle();
  } catch (error) {
    voiceController?.dispose();
    toast(errorText(error), 'error');
  }
}

async function getVoiceController(): Promise<VoiceMessageController> {
  if (voiceController) return voiceController;
  const { VoiceMessageController: Controller } = await import('../media/voice-message.controller');
  voiceController = new Controller({
    trigger: ui.voiceMessage,
    controls: ui.voiceControls,
    status: ui.voiceStatus,
    pause: ui.voicePause,
    previewDialog: ui.voicePreviewDialog,
    previewAudio: ui.voicePreviewAudio,
    uploadStatus: ui.uploadStatus,
  }, async (recording) => (await getMediaController()).upload(recording.file, { duration: recording.duration }));
  return voiceController;
}

async function runVoiceAction(action: (controller: VoiceMessageController) => void | Promise<void>): Promise<void> {
  try {
    await action(await getVoiceController());
  } catch (error) {
    voiceController?.dispose();
    toast(errorText(error), 'error');
  }
}

/**
 * Acknowledging the press is synchronous on purpose. Everything the call needs -
 * the call controller chunk, the panel, the transport SDK, three callables and a
 * media permission prompt - is behind at least one await, and until this ran the
 * only thing that changed on screen was two buttons greying out, several hundred
 * milliseconds later.
 */
function showCallPending(kind: 'voice' | 'video', mode: 'start' | 'join'): PendingCall {
  const pending: PendingCall = { kind, cancelled: false, controller: null };
  pendingCall = pending;
  ui.callPendingLabel.textContent = `${mode === 'join' ? '正在加入' : '正在建立'}${kind === 'video' ? '視訊' : '語音'}通話…`;
  ui.callPendingCancel.disabled = false;
  ui.callPending.hidden = false;
  setRoomControls(Boolean(roomId));
  return pending;
}

function hideCallPending(pending: PendingCall): void {
  if (pendingCall !== pending) return;
  pendingCall = null;
  ui.callPending.hidden = true;
  setRoomControls(Boolean(roomId));
}

function cancelPendingCall(): void {
  if (!pendingCall) return;
  pendingCall.cancelled = true;
  ui.callPendingCancel.disabled = true;
  ui.callPendingLabel.textContent = '正在取消通話…';
  // Reach the in-flight attempt now rather than after it settles. `finish()`
  // aborts the controller's AbortController, which is what the token callable,
  // the transport connect and the media prompt are all listening on; waiting for
  // `begin()` to resolve first would have made the button cost a full connect.
  // If the server call already exists, `finish()` is also what ends it and
  // releases `activeCallId` - cancelling must never leave the room locked.
  void pendingCall.controller?.finish().catch(() => undefined);
}

async function beginCall(kind: 'voice' | 'video'): Promise<void> {
  const clickedAt = performance.now();
  if (!roomId || pendingCall || callController?.active) return;
  const pending = showCallPending(kind, 'start');
  const acknowledgedAt = performance.now();
  const currentRoomId = roomId;
  try {
    const controller = await getCallController();
    pending.controller = controller;
    // Cancelled before the callable ran: nothing exists to unwind.
    if (pending.cancelled) return;
    await controller.begin(currentRoomId, kind, { clickedAt, acknowledgedAt });
    // Cancelled while it was being built. The call is real now, so it leaves
    // through the ordinary hang-up path rather than being abandoned - the
    // one-call-per-room lock is released by the server, not by us.
    if (pending.cancelled) await controller.finish();
  } catch (error) {
    toast(errorText(error), 'error');
  } finally {
    hideCallPending(pending);
  }
}

async function joinCall(messageRoomId: string, call: RoomCall): Promise<void> {
  const clickedAt = performance.now();
  if (messageRoomId !== roomId || pendingCall || callController?.active) return;
  const pending = showCallPending(call.kind, 'join');
  const acknowledgedAt = performance.now();
  const currentRoomId = roomId;
  try {
    const controller = await getCallController();
    pending.controller = controller;
    if (pending.cancelled) return;
    await controller.join({
      roomId: currentRoomId,
      callId: call.callId,
      kind: call.kind,
      timing: { clickedAt, acknowledgedAt },
    });
    if (pending.cancelled) await controller.finish();
  } catch (error) {
    toast(errorText(error), 'error');
  } finally {
    hideCallPending(pending);
  }
}

async function getCallController(): Promise<CallUIController> {
  if (callController) return callController;
  const scope = sessionScope;
  if (!scope) throw new Error('請先登入。');
  const { CallUIController: Controller } = await import('../calls/call-ui.controller');
  if (callController) return callController;
  if (scope.signal.aborted || scope !== sessionScope) throw new DOMException('Session ended', 'AbortError');
  callController = new Controller(
    { voice: ui.voiceCall, video: ui.videoCall },
    scope.signal,
    () => Boolean(roomId),
    () => {
      setRoomControls(Boolean(roomId));
      if (roomId) renderCallMessages();
    },
    (message: string, error?: boolean) => toast(message, error ? 'error' : 'info'),
  );
  return callController;
}

async function runHistoricalSearch(): Promise<void> {
  const value = ui.searchInput.value.trim();
  if (!roomId || !value) return;
  ui.historicalSearch.disabled = true;
  try {
    const { historicalSearchSummary } = await import('../search/historical-search');
    const result = await historicalSearchSummary(roomId, value);
    if (!result.count) {
      toast('歷史訊息沒有符合結果。');
      return;
    }
    await showConfirm(`找到 ${result.count} 則歷史結果`, result.copy, '完成');
  } catch (error) {
    toast(errorText(error), 'error');
  } finally {
    ui.historicalSearch.disabled = false;
  }
}

async function configurePush(uid: string, scope: SessionScope): Promise<void> {
  const { configuredPushState } = await import('../notifications/push');
  const state = await configuredPushState(uid);
  if (scope.signal.aborted || scope !== sessionScope || user?.uid !== uid) return;
  ui.pushRow.hidden = !state.supported;
  ui.push.checked = state.enabled;
  if (state.error) toast(state.error, 'error');
}

async function connectSessionPresence(nextUser: AuthenticatedUser, scope: SessionScope): Promise<void> {
  const { connectGlobalPresence } = await import('../realtime/realtime.repository');
  const presence = await connectGlobalPresence(nextUser.uid);
  if (scope.signal.aborted) {
    await presence.close();
    return;
  }
  globalPresence = presence;
  scope.add(() => void presence.close());
  watchMemberPresence();
}

async function watchSessionCalls(uid: string, scope: SessionScope): Promise<void> {
  const [controller, repository] = await Promise.all([
    getCallController(),
    import('../calls/call.repository'),
  ]);
  if (scope.signal.aborted) return;
  scope.add(repository.watchIncomingCalls(
    uid,
    (signals) => controller.updateIncoming(signals),
    (error) => toast(`來電狀態讀取失敗：${errorText(error)}`, 'error'),
  ));
}

function beginSession(nextUser: AuthenticatedUser): void {
  cleanupSession();
  user = nextUser;
  const scope = new SessionScope();
  sessionScope = scope;
  // App Check is meant to be initialised before any Firebase service is used.
  // Leaving it to the first callable meant whichever feature got there first
  // paid for the reCAPTCHA Enterprise script load and the provider handshake,
  // and on a cold session that was usually the call button - it measured in
  // seconds, far more than the callable behind it. The import stays dynamic so
  // this costs the signed-in chunk nothing, and the call itself is unchanged:
  // every replay-sensitive RTC callable still sends a fresh limited-use token.
  void import('../firebase/app-check')
    .then(({ initializeClientAppCheck }) => initializeClientAppCheck())
    .catch(() => undefined);
  ui.accountName.textContent = nextUser.displayName || '使用者';
  ui.accountEmail.textContent = nextUser.email || '';
  ui.accountAvatar.textContent = initialOf(nextUser.displayName);
  void saveOwnProfile(nextUser).catch((error) => toast(errorText(error), 'error'));
  // `bootstrap.ts` owns applying the theme to the document for the whole page,
  // including the auth screen this controller is not loaded for. All that is
  // left here is keeping the toggle in step, and it is released with the session
  // rather than living for the lifetime of the tab.
  scope.add(watchSystemTheme((theme) => { ui.theme.checked = theme === 'dark'; }));
  scope.add(watchAvailableRooms(nextUser.uid, (available, states) => {
    rooms = new Map(available.map((room) => [room.id, room]));
    roomStates = states;
    roomListView.render();
    const requested = new URL(window.location.href).searchParams.get('room');
    if (!roomId && requested && rooms.has(requested)) void selectRoom(rooms.get(requested)!);
  }, (error) => toast(`聊天室清單讀取失敗：${errorText(error)}`, 'error')));
  void connectSessionPresence(nextUser, scope).catch((error) => {
    failClosedPresence();
    // Losing this leaves the user invisible to everyone else for the whole
    // session, and nothing else in the UI would ever say so.
    if (!scope.signal.aborted) toast(`在線狀態連線失敗，其他人會看到你離線：${errorText(error)}`, 'error');
  });
  void watchSessionCalls(nextUser.uid, scope).catch((error) => {
    if (!scope.signal.aborted) toast(`來電監聽失敗：${errorText(error)}`, 'error');
  });
  void import('../notifications/push').then(({ watchForegroundPush }) => watchForegroundPush(
    (notice) => {
      if (!document.hidden && notice.roomId === roomId) return;
      toast(notice.body ? `${notice.title}：${notice.body}` : notice.title);
    },
    (notice) => toast(`${notice.kind === 'video' ? '視訊' : '語音'}來電`),
  ));
  const configuringPush = configurePush(nextUser.uid, scope);
  pushConfiguration = configuringPush;
  void configuringPush.catch((error) => {
    if (!scope.signal.aborted) toast(`推播初始化失敗：${errorText(error)}`, 'error');
  }).finally(() => {
    if (pushConfiguration === configuringPush) pushConfiguration = null;
  });
}

function bindEvents(): void {
  ui.joinRoom.addEventListener('click', () => void joinNamedRoom());
  ui.roomName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void joinNamedRoom();
  });
  ui.send.addEventListener('click', () => void submitMessage());
  ui.input.addEventListener('input', updateComposer);
  ui.input.addEventListener('keydown', (event) => {
    if (!ui.mentionList.hidden) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const offset = event.key === 'ArrowDown' ? 1 : -1;
        mentionIndex = (mentionIndex + offset + mentionChoices.length) % mentionChoices.length;
        updateMentionList();
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        insertMention(mentionIndex);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMentionList();
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  });
  ui.cancelReply.addEventListener('click', cancelReply);
  ui.cancelEdit.addEventListener('click', cancelEditing);
  ui.loadOlder.addEventListener('click', () => void loadOlder());
  ui.searchInput.addEventListener('input', applyMessageFilter);
  ui.searchToggle.addEventListener('click', () => {
    ui.searchBar.hidden = false;
    ui.searchToggle.setAttribute('aria-expanded', 'true');
    ui.searchInput.focus();
  });
  ui.closeSearch.addEventListener('click', () => {
    ui.searchBar.hidden = true;
    ui.searchToggle.setAttribute('aria-expanded', 'false');
    ui.searchInput.value = '';
    applyMessageFilter();
  });
  ui.historicalSearch.addEventListener('click', () => void runHistoricalSearch());
  ui.openSidebar.addEventListener('click', () => setSidebar(true));
  ui.closeSidebar.addEventListener('click', () => setSidebar(false));
  ui.sidebarScrim.addEventListener('click', () => setSidebar(false));
  ui.membersToggle.addEventListener('click', () => setPresence(true));
  ui.closeMembers.addEventListener('click', () => setPresence(false));
  ui.theme.addEventListener('change', () => {
    const theme = ui.theme.checked ? 'dark' : 'light';
    storeTheme(theme);
    setTheme(theme);
  });
  ui.callPendingCancel.addEventListener('click', () => cancelPendingCall());
  ui.push.addEventListener('change', () => {
    const currentUser = user;
    const currentScope = sessionScope;
    if (!currentUser || !currentScope) return;
    void (async () => {
      const { PUSH_PREFERENCE_KEY, setPushPreference } = await import('../notifications/push');
      const error = await setPushPreference(currentUser.uid, ui.push.checked);
      if (currentScope.signal.aborted || user !== currentUser) return;
      if (error) {
        ui.push.checked = localStorage.getItem(PUSH_PREFERENCE_KEY) === 'true';
        toast(error, 'error');
      }
    })();
  });
  ui.attach.addEventListener('click', () => ui.attachmentInput.click());
  ui.attachmentInput.addEventListener('change', () => {
    const file = ui.attachmentInput.files?.[0];
    if (file) void runMediaUpload((controller) => controller.upload(file));
  });
  ui.uploadCancel.addEventListener('click', () => mediaController?.cancel());
  ui.voiceMessage.addEventListener('click', () => void toggleVoiceRecording());
  ui.voicePause.addEventListener('click', () => void runVoiceAction((controller) => controller.togglePause()));
  ui.voiceCancel.addEventListener('click', () => void runVoiceAction((controller) => controller.cancel()));
  ui.voiceFinish.addEventListener('click', () => void runVoiceAction((controller) => controller.finish()));
  ui.sticker.addEventListener('click', () => { ui.stickerPicker.hidden = !ui.stickerPicker.hidden; });
  ui.customSticker.addEventListener('click', () => ui.customStickerInput.click());
  ui.customStickerInput.addEventListener('change', () => {
    const file = ui.customStickerInput.files?.[0];
    if (file) void runMediaUpload((controller) => controller.uploadCustomSticker(file));
  });
  ui.stickerPicker.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-sticker]');
    if (!button?.dataset.sticker || !roomId) return;
    ui.stickerPicker.hidden = true;
    void import('../stickers/sticker.service')
      .then(({ sendBuiltInSticker }) => sendBuiltInSticker(roomId, button.dataset.sticker!))
      .catch((error) => toast(errorText(error), 'error'));
  });
  // The header only starts calls. Muting, sharing and hanging up live on the
  // call panel, where they are labelled and cannot be confused with each other.
  ui.voiceCall.addEventListener('click', () => void beginCall('voice'));
  ui.videoCall.addEventListener('click', () => void beginCall('video'));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      const newest = [...messages.values()].sort(compareMessages).at(-1);
      if (newest && user && roomId) void markRoomRead(user.uid, roomId, newest.id).catch(() => undefined);
    }
  });
}

export interface ChatController {
  open(user: AuthenticatedUser): void;
  close(): void;
  prepareLogout(): Promise<void>;
  openRequestedRoom(roomId: string): void;
}

export function initializeChatController(): ChatController {
  setTheme(preferredTheme());
  bindOfflineSettings({ toggle: ui.offline, status: ui.offlineStatus, retry: ui.offlineRetry }, {
    confirm: () => showConfirm(
      '清除此裝置的離線聊天資料',
      '系統會先等待待送訊息同步，再清除 IndexedDB。若其他分頁仍開著，會維持待清除狀態。',
      '清除並重新載入',
    ),
    beforeRevoke: cleanupSession,
    notify: (message, error) => toast(message, error ? 'error' : 'info'),
  });
  setRoomControls(false);
  bindEvents();
  return {
    open(nextUser) { beginSession(nextUser); },
    close() {
      cleanupSession();
    },
    async prepareLogout() {
      const currentUser = user;
      if (!currentUser) return;
      await pushConfiguration?.catch(() => undefined);
      const { releasePushForLogout } = await import('../notifications/push');
      await releasePushForLogout(currentUser.uid);
    },
    openRequestedRoom(requestedRoom) {
      if (rooms.has(requestedRoom)) void selectRoom(rooms.get(requestedRoom)!);
    },
  };
}
