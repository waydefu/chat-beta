import { describe, expect, it } from 'vitest';

import { structuredMentions } from '../src/messages/message.service';
import type { RoomMembership } from '../src/types';

const member = (userId: string, displayName: string): RoomMembership => (
  { userId, displayName, role: 'member', status: 'active', version: 1 }
);

const members = [member('u1', 'Alice'), member('u2', '小明')];
const ids = (text: string, roster = members) => structuredMentions(text, roster).map((m) => `${m.type}:${m.id}`);

describe('structured mentions', () => {
  it('routes to the bot when Gemini is typed by hand', () => {
    // The mention picker is not the only path -- typing it works, and the
    // callable fires either way.
    expect(ids('@Gemini 幫我整理一下')).toEqual(['bot:gemini']);
    expect(ids('@Gemini，請回答')).toEqual(['bot:gemini']);
    expect(ids('@Gemini\n問題')).toEqual(['bot:gemini']);
  });

  it('treats an immediately following CJK character as a boundary', () => {
    // Chinese has no spaces; requiring one would break the common case.
    expect(ids('@Gemini你好')).toEqual(['bot:gemini']);
  });

  it('does not fire on a longer name that merely starts with the bot name', () => {
    expect(ids('@GeminiTest 你好')).toEqual([]);
    expect(ids('@GeminiX')).toEqual([]);
    expect(ids('@Gemini_bot')).toEqual([]);
  });

  it('ignores the bot name without an @', () => {
    expect(ids('Gemini 你覺得呢')).toEqual([]);
    expect(ids('用 Gemini 來處理')).toEqual([]);
  });

  it('does not treat an email-like string as a mention', () => {
    expect(ids('someone@Gemini.com')).toEqual([]);
  });

  it('matches members and the bot together', () => {
    expect(ids('@Alice @Gemini 看一下')).toEqual(['user:u1', 'bot:gemini']);
  });

  it('does not let a shorter member name match inside a longer one', () => {
    const roster = [member('u3', 'Al'), member('u1', 'Alice')];
    expect(ids('@Alice 早', roster)).toEqual(['user:u1']);
    expect(ids('@Al 早', roster)).toEqual(['user:u3']);
  });

  it('keeps CJK display names working', () => {
    expect(ids('@小明 早安')).toEqual(['user:u2']);
    expect(ids('@小明你好')).toEqual(['user:u2']);
  });

  it('records each occurrence of a repeated mention', () => {
    expect(ids('@Gemini 一次 @Gemini 兩次')).toEqual(['bot:gemini', 'bot:gemini']);
  });

  it('caps the mention list at five', () => {
    expect(structuredMentions('@Alice '.repeat(8), members)).toHaveLength(5);
  });

  it('reports offsets that match the text', () => {
    const text = '早安 @Alice 你好';
    const [mention] = structuredMentions(text, members);
    expect(text.slice(mention!.start, mention!.end)).toBe('@Alice');
  });
});
