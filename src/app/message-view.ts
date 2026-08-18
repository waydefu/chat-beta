/**
 * Pure message-view helpers extracted from `chat.controller.ts` (TD-U1).
 *
 * Everything here is a function of its arguments: no module state, no DOM
 * lookups outside the nodes it is handed, no subscriptions. That is the whole
 * entry condition for living in this file — the controller keeps the state and
 * passes what these need.
 *
 * The rest of the renderer stays in the controller for now. `renderMessage` and
 * its children reach for roughly fifteen things — `user`, `messages`,
 * `reactions`, `activeCalls`, `roomId`, `callController`, plus the `setReply`,
 * `startEditing`, `deleteMessage`, `joinCall` and `setReaction` actions — so
 * moving them is a dependency-injection change rather than a move, and it is
 * being done separately.
 */
import type { ChatMessage, Mention, Reaction } from '../types';

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
