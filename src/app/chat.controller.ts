import type { AuthenticatedUser } from '../auth/auth.repository';
import { saveOwnProfile } from '../auth/profile.repository';
import type { CallUIController } from '../calls/call-ui.controller';
import { OFFLINE_PREFERENCE_KEY, persistentCacheEnabled } from '../firebase/firestore-client';
import type { MediaUploadController } from '../media/media-upload.controller';
import type { VoiceMessageController } from '../media/voice-message.controller';
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
import type { RealtimeRoomSession } from '../realtime/realtime.repository';
import { markRoomRead, watchAvailableRooms } from '../rooms/room.repository';
import type {
  CallMessage,
  ChatMessage,
  Mention,
  OnlineUser,
  Reaction,
  RoomCall,
  RoomMembership,
  RoomPreview,
  RoomReadState,
} from '../types';
import { compareMessages, formatMessageTime, initialOf, truncate } from '../utils';
import { RoomScope, SessionScope } from './lifecycle';
import { applyTheme, preferredTheme, storeTheme, watchSystemTheme, type Theme } from './theme';

const REACTION_CHOICES = ['👍', '❤️', '😂'];

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
};

let user: AuthenticatedUser | null = null;
let sessionScope: SessionScope | null = null;
let roomScope: RoomScope | null = null;
let realtime: RealtimeRoomSession | null = null;
let roomId = '';
let rooms = new Map<string, RoomPreview>();
let roomStates = new Map<string, RoomReadState>();
let messages = new Map<string, ChatMessage>();
let members: RoomMembership[] = [];
let readStates = new Map<string, RoomReadState>();
let activeCalls = new Map<string, RoomCall>();
let reactions: Reaction[] = [];
let onlineUsers: OnlineUser[] = [];
let oldest: MessagePage['oldest'] = null;
let hasOlder = false;
let reactionUnsubscribe: (() => void) | null = null;
let replyToId: string | undefined;
let editingId: string | undefined;
let typingTimer: number | undefined;
let mentionChoices: Array<{ type: 'user' | 'bot'; id: string; label: string }> = [];
let mentionIndex = 0;
let mediaController: MediaUploadController | null = null;
let callController: CallUIController | null = null;
let voiceController: VoiceMessageController | null = null;
const localAiRuns = new Set<string>();

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
  for (const control of [ui.input, ui.send, ui.attach, ui.voiceMessage, ui.sticker, ui.voiceCall, ui.videoCall]) {
    control.disabled = !enabled;
  }
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
  callController?.dispose();
  callController = null;
  mediaController?.dispose();
  mediaController = null;
  voiceController?.dispose();
  voiceController = null;
  roomScope?.dispose();
  roomScope = null;
  reactionUnsubscribe?.();
  reactionUnsubscribe = null;
  if (realtime) void realtime.close();
  realtime = null;
  roomId = '';
  messages.clear();
  members = [];
  reactions = [];
  readStates.clear();
  ui.roomTitle.textContent = '選擇聊天室';
  ui.empty.hidden = false;
  ui.messageView.hidden = true;
  ui.messageList.replaceChildren();
  ui.typing.textContent = '';
  setRoomControls(false);
  renderRooms();
}

function cleanupSession(): void {
  closeRoom();
  sessionScope?.dispose();
  sessionScope = null;
  void import('../notifications/push').then(({ stopForegroundPush }) => stopForegroundPush());
  rooms.clear();
  roomStates.clear();
  user = null;
}

function roomUnread(room: RoomPreview): boolean {
  const latest = room.lastMessage?.id;
  return Boolean(latest && roomStates.get(room.id)?.lastReadMessageId !== latest);
}

function renderRooms(): void {
  ui.roomList.replaceChildren();
  ui.roomCount.textContent = String(rooms.size);
  for (const room of rooms.values()) {
    const joined = roomStates.get(room.id)?.membershipStatus === 'active';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `room-item${room.id === roomId ? ' active' : ''}`;
    button.dataset.roomId = room.id;
    const avatar = document.createElement('span');
    avatar.className = 'room-initial';
    avatar.textContent = initialOf(room.name);
    const copy = document.createElement('span');
    copy.className = 'room-copy';
    const name = document.createElement('strong');
    name.textContent = room.name;
    const preview = document.createElement('span');
    preview.textContent = joined
      ? room.lastMessage?.preview || '尚無訊息'
      : room.visibility === 'public' ? '公開房間 · 點擊加入' : '私人房間';
    copy.append(name, preview);
    button.append(avatar, copy);
    if (joined && roomUnread(room)) {
      const unread = document.createElement('span');
      unread.className = 'unread-dot';
      unread.setAttribute('aria-label', '有未讀訊息');
      button.append(unread);
    }
    button.addEventListener('click', () => void selectRoom(room));
    ui.roomList.append(button);
  }
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
  renderRooms();
  const scope = new RoomScope();
  roomScope = scope;

  scope.add(watchRecentMessages(roomId, (page) => {
    const priorCount = messages.size;
    messages = new Map(page.messages.map((message) => [message.id, message]));
    oldest = page.oldest;
    hasOlder = page.hasMore;
    ui.loadOlder.hidden = !hasOlder;
    renderMessages(priorCount === 0);
    watchVisibleReactions();
    const newest = page.messages.at(-1);
    if (newest && user && !document.hidden) void markRoomRead(user.uid, roomId, newest.id).catch(() => undefined);
  }, handleRoomAccessError));
  scope.add(watchRoomMembers(roomId, (value) => {
    members = value;
    updateMentionList();
  }, handleRoomAccessError));
  scope.add(watchActiveCalls(roomId, (value) => {
    activeCalls = value;
    renderMessages(false);
  }, handleRoomAccessError));
  scope.add(watchReadStates(roomId, (value) => {
    readStates = value;
    renderMessages(false);
  }, handleRoomAccessError));
  scope.add(() => reactionUnsubscribe?.());

  try {
    const { connectRealtimeRoom } = await import('../realtime/realtime.repository');
    const roomRealtime = await connectRealtimeRoom(roomId, {
      uid: user.uid,
      displayName: user.displayName || '使用者',
    });
    if (scope.signal.aborted) {
      await roomRealtime.close();
      return;
    }
    realtime = roomRealtime;
    renderConnectionStatus(true, '已連線');
    scope.add(roomRealtime.watchPresence((value) => {
      onlineUsers = value;
      renderPresenceList();
    }, () => failClosedRealtime()));
    scope.add(roomRealtime.watchTyping((names) => {
      ui.typing.textContent = names.length ? `${names.slice(0, 3).join('、')} 正在輸入…` : '';
    }, () => failClosedRealtime()));
    scope.add(roomRealtime.watchAiDrafts((drafts) => renderRemoteDrafts(drafts), () => failClosedRealtime()));
    scope.add(() => void roomRealtime.close());
  } catch {
    failClosedRealtime();
  }
}

function handleRoomAccessError(error: Error): void {
  toast(`房間已關閉：${errorText(error)}`, 'error');
  closeRoom();
}

function failClosedRealtime(): void {
  renderConnectionStatus(false, '即時狀態尚未授權');
  ui.typing.textContent = '';
  onlineUsers = [];
  renderPresenceList();
}

function renderConnectionStatus(online: boolean, label: string): void {
  const dot = document.createElement('span');
  dot.className = `status-dot ${online ? 'online' : 'offline'}`;
  dot.setAttribute('aria-hidden', 'true');
  ui.connection.replaceChildren(dot, document.createTextNode(label));
}

function textOf(message: ChatMessage): string {
  if (message.kind === 'text') return message.text;
  if (message.kind === 'system') return message.text || message.event;
  if (message.kind === 'sticker') return '貼圖';
  if (message.kind === 'call') return message.event === 'started' ? '開始了一通電話' : '通話已結束';
  return message.text || '附件';
}

function appendMentionText(target: HTMLElement, text: string, mentions: Mention[] = []): void {
  let cursor = 0;
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    if (mention.start < cursor || mention.end > text.length) continue;
    target.append(document.createTextNode(text.slice(cursor, mention.start)));
    const tag = document.createElement('span');
    tag.className = 'mention';
    tag.textContent = text.slice(mention.start, mention.end);
    tag.dataset.mentionType = mention.type;
    tag.dataset.mentionId = mention.id;
    target.append(tag);
    cursor = mention.end;
  }
  target.append(document.createTextNode(text.slice(cursor)));
}

function messageReadCount(messageId: string): number {
  const ordered = [...messages.values()].sort(compareMessages);
  const index = ordered.findIndex((message) => message.id === messageId);
  if (index < 0) return 0;
  return [...readStates.values()].filter((state) => {
    const readIndex = ordered.findIndex((message) => message.id === state.lastReadMessageId);
    return readIndex >= index;
  }).length;
}

/** Set when this client sends, so its own message wins over the follow check. */
let scrollAfterNextRender = false;

/**
 * Every update rebuilds the whole list, and read receipts alone make that happen
 * constantly. Emptying the container collapses scrollHeight, so the browser clamps
 * scrollTop and the view jumps unless the position is captured first and restored.
 * `scroll` forces the end - use it when this client caused the new content and
 * should see it regardless of where it was looking.
 */
function renderMessages(scroll = false): void {
  const list = ui.messageList;
  const previousTop = list.scrollTop;
  // 80px of slack still counts as reading the end.
  const follow = scroll || scrollAfterNextRender
    || list.scrollHeight - previousTop - list.clientHeight <= 80;
  scrollAfterNextRender = false;
  const query = ui.searchInput.value.trim().toLocaleLowerCase('zh-Hant');
  const fragment = document.createDocumentFragment();
  for (const message of [...messages.values()].sort(compareMessages)) {
    const matches = !query || textOf(message).toLocaleLowerCase('zh-Hant').includes(query);
    const row = renderMessage(message);
    row.classList.toggle('filtered-out', !matches);
    fragment.append(row);
  }
  list.replaceChildren(fragment);
  if (follow) pinToEnd(list); else list.scrollTop = previousTop;
}

/**
 * The composer shrinking back to one line, the mobile keyboard opening, and
 * sticker or attachment content arriving after its row is in place all change
 * the list's height once the first measurement is already spent. Re-assert on
 * the next frame so those cases do not leave the view short of the end.
 */
function pinToEnd(list: HTMLElement): void {
  list.scrollTop = list.scrollHeight;
  window.requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

function renderMessage(message: ChatMessage): HTMLElement {
  const own = user?.uid === message.senderId;
  const row = document.createElement('article');
  row.className = `message-row${own ? ' you' : ''}${message.pending ? ' pending' : ''}${message.failed ? ' failed' : ''}`;
  row.dataset.messageId = message.id;
  const profile = document.createElement('div');
  profile.className = 'message-profile';
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = message.senderType === 'bot' ? 'G' : initialOf(message.senderDisplayName);
  const author = document.createElement('span');
  author.className = 'message-author';
  author.textContent = message.senderDisplayName;
  profile.append(avatar, author);

  const wrap = document.createElement('div');
  wrap.className = 'message-wrap';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  if (message.replyToId) {
    const quote = document.createElement('div');
    quote.className = 'reply-quote';
    const reply = messages.get(message.replyToId);
    quote.textContent = reply ? `${reply.senderDisplayName}：${truncate(textOf(reply), 80)}` : '回覆較早的訊息';
    bubble.append(quote);
  }
  const content = document.createElement('p');
  content.className = 'message-text';
  if (message.kind === 'text' || message.kind === 'system') {
    appendMentionText(content, textOf(message), message.mentions);
  } else if (message.kind === 'sticker') {
    content.classList.add('sticker-message');
    content.textContent = '載入貼圖…';
    void import('../stickers/sticker.view').then(({ renderSticker }) => renderSticker(content, message));
  } else if (message.kind === 'call') {
    content.textContent = `${message.senderDisplayName} ${textOf(message)}`;
    content.classList.add('call-message');
  } else {
    void import('../media/attachment.view').then(({ renderAttachmentContent }) => renderAttachmentContent(content, message));
  }
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const time = document.createElement('span');
  time.textContent = formatMessageTime(message);
  meta.append(time);
  if (message.editedAt) {
    const edited = document.createElement('span');
    edited.textContent = '已編輯';
    meta.append(edited);
  }
  if (own) {
    const read = document.createElement('span');
    read.dataset.role = 'read';
    const count = Math.max(0, messageReadCount(message.id) - 1);
    read.textContent = count ? `${count} 人已讀` : '';
    meta.append(read);
  }
  bubble.append(content);
  if (message.kind === 'call' && message.event === 'started') bubble.append(renderCallInvite(message));
  bubble.append(meta);
  wrap.append(bubble, renderReactionBar(message));
  if (message.senderType === 'user' && !message.deletedAt) wrap.append(renderMessageActions(message, own));
  row.append(profile, wrap);
  return row;
}

/**
 * A call invitation is only actionable while the call is live, and the server
 * never writes a second message when it ends - the calls collection is the only
 * signal. Without this the bubble kept offering to join a call that finished
 * hours ago.
 */
function renderCallInvite(message: CallMessage): HTMLElement {
  const call = activeCalls.get(message.callId);
  if (!call) {
    const ended = document.createElement('p');
    ended.className = 'call-ended';
    ended.textContent = '通話已結束';
    return ended;
  }
  if (callController?.active) {
    const busy = document.createElement('p');
    busy.className = 'call-ended';
    busy.textContent = '通話進行中';
    return busy;
  }
  const join = document.createElement('button');
  join.type = 'button';
  join.className = 'call-join';
  join.textContent = call.kind === 'video' ? '加入視訊通話' : '加入語音通話';
  join.addEventListener('click', () => void joinCall(message.roomId, call));
  return join;
}

function renderMessageActions(message: ChatMessage, own: boolean): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  actions.append(actionButton('回覆', () => setReply(message)));
  if (own && message.kind === 'text') {
    actions.append(actionButton('編輯', () => startEditing(message)));
    actions.append(actionButton('刪除', () => void deleteMessage(message), true));
  }
  return actions;
}

function actionButton(label: string, action: () => void, danger = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (danger) button.className = 'danger';
  button.addEventListener('click', action);
  return button;
}

function renderReactionBar(message: ChatMessage): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'reaction-bar';
  const messageReactions = reactions.filter((reaction) => reaction.messageId === message.id);
  for (const emoji of REACTION_CHOICES) {
    const matching = messageReactions.filter((reaction) => reaction.emoji === emoji);
    const own = matching.some((reaction) => reaction.userId === user?.uid);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = own ? 'selected' : '';
    button.textContent = `${emoji}${matching.length ? ` ${matching.length}` : ''}`;
    button.setAttribute('aria-pressed', String(own));
    button.addEventListener('click', () => {
      if (!user || !roomId) return;
      void setReaction(roomId, message.id, user.uid, own ? null : emoji).catch((error) => toast(errorText(error), 'error'));
    });
    bar.append(button);
  }
  return bar;
}

function watchVisibleReactions(): void {
  reactionUnsubscribe?.();
  reactionUnsubscribe = watchReactions(roomId, [...messages.keys()], (value) => {
    reactions = value;
    renderMessages(false);
  }, (error) => toast(errorText(error), 'error'));
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
  if (realtime) {
    void realtime.setTyping(Boolean(ui.input.value.trim())).catch(() => failClosedRealtime());
    if (typingTimer) window.clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => void realtime?.setTyping(false).catch(() => undefined), 1800);
  }
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
    for (const message of page.messages) messages.set(message.id, message);
    oldest = page.oldest;
    hasOlder = page.hasMore;
    ui.loadOlder.hidden = !hasOlder;
    renderMessages(false);
    watchVisibleReactions();
  } catch (error) {
    toast(errorText(error), 'error');
  } finally {
    ui.loadOlder.disabled = false;
  }
}

function renderPresenceList(): void {
  ui.presenceList.replaceChildren();
  ui.presenceCount.textContent = `${onlineUsers.length} 位在線`;
  for (const online of onlineUsers) {
    const item = document.createElement('div');
    item.className = 'presence-item';
    const avatar = document.createElement('span');
    avatar.className = 'presence-avatar';
    avatar.textContent = initialOf(online.displayName);
    const copy = document.createElement('span');
    copy.className = 'presence-copy';
    const name = document.createElement('strong');
    name.textContent = online.displayName;
    const status = document.createElement('span');
    status.textContent = '在線';
    copy.append(name, status);
    item.append(avatar, copy);
    ui.presenceList.append(item);
  }
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

async function beginCall(kind: 'voice' | 'video'): Promise<void> {
  if (!roomId) return;
  try {
    await (await getCallController()).begin(roomId, kind);
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

async function joinCall(messageRoomId: string, call: RoomCall): Promise<void> {
  if (messageRoomId !== roomId) return;
  try {
    await (await getCallController()).join({ roomId, callId: call.callId, kind: call.kind });
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

async function getCallController(): Promise<CallUIController> {
  if (callController) return callController;
  const scope = roomScope;
  if (!scope) throw new Error('請先選擇聊天室。');
  const { CallUIController: Controller } = await import('../calls/call-ui.controller');
  callController = new Controller(
    { voice: ui.voiceCall, video: ui.videoCall },
    scope.signal,
    () => renderMessages(false),
    (message, error) => toast(message, error ? 'error' : 'info'),
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

async function configurePush(uid: string): Promise<void> {
  const { configuredPushState } = await import('../notifications/push');
  const state = await configuredPushState(uid);
  ui.pushRow.hidden = !state.supported;
  ui.push.checked = state.enabled;
  if (state.error) toast(state.error, 'error');
}

function beginSession(nextUser: AuthenticatedUser): void {
  cleanupSession();
  user = nextUser;
  const scope = new SessionScope();
  sessionScope = scope;
  ui.accountName.textContent = nextUser.displayName || '使用者';
  ui.accountEmail.textContent = nextUser.email || '';
  ui.accountAvatar.textContent = initialOf(nextUser.displayName);
  void saveOwnProfile(nextUser).catch((error) => toast(errorText(error), 'error'));
  scope.add(watchAvailableRooms(nextUser.uid, (available, states) => {
    rooms = new Map(available.map((room) => [room.id, room]));
    roomStates = states;
    renderRooms();
    const requested = new URL(window.location.href).searchParams.get('room');
    if (!roomId && requested && rooms.has(requested)) void selectRoom(rooms.get(requested)!);
  }, (error) => toast(`聊天室清單讀取失敗：${errorText(error)}`, 'error')));
  void import('../notifications/push').then(({ watchForegroundPush }) => watchForegroundPush((message) => toast(message)));
  void configurePush(nextUser.uid);
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
  ui.searchInput.addEventListener('input', () => renderMessages(false));
  ui.searchToggle.addEventListener('click', () => {
    ui.searchBar.hidden = false;
    ui.searchToggle.setAttribute('aria-expanded', 'true');
    ui.searchInput.focus();
  });
  ui.closeSearch.addEventListener('click', () => {
    ui.searchBar.hidden = true;
    ui.searchToggle.setAttribute('aria-expanded', 'false');
    ui.searchInput.value = '';
    renderMessages(false);
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
  watchSystemTheme(setTheme);
  ui.offline.addEventListener('change', () => {
    localStorage.setItem(OFFLINE_PREFERENCE_KEY, String(ui.offline.checked));
    toast('離線資料設定會在重新載入後套用。');
  });
  ui.push.addEventListener('change', () => {
    if (!user) return;
    void (async () => {
      const { setPushPreference } = await import('../notifications/push');
      const error = await setPushPreference(user!.uid, ui.push.checked);
      if (error) {
        ui.push.checked = false;
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
  openRequestedRoom(roomId: string): void;
}

export function initializeChatController(): ChatController {
  setTheme(preferredTheme());
  ui.offline.checked = persistentCacheEnabled;
  setRoomControls(false);
  bindEvents();
  return {
    open(nextUser) { beginSession(nextUser); },
    close() {
      cleanupSession();
    },
    openRequestedRoom(requestedRoom) {
      if (rooms.has(requestedRoom)) void selectRoom(rooms.get(requestedRoom)!);
    },
  };
}
