import type { Timestamp } from 'firebase/firestore';

export interface RoomPreview {
  id: string;
  createdAt?: Timestamp | null;
  createdBy?: string;
  updatedAt?: Timestamp | null;
  lastMessage?: {
    id?: string;
    text?: string;
    uid?: string;
    user?: string;
    timestamp?: Timestamp | null;
  };
}

export interface ChatMessage {
  id: string;
  uid: string;
  user: string;
  text: string;
  timestamp?: Timestamp | null;
  editedAt?: Timestamp | null;
  replyToId?: string;
  clientCreatedAt?: number;
  pending?: boolean;
  failed?: boolean;
}

export interface RoomReadState {
  lastReadAt?: Timestamp | null;
  lastReadMessageId?: string;
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

export type Unsubscribe = () => void;
