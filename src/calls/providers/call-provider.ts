export interface CallParticipant {
  identity: string;
  name: string;
}

export interface CallJoinOptions {
  roomId: string;
  callId: string;
  audio: boolean;
  video: boolean;
  /**
   * Where the provider attaches video elements. The caller owns the surrounding
   * panel - its controls, drag behaviour and participant list - so that the
   * provider stays a transport and the chrome stays testable without a room.
   */
  stage: HTMLElement;
  /** Remote participants only, reported on connect and on every change. */
  onParticipants(participants: CallParticipant[]): void;
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
