import type { Mention, RoomMembership } from '../types';
import { DomainError } from '../shared/errors/domain-error';
import { validateMessage } from '../utils';

export function requireValidMessage(text: string): string {
  const validation = validateMessage(text);
  if (validation) throw new DomainError('validation', validation);
  return text.trim();
}

// A mention ends where the name ends. Without this, "@GeminiTest" contains
// "@Gemini" and silently sends the room to the bot, and a member called "Al"
// matches inside "@Alice". CJK is not a word character here on purpose:
// "@Gemini你好" has no space to separate the two and is still a mention.
const WORD_CHARACTER = /[A-Za-z0-9_]/u;

function isBoundedMatch(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  if (before && WORD_CHARACTER.test(before)) return false;
  return !(after && WORD_CHARACTER.test(after));
}

export function structuredMentions(text: string, members: RoomMembership[]): Mention[] {
  const choices = [
    ...members.map((member) => ({ type: 'user' as const, id: member.userId, label: member.displayName })),
    { type: 'bot' as const, id: 'gemini', label: 'Gemini' },
  ].sort((a, b) => b.label.length - a.label.length);
  const mentions: Mention[] = [];
  for (const choice of choices) {
    const needle = `@${choice.label}`;
    let start = text.indexOf(needle);
    while (start >= 0) {
      const end = start + needle.length;
      const duplicate = mentions.some((mention) => start < mention.end && end > mention.start);
      if (!duplicate && isBoundedMatch(text, start, end)) mentions.push({ ...choice, start, end });
      start = text.indexOf(needle, end);
    }
  }
  return mentions.sort((a, b) => a.start - b.start).slice(0, 5);
}
