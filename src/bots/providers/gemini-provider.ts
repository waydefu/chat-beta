import { FIREBASE_REGION, firebaseApp } from '../../firebase/app';
import { initializeClientAppCheck } from '../../firebase/app-check';
import type { AIChunk, AIProvider, AIRequest, AIResult } from './ai-provider';

export class GeminiProvider implements AIProvider {
  async generate(request: AIRequest, signal: AbortSignal): Promise<{
    stream: AsyncIterable<AIChunk>;
    result: Promise<AIResult>;
  }> {
    await initializeClientAppCheck();
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const generate = httpsCallable<AIRequest, AIResult, AIChunk>(
      getFunctions(firebaseApp, FIREBASE_REGION),
      'generateGeminiReply',
    );
    const response = await generate.stream(request, {
      signal,
      limitedUseAppCheckTokens: true,
    });
    return { stream: response.stream, result: response.data };
  }
}
