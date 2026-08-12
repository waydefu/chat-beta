import { GoogleGenAI, type Content } from '@google/genai';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { database, firestore } from '../admin.js';
import { appCheckEnforced, geminiApiKey, REGION } from '../config.js';
import { requireAuth, requireRecord, requireString, roomKey } from '../shared/validation.js';
import { buildBotContext } from './context-builder.js';
import { BotPermissionService, BotRateLimiter, BotRegistry, BotRouter } from './framework.js';
import { stableGeminiModel } from './model-config.js';

const BOT_ID = 'gemini';
const BOT_NAME = 'Gemini';
const LEASE_MS = 90_000;
const DRAFT_TTL_MS = 10 * 60_000;
const INPUT_TOKEN_BUDGET = 24_000;
const SYSTEM_INSTRUCTION = '你是 Chat Lite 聊天室中的 AI 參與者。只根據提供的聊天室內容回答，簡潔、誠實，不聲稱擁有未提供的權限或資料。';
const ENFORCE_APP_CHECK = appCheckEnforced('ai');
const botRegistry = new BotRegistry([{ id: BOT_ID, displayName: BOT_NAME, provider: 'gemini' }]);
const botRouter = new BotRouter(botRegistry);
const botPermissions = new BotPermissionService();
const botRateLimiter = new BotRateLimiter();

function runIdFor(sourceMessageId: string): string {
  return `${sourceMessageId}_${BOT_ID}`;
}

function generationContents(context: Array<{ sender: string; text: string }>, prompt: string): Content[] {
  return [
    ...context.map((message) => ({
      role: message.sender === BOT_NAME ? 'model' : 'user',
      parts: [{ text: `${message.sender}：${message.text}` }],
    })),
    { role: 'user', parts: [{ text: prompt }] },
  ];
}

export const generateGeminiReply = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    consumeAppCheckToken: ENFORCE_APP_CHECK,
    secrets: [geminiApiKey],
    timeoutSeconds: 120,
    memory: '1GiB',
  },
  async (request, response) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const sourceMessageId = requireString(data.sourceMessageId, 'sourceMessageId', 150);
    const requestedBot = botRouter.require(requireString(data.botId, 'botId', 80));
    if (requestedBot.id !== BOT_ID) throw new HttpsError('invalid-argument', '此 provider 無法處理指定的機器人。');
    await botPermissions.requireInvocation(roomId, auth.uid);
    const runId = runIdFor(sourceMessageId);
    const requestRef = firestore.doc(`rooms/${roomId}/aiRequests/${runId}`);
    const messageRef = firestore.doc(`rooms/${roomId}/messages/ai_${runId}`);
    const now = Date.now();
    const configuredModel = await stableGeminiModel(now);
    const lease = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(requestRef);
      const existing = snapshot.data();
      if (existing?.status === 'complete') {
        return { alreadyComplete: true, attempt: Number(existing.attempt || 1), model: String(existing.model || configuredModel) };
      }
      if (existing?.status === 'running' && existing.leaseExpiresAt?.toMillis?.() > now) {
        throw new HttpsError('already-exists', 'Gemini 已經在處理這則訊息。');
      }
      const attempt = Number(existing?.attempt || 0) + 1;
      transaction.set(requestRef, {
        sourceMessageId,
        botId: BOT_ID,
        requesterId: auth.uid,
        status: 'running',
        attempt,
        model: configuredModel,
        leaseExpiresAt: Timestamp.fromMillis(now + LEASE_MS),
        startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { alreadyComplete: false, attempt, model: configuredModel };
    });
    if (lease.alreadyComplete) {
      return { runId, finalMessageId: messageRef.id, model: lease.model, replayed: true };
    }

    const draftRef = database.ref(`realtime/rooms/${roomKey(roomId)}/aiDrafts/${runId}`);
    const started = Date.now();
    let finalText = '';
    let lastDraftAt = 0;
    let lastDraftLength = 0;
    let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;
    let concurrencyAcquired = false;
    const abortController = new AbortController();
    response?.signal.addEventListener('abort', () => abortController.abort(), { once: true });

    try {
      await botRateLimiter.acquire(runId, auth.uid, roomId);
      concurrencyAcquired = true;
      const botContext = await buildBotContext(roomId, sourceMessageId, BOT_ID, auth.uid);
      const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });
      let contents = generationContents(botContext.context, botContext.prompt);
      let tokenCount = await ai.models.countTokens({
        model: lease.model,
        contents,
        config: { systemInstruction: SYSTEM_INSTRUCTION, abortSignal: abortController.signal },
      });
      while ((tokenCount.totalTokens ?? 0) > INPUT_TOKEN_BUDGET && botContext.context.length > 0) {
        botContext.context.splice(0, Math.max(1, Math.ceil(botContext.context.length / 10)));
        contents = generationContents(botContext.context, botContext.prompt);
        tokenCount = await ai.models.countTokens({
          model: lease.model,
          contents,
          config: { systemInstruction: SYSTEM_INSTRUCTION, abortSignal: abortController.signal },
        });
      }
      if ((tokenCount.totalTokens ?? 0) > INPUT_TOKEN_BUDGET) {
        throw new HttpsError('invalid-argument', '訊息超過 AI 的 24k input-token 上限。');
      }
      const stream = await ai.models.generateContentStream({
        model: lease.model,
        contents,
        config: {
          abortSignal: abortController.signal,
          systemInstruction: SYSTEM_INSTRUCTION,
          maxOutputTokens: 2048,
          temperature: 0.4,
        },
      });

      for await (const chunk of stream) {
        if (abortController.signal.aborted) throw new HttpsError('cancelled', 'AI 回覆已取消。');
        const text = chunk.text ?? '';
        if (chunk.usageMetadata) {
          usage = {
            inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: chunk.usageMetadata.totalTokenCount ?? 0,
          };
        }
        if (!text) continue;
        finalText += text;
        await response?.sendChunk({ runId, text });
        const timestamp = Date.now();
        if (timestamp - lastDraftAt >= 1000 || finalText.length - lastDraftLength >= 256) {
          await draftRef.set({
            runId,
            botId: BOT_ID,
            text: finalText,
            status: 'streaming',
            updatedAt: timestamp,
            expiresAt: timestamp + DRAFT_TTL_MS,
          });
          lastDraftAt = timestamp;
          lastDraftLength = finalText.length;
        }
      }

      if (!finalText.trim()) throw new HttpsError('internal', 'Gemini 沒有產生可顯示的內容。');
      await firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(requestRef);
        if (current.data()?.status === 'complete') return;
        transaction.create(messageRef, {
          roomId,
          senderId: BOT_ID,
          senderType: 'bot',
          senderDisplayName: BOT_NAME,
          kind: 'text',
          text: finalText,
          createdAt: FieldValue.serverTimestamp(),
          replyToId: sourceMessageId,
          metadata: { aiRequestId: runId, model: lease.model },
        });
        transaction.set(requestRef, {
          status: 'complete',
          finalMessageId: messageRef.id,
          model: lease.model,
          latencyMs: Date.now() - started,
          ...(usage ? { usage } : {}),
          updatedAt: FieldValue.serverTimestamp(),
          completedAt: FieldValue.serverTimestamp(),
          leaseExpiresAt: FieldValue.delete(),
        }, { merge: true });
        transaction.update(firestore.doc(`rooms/${roomId}`), {
          lastMessage: {
            id: messageRef.id,
            senderId: BOT_ID,
            senderDisplayName: BOT_NAME,
            kind: 'text',
            preview: finalText.slice(0, 120),
            createdAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      await draftRef.set({
        runId,
        botId: BOT_ID,
        status: 'complete',
        updatedAt: Date.now(),
        expiresAt: Date.now() + 30_000,
      }).catch(() => undefined);
      return { runId, finalMessageId: messageRef.id, model: lease.model, replayed: false };
    } catch (error) {
      await draftRef.set({
        runId,
        botId: BOT_ID,
        status: abortController.signal.aborted ? 'cancelled' : 'failed',
        updatedAt: Date.now(),
        expiresAt: Date.now() + 30_000,
      }).catch(() => undefined);
      await requestRef.set({
        status: abortController.signal.aborted ? 'cancelled' : 'failed',
        failureCategory: error instanceof HttpsError ? error.code : 'provider',
        latencyMs: Date.now() - started,
        updatedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: FieldValue.delete(),
      }, { merge: true });
      throw error;
    } finally {
      if (concurrencyAcquired) {
        await botRateLimiter.release(runId, auth.uid, roomId).catch(() => undefined);
      }
    }
  },
);
