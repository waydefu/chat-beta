export interface AIRequest {
  roomId: string;
  sourceMessageId: string;
  botId: string;
}

export interface AIChunk {
  runId: string;
  text: string;
}

export interface AIResult {
  runId: string;
  finalMessageId: string;
  model: string;
}

export interface AIProvider {
  generate(request: AIRequest, signal: AbortSignal): Promise<{
    stream: AsyncIterable<AIChunk>;
    result: Promise<AIResult>;
  }>;
}
