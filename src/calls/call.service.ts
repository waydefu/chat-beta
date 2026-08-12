import { callFunction } from '../firebase/callables';
import type { CallProvider, CallSession } from './providers/call-provider';

export async function startCall(
  provider: CallProvider,
  roomId: string,
  kind: 'voice' | 'video',
  signal: AbortSignal,
): Promise<{ callId: string; session: CallSession }> {
  const response = await callFunction<{ roomId: string; kind: string }, { callId: string }>(
    'startLiveKitCall',
    { roomId, kind },
    { limitedUseAppCheckTokens: true },
  );
  const session = await provider.join({
    roomId,
    callId: response.callId,
    audio: true,
    video: kind === 'video',
  }, signal);
  return { callId: response.callId, session };
}

export async function endCall(roomId: string, callId: string): Promise<void> {
  await callFunction('endLiveKitCall', { roomId, callId });
}
