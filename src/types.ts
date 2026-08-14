export interface TimestampLike {
  toMillis(): number;
}

export type RoomType = 'group' | 'direct';
export type RoomVisibility = 'public' | 'private';
export type RoomRole = 'owner' | 'admin' | 'member';
export type MembershipStatus = 'active' | 'revoking';
export type SenderType = 'user' | 'bot' | 'system';
export type MessageKind = 'text' | 'image' | 'video' | 'file' | 'audio' | 'sticker' | 'system' | 'call';
export type AttachmentType = 'image' | 'video' | 'file' | 'audio';

export interface Mention {
  type: 'user' | 'bot';
  id: string;
  label: string;
  start: number;
  end: number;
}

export interface Attachment {
  id: string;
  type: AttachmentType;
  objectKey: string;
  mimeType: string;
  fileName: string;
  size: number;
  status: 'quarantined' | 'ready' | 'failed' | 'deleted';
  width?: number;
  height?: number;
  duration?: number;
  previewKey?: string;
}

export interface AISource {
  title: string;
  url: string;
}

export interface AIGrounding {
  usedSearch: boolean;
  sources: AISource[];
}

export interface MessageMetadata {
  aiRequestId?: string;
  model?: string;
  grounding?: AIGrounding;
  [key: string]: unknown;
}

export interface MessageBase {
  id: string;
  roomId: string;
  senderId: string;
  senderType: SenderType;
  senderDisplayName: string;
  kind: MessageKind;
  createdAt?: TimestampLike | null;
  clientCreatedAt?: number;
  replyToId?: string;
  mentions?: Mention[];
  editedAt?: TimestampLike | null;
  deletedAt?: TimestampLike | null;
  pending?: boolean;
  failed?: boolean;
  metadata?: MessageMetadata;
}

export interface TextMessage extends MessageBase {
  kind: 'text';
  text: string;
}

export interface AttachmentMessage extends MessageBase {
  kind: 'image' | 'video' | 'file' | 'audio';
  text?: string;
  attachmentIds: string[];
}

export interface StickerMessage extends MessageBase {
  kind: 'sticker';
  stickerPackId: string;
  stickerId: string;
}

export interface SystemMessage extends MessageBase {
  kind: 'system';
  event: string;
  text?: string;
}

export interface CallMessage extends MessageBase {
  kind: 'call';
  callId: string;
  event: 'started' | 'declined' | 'missed' | 'ended';
  duration?: number;
}

export type ChatMessage = TextMessage | AttachmentMessage | StickerMessage | SystemMessage | CallMessage;

export interface RoomPreview {
  id: string;
  name: string;
  type: RoomType;
  visibility: RoomVisibility;
  ownerId: string;
  schemaVersion: 3;
  createdAt?: TimestampLike | null;
  updatedAt?: TimestampLike | null;
  lastMessage?: {
    id: string;
    senderId: string;
    senderDisplayName: string;
    kind: MessageKind;
    preview: string;
    createdAt?: TimestampLike | null;
  };
}

export interface RoomMembership {
  userId: string;
  role: RoomRole;
  status: MembershipStatus;
  displayName: string;
  photoURL?: string;
  version: number;
  joinedAt?: TimestampLike | null;
  updatedAt?: TimestampLike | null;
}

/** A call the server still considers live. Ended calls are not mirrored here. */
export interface RoomCall {
  callId: string;
  kind: 'voice' | 'video';
  status: 'creating' | 'ringing' | 'active' | 'ending' | 'ended' | 'failed' | 'rejected' | 'missed' | 'cancelled';
  startedBy: string;
  startedByDisplayName?: string;
  activeAt?: TimestampLike | null;
}

export interface IncomingCallSignal {
  callId: string;
  roomId: string;
  kind: 'voice' | 'video';
  status: 'ringing' | 'accepted' | 'rejected' | 'missed' | 'cancelled' | 'active' | 'ended' | 'failed';
  startedBy: string;
  startedByDisplayName: string;
  createdAt?: TimestampLike | null;
  updatedAt?: TimestampLike | null;
}

export interface RoomReadState {
  membershipStatus?: MembershipStatus;
  role?: RoomRole;
  roomName?: string;
  lastReadAt?: TimestampLike | null;
  lastReadMessageId?: string;
  updatedAt?: TimestampLike | null;
}

export interface UserProfile {
  displayName?: string;
  photoURL?: string;
}

export interface OnlineUser {
  uid: string;
  displayName: string;
  online: boolean;
}

export interface Reaction {
  messageId: string;
  userId: string;
  emoji: string;
  updatedAt?: TimestampLike | null;
}

export interface BotProfile {
  id: string;
  displayName: string;
  type: 'bot';
  provider: string;
  model: string;
  capabilities: string[];
  avatarURL?: string;
}

export type Unsubscribe = () => void;
