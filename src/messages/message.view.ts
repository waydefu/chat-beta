/**
 * The message renderer, extracted from `app/chat.controller.ts` (TD-U1).
 *
 * Nothing here reads module state. The standalone helpers are functions of
 * their arguments; the row renderer is built by `createMessageView`, which
 * takes every piece of controller state it needs as a getter and every action
 * it triggers as a callback. The controller still owns the state — this file
 * only reaches it through that seam.
 *
 * Getters rather than plain values because the controller reassigns those
 * bindings as rooms and sessions change. Capturing them once would freeze the
 * view onto a stale room.
 */
import { renderAiSources } from '../bots/grounding.view';
import type { CallMessage, ChatMessage, Mention, Reaction, RoomCall, RoomReadState } from '../types';
import { formatMessageTime, initialOf, truncate } from '../utils';

const REACTION_CHOICES = ['\u{1F44D}', '❤️', '\u{1F602}'];

/** The display text of a message, whatever kind it is. */
export function textOf(message: ChatMessage): string {
  if (message.kind === 'text') return message.text;
  if (message.kind === 'system') return message.text || message.event;
  if (message.kind === 'sticker') return '貼圖';
  if (message.kind === 'call') return message.event === 'started' ? '開始了一通電話' : '通話已結束';
  return message.text || '附件';
}

/** Append `text` to `target`, wrapping each mention span in its own element. */
export function appendMentionText(target: HTMLElement, text: string, mentions: Mention[] = []): void {
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

/** The topmost row still visible in `list`, with its offset from the top edge. */
export function firstVisibleMessage(list: HTMLElement): { row: HTMLElement; offset: number } | null {
  const listTop = list.getBoundingClientRect().top;
  for (const row of list.querySelectorAll<HTMLElement>('.message-row[data-message-id]')) {
    if (row.isConnected && row.getBoundingClientRect().bottom >= listTop) {
      return { row, offset: row.getBoundingClientRect().top - listTop };
    }
  }
  return null;
}

/** Scroll to the bottom, then again next frame once late content has laid out. */
export function pinToEnd(list: HTMLElement): void {
  list.scrollTop = list.scrollHeight;
  window.requestAnimationFrame(() => {
    list.scrollTop = list.scrollHeight;
  });
}

/** A small text button for the row's action strip. */
export function actionButton(label: string, action: () => void, danger = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (danger) button.className = 'danger';
  button.addEventListener('click', action);
  return button;
}

/**
 * A stable per-message signature of its reactions, so the controller can tell
 * which bars actually changed instead of rebuilding all of them.
 */
export function reactionSignatures(value: readonly Reaction[]): Map<string, string> {
  const grouped = new Map<string, string[]>();
  for (const reaction of value) {
    const bucket = grouped.get(reaction.messageId) ?? [];
    bucket.push(`${reaction.userId}:${reaction.emoji}`);
    grouped.set(reaction.messageId, bucket);
  }
  return new Map([...grouped].map(([messageId, entries]) => [messageId, entries.sort().join('|')]));
}

/** Everything the row renderer needs from the controller. */
export interface MessageViewDeps {
  /** The signed-in user, or null before sign-in completes. */
  currentUser: () => { uid: string } | null;
  /** Look up a message by id, for resolving reply quotes. */
  message: (id: string) => ChatMessage | undefined;
  /** A message's index in the current ordering, or undefined when not placed. */
  messagePosition: (id: string) => number | undefined;
  /** Per-member read state, used to count who has read a message. */
  readStates: () => Iterable<RoomReadState>;
  /** Reactions for the open room. */
  reactions: () => readonly Reaction[];
  /** The live call with this id, if it is still running. */
  activeCall: (callId: string) => RoomCall | undefined;
  /** Whether a call is already in progress on this client. */
  callActive: () => boolean;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onJoinCall: (roomId: string, call: RoomCall) => void;
  /** `emoji` is null to clear the current user's reaction. */
  onReact: (messageId: string, emoji: string | null) => void;
}

export interface MessageView {
  renderMessage: (message: ChatMessage) => HTMLElement;
  messageReadCount: (messageId: string) => number;
  /** Exposed because the controller replaces a single bar in place rather than
   *  re-rendering the row, per the keyed-row rule in `src/AGENTS.md`. */
  renderReactionBar: (message: ChatMessage) => HTMLElement;
}

export function createMessageView(deps: MessageViewDeps): MessageView {
  function messageReadCount(messageId: string): number {
    const index = deps.messagePosition(messageId) ?? -1;
    if (index < 0) return 0;
    return [...deps.readStates()].filter((state) => {
      const readIndex = state.lastReadMessageId ? (deps.messagePosition(state.lastReadMessageId) ?? -1) : -1;
      return readIndex >= index;
    }).length;
  }

  /**
   * A call invitation is only actionable while the call is live, and the server
   * never writes a second message when it ends — the calls collection is the
   * only signal. Without this the bubble kept offering to join a call that
   * finished hours ago.
   */
  function renderCallInvite(message: CallMessage): HTMLElement {
    const call = deps.activeCall(message.callId);
    if (!call) {
      const ended = document.createElement('p');
      ended.className = 'call-ended';
      ended.textContent = '通話已結束';
      return ended;
    }
    if (deps.callActive()) {
      const busy = document.createElement('p');
      busy.className = 'call-ended';
      busy.textContent = '通話進行中';
      return busy;
    }
    if (call.status === 'ending') {
      const ending = document.createElement('p');
      ending.className = 'call-ended';
      ending.textContent = '通話正在結束';
      return ending;
    }
    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'call-join';
    const action = call.status === 'ringing' ? '接聽' : '加入';
    join.textContent = `${action}${call.kind === 'video' ? '視訊' : '語音'}通話`;
    join.addEventListener('click', () => deps.onJoinCall(message.roomId, call));
    return join;
  }

  function renderMessageActions(message: ChatMessage, own: boolean): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.append(actionButton('回覆', () => deps.onReply(message)));
    if (own && message.kind === 'text') {
      actions.append(actionButton('編輯', () => deps.onEdit(message)));
      actions.append(actionButton('刪除', () => deps.onDelete(message), true));
    }
    return actions;
  }

  function renderReactionBar(message: ChatMessage): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'reaction-bar';
    const messageReactions = deps.reactions().filter((reaction) => reaction.messageId === message.id);
    for (const emoji of REACTION_CHOICES) {
      const matching = messageReactions.filter((reaction) => reaction.emoji === emoji);
      const own = matching.some((reaction) => reaction.userId === deps.currentUser()?.uid);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = own ? 'selected' : '';
      button.textContent = `${emoji}${matching.length ? ` ${matching.length}` : ''}`;
      button.setAttribute('aria-pressed', String(own));
      button.addEventListener('click', () => deps.onReact(message.id, own ? null : emoji));
      bar.append(button);
    }
    return bar;
  }

  function renderMessage(message: ChatMessage): HTMLElement {
    const own = deps.currentUser()?.uid === message.senderId;
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
      const reply = deps.message(message.replyToId);
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
      void import('../media/attachment.view').then(({ renderAttachmentContent }) =>
        renderAttachmentContent(content, message),
      );
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
    if (message.metadata?.grounding?.usedSearch && message.metadata.grounding.sources?.length) {
      bubble.append(renderAiSources(message.metadata.grounding.sources));
    }
    if (message.kind === 'call' && message.event === 'started') bubble.append(renderCallInvite(message));
    bubble.append(meta);
    wrap.append(bubble, renderReactionBar(message));
    if (message.senderType === 'user' && !message.deletedAt) wrap.append(renderMessageActions(message, own));
    row.append(profile, wrap);
    return row;
  }

  return { renderMessage, messageReadCount, renderReactionBar };
}
