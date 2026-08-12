export interface CallJoinOptions {
  roomId: string;
  callId: string;
  audio: boolean;
  video: boolean;
}

export interface CallSession {
  leave(): Promise<void>;
  setMicrophone(enabled: boolean): Promise<void>;
  setCamera(enabled: boolean): Promise<void>;
  setScreenShare(enabled: boolean): Promise<void>;
}

export interface CallProvider {
  join(options: CallJoinOptions, signal: AbortSignal): Promise<CallSession>;
}
