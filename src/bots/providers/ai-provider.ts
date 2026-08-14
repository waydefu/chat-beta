import type { AIGrounding, AISource } from '../../types';

export type { AIGrounding, AISource };

export interface AIRequest {
  roomId: string;
  sourceMessageId: string;
  botId: string;
}

export interface AIChunk {
  runId: string;
  text: string;
  sources?: AISource[];
}

export interface AIResult {
  runId: string;
  finalMessageId: string;
  model: string;
  replayed?: boolean;
  grounding?: AIGrounding;
}

export interface AIProvider {
  generate(request: AIRequest, signal: AbortSignal): Promise<{
    stream: AsyncIterable<AIChunk>;
    result: Promise<AIResult>;
  }>;
}
