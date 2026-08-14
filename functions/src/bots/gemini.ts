import { GoogleGenAI, type Content } from '@google/genai';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { database, firestore } from '../admin.js';
import { appCheckEnforced, geminiApiKey, REGION } from '../config.js';
import { requireAuth, requireRecord, requireString, roomKey } from '../shared/validation.js';
import { buildBotContext } from './context-builder.js';
import { BotPermissionService, BotRateLimiter, BotRegistry, BotRouter } from './framework.js';
import { geminiCountTokensConfig, geminiGenerationConfig } from './gemini-request-config.js';
import { aiErrorMessage, classifyProviderError, type AiErrorCode } from './ai-errors.js';
import {
  determineGroundingUsed,
  mergeGroundingSources,
  type AIGrounding,
  type AISource,
} from './grounding-policy.js';
import { stableGeminiModel } from './model-config.js';

const BOT_ID = 'gemini';
const BOT_NAME = 'Gemini';
const LEASE_MS = 90_000;
const DRAFT_TTL_MS = 10 * 60_000;
const INPUT_TOKEN_BUDGET = 24_000;
const SYSTEM_INSTRUCTION =
  '你是 Chat Lite 聊天室中的 AI 參與者。\n' +
  '優先根據聊天室提供的 context 理解問題。\n' +
  '如果問題涉及現在、今天、最新、即時、天氣、新聞、價格、版本、發布狀態、公開事件或可能已變動的公開資訊，且 Google Search grounding 可提高正確性，應使用 Google Search。\n' +
  '如果問題不需要最新資料，不要為了搜尋而搜尋。\n' +
  '不得聲稱查過資料如果實際沒有 grounding，不得聲稱擁有使用者未授權的私人資料，不得聲稱看得到 Gmail、Google 日曆、Google 雲端硬碟，也不得聲稱知道使用者精確位置。\n' +
  '若問題詢問天氣或在地資訊但地點不明確（例如「今天天氣如何？」且聊天室沒有地點資訊），應主動詢問使用者想查詢的地點，不要猜測使用者所在地。\n' +
  '回答天氣時，應依據近期搜尋資訊說明時間點，若搜尋結果不足應明確表明資料不足，不可自行虛構數值或降雨機率。\n' +
  '回答保持簡潔、誠實與繁體中文。';
const ENFORCE_APP_CHECK = appCheckEnforced('ai');
const botRegistry = new BotRegistry([{ id: BOT_ID, displayName: BOT_NAME, provider: 'gemini' }]);
const botRouter = new BotRouter(botRegistry);
const botPermissions = new BotPermissionService();
const botRateLimiter = new BotRateLimiter();

type AiGeneratePhase = 'accepted' | 'preflight_failed' | 'lease_acquired' | 'provider_started' | 'complete' | 'failed';

interface AiGenerateLogFields {
  result: string;
  model?: string;
  modelSource?: string;
  errorCategory?: string;
  latencyMs: number;
  acceptsStreaming: boolean;
  authPresent: boolean;
  appCheckPresent: boolean;
  groundingUsed?: boolean;
  groundingSourceCount?: number;
}

function logAiGenerate(
  level: 'info' | 'error',
  phase: AiGeneratePhase,
  fields: AiGenerateLogFields,
): void {
  logger[level](`ai.generate.${phase}`, {
    operation: 'ai.generate',
    phase,
    ...fields,
  });
}

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

function domainCodeOf(error: unknown, aborted: boolean): AiErrorCode {
  if (error instanceof HttpsError) {
    const declared = (error.details as { code?: unknown } | undefined)?.code;
    if (typeof declared === 'string') return declared as AiErrorCode;
    if (error.code === 'permission-denied') return 'AI_PERMISSION_DENIED';
    if (error.code === 'resource-exhausted') return 'AI_RATE_LIMITED';
  }
  return classifyProviderError(error, aborted);
}

function preflightErrorCategory(error: unknown): string {
  if (!(error instanceof HttpsError)) return 'AI_UNKNOWN';
  const declared = (error.details as { code?: unknown } | undefined)?.code;
  if (typeof declared === 'string') return declared;
  if (error.code === 'unauthenticated') return 'AUTH_REQUIRED';
  if (error.code === 'permission-denied') return 'AI_PERMISSION_DENIED';
  if (error.code === 'invalid-argument') return 'INVALID_REQUEST';
  if (error.code === 'already-exists') return 'AI_ALREADY_RUNNING';
  if (error.code === 'resource-exhausted') return 'AI_RATE_LIMITED';
  return 'AI_UNKNOWN';
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
    const handlerStartedAt = Date.now();
    const logContext = {
      acceptsStreaming: request.acceptsStreaming,
      authPresent: Boolean(request.auth),
      appCheckPresent: Boolean(request.app),
    };
    let preflightModel: string | undefined;
    let preflightModelSource: string | undefined;

    logAiGenerate('info', 'accepted', {
      result: 'accepted',
      latencyMs: 0,
      ...logContext,
    });

    const preflight = await (async () => {
      try {
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
        const modelChoice = await stableGeminiModel(now);
        const configuredModel = modelChoice.model;
        preflightModel = configuredModel;
        preflightModelSource = modelChoice.source;
        const lease = await firestore.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(requestRef);
          const existing = snapshot.data();
          if (existing?.status === 'complete') {
            return { alreadyComplete: true, attempt: Number(existing.attempt || 1), model: String(existing.model || configuredModel) };
          }
          if (existing?.status === 'running' && existing.leaseExpiresAt?.toMillis?.() > now) {
            throw new HttpsError('already-exists', aiErrorMessage('AI_ALREADY_RUNNING'), { code: 'AI_ALREADY_RUNNING' });
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
        logAiGenerate('info', 'lease_acquired', {
          result: lease.alreadyComplete ? 'replayed' : 'acquired',
          model: lease.model,
          modelSource: modelChoice.source,
          latencyMs: Date.now() - handlerStartedAt,
          ...logContext,
        });
        return { auth, roomId, sourceMessageId, runId, requestRef, messageRef, modelChoice, lease };
      } catch (error) {
        const errorCategory = preflightErrorCategory(error);
        logAiGenerate('error', 'preflight_failed', {
          result: 'failed',
          ...(preflightModel ? { model: preflightModel } : {}),
          ...(preflightModelSource ? { modelSource: preflightModelSource } : {}),
          errorCategory,
          latencyMs: Date.now() - handlerStartedAt,
          ...logContext,
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('unavailable', aiErrorMessage('AI_UNKNOWN'), { code: errorCategory });
      }
    })();
    const { auth, roomId, sourceMessageId, runId, requestRef, messageRef, modelChoice, lease } = preflight;
    if (lease.alreadyComplete) {
      logAiGenerate('info', 'complete', {
        result: 'replayed',
        model: lease.model,
        modelSource: modelChoice.source,
        latencyMs: Date.now() - handlerStartedAt,
        ...logContext,
      });
      return { runId, finalMessageId: messageRef.id, model: lease.model, replayed: true };
    }

    const draftRef = database.ref(`realtime/rooms/${roomKey(roomId)}/aiDrafts/${runId}`);
    const started = Date.now();
    let finalText = '';
    let lastDraftAt = 0;
    let lastDraftLength = 0;
    let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;
    let concurrencyAcquired = false;
    let accumulatedSources: AISource[] = [];
    let rawSearchDetected = false;
    const abortController = new AbortController();
    response?.signal.addEventListener('abort', () => abortController.abort(), { once: true });

    try {
      await botRateLimiter.acquire(runId, auth.uid, roomId);
      concurrencyAcquired = true;
      const botContext = await buildBotContext(roomId, sourceMessageId, BOT_ID, auth.uid);
      const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });
      let contents = generationContents(botContext.context, botContext.prompt);
      logAiGenerate('info', 'provider_started', {
        result: 'started',
        model: lease.model,
        modelSource: modelChoice.source,
        latencyMs: Date.now() - handlerStartedAt,
        ...logContext,
      });
      let tokenCount = await ai.models.countTokens({
        model: lease.model,
        contents,
        config: geminiCountTokensConfig(abortController.signal),
      });
      while ((tokenCount.totalTokens ?? 0) > INPUT_TOKEN_BUDGET && botContext.context.length > 0) {
        botContext.context.splice(0, Math.max(1, Math.ceil(botContext.context.length / 10)));
        contents = generationContents(botContext.context, botContext.prompt);
        tokenCount = await ai.models.countTokens({
          model: lease.model,
          contents,
          config: geminiCountTokensConfig(abortController.signal),
        });
      }
      if ((tokenCount.totalTokens ?? 0) > INPUT_TOKEN_BUDGET) {
        throw new HttpsError('invalid-argument', aiErrorMessage('AI_CONTEXT_TOO_LARGE'), { code: 'AI_CONTEXT_TOO_LARGE' });
      }
      const stream = await ai.models.generateContentStream({
        model: lease.model,
        contents,
        config: geminiGenerationConfig(abortController.signal, SYSTEM_INSTRUCTION, 2048),
      });

      for await (const chunk of stream) {
        if (abortController.signal.aborted) throw new HttpsError('cancelled', aiErrorMessage('AI_CANCELLED'), { code: 'AI_CANCELLED' });
        const text = chunk.text ?? '';
        if (chunk.usageMetadata) {
          usage = {
            inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: chunk.usageMetadata.totalTokenCount ?? 0,
          };
        }
        const chunkMetadata = chunk.candidates?.[0]?.groundingMetadata
          ?? (chunk as { groundingMetadata?: unknown }).groundingMetadata;
        if (chunkMetadata) {
          accumulatedSources = mergeGroundingSources(accumulatedSources, chunkMetadata);
          if (determineGroundingUsed([], chunkMetadata)) {
            rawSearchDetected = true;
          }
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
      const usedSearch = determineGroundingUsed(accumulatedSources, rawSearchDetected);
      const grounding: AIGrounding | undefined = usedSearch
        ? { usedSearch: true, sources: accumulatedSources }
        : undefined;

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
          metadata: {
            aiRequestId: runId,
            model: lease.model,
            ...(grounding ? { grounding } : {}),
          },
        });
        transaction.set(requestRef, {
          status: 'complete',
          finalMessageId: messageRef.id,
          model: lease.model,
          latencyMs: Date.now() - started,
          ...(usage ? { usage } : {}),
          groundingUsed: Boolean(grounding?.usedSearch),
          groundingSourceCount: accumulatedSources.length,
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
      logAiGenerate('info', 'complete', {
        result: 'complete',
        model: lease.model,
        modelSource: modelChoice.source,
        latencyMs: Date.now() - handlerStartedAt,
        groundingUsed: Boolean(grounding?.usedSearch),
        groundingSourceCount: accumulatedSources.length,
        ...logContext,
      });
      return {
        runId,
        finalMessageId: messageRef.id,
        model: lease.model,
        replayed: false,
        ...(grounding ? { grounding } : {}),
      };
    } catch (error) {
      const aborted = abortController.signal.aborted;
      const domainCode = domainCodeOf(error, aborted);
      const status = aborted || domainCode === 'AI_CANCELLED' ? 'cancelled' : 'failed';
      await draftRef.set({
        runId,
        botId: BOT_ID,
        status,
        updatedAt: Date.now(),
        expiresAt: Date.now() + 30_000,
      }).catch(() => undefined);
      await requestRef.set({
        status,
        failureCategory: domainCode,
        latencyMs: Date.now() - started,
        updatedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: FieldValue.delete(),
      }, { merge: true });
      logAiGenerate('error', 'failed', {
        result: status,
        model: lease.model,
        modelSource: modelChoice.source,
        errorCategory: domainCode,
        latencyMs: Date.now() - handlerStartedAt,
        ...logContext,
      });
      // Never re-throw the provider error: its message and details quote the
      // request, which is the user's chat content.
      if (error instanceof HttpsError) throw error;
      throw new HttpsError(
        domainCode === 'AI_RATE_LIMITED' ? 'resource-exhausted'
          : domainCode === 'AI_CANCELLED' ? 'cancelled'
            : domainCode === 'AI_TIMEOUT' ? 'deadline-exceeded'
              : domainCode === 'AI_CONFIGURATION_ERROR' ? 'failed-precondition'
                : 'unavailable',
        aiErrorMessage(domainCode),
        { code: domainCode },
      );
    } finally {
      if (concurrencyAcquired) {
        await botRateLimiter.release(runId, auth.uid, roomId).catch(() => undefined);
      }
    }
  },
);
