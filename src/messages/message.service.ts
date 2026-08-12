import type { Mention, RoomMembership } from '../types';
import { DomainError } from '../shared/errors/domain-error';
import { validateMessage } from '../utils';

export function requireValidMessage(text: string): string {
  const validation = validateMessage(text);
  if (validation) throw new DomainError('validation', validation);
  return text.trim();
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
      if (!duplicate) mentions.push({ ...choice, start, end });
      start = text.indexOf(needle, end);
    }
  }
  return mentions.sort((a, b) => a.start - b.start).slice(0, 5);
}
