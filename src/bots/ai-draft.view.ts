/**
 * The streaming AI draft row, extracted from `app/chat.controller.ts` (TD-U1).
 *
 * A draft is not a message: it has no id in the store, and it is replaced
 * wholesale as tokens arrive. It is therefore rendered here rather than through
 * `messages/message.view.ts`, which is keyed by `data-message-id`.
 */
import { actionButton } from '../messages/message.view';

export interface RemoteDraft {
  botId: string;
  text: string;
  status: string;
}

/**
 * One draft row. Pure: everything it needs is an argument.
 *
 * `cancel` is only offered for this client's own run — a draft streaming on
 * someone else's client is not ours to stop.
 */
export function renderAiDraft(runId: string, text: string, cancellable: boolean, cancel?: () => void): HTMLElement {
  const row = document.createElement('article');
  row.className = 'message-row ai-draft';
  row.dataset.runId = runId;
  const wrap = document.createElement('div');
  wrap.className = 'message-wrap';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  const content = document.createElement('p');
  content.className = 'message-text';
  content.textContent = text || 'Gemini 正在思考…';
  bubble.append(content);
  wrap.append(bubble);
  if (cancellable && cancel) wrap.append(actionButton('停止生成', cancel));
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = 'G';
  row.append(avatar, wrap);
  return row;
}

export interface AiDraftViewDeps {
  /** The `#message-list` container drafts are appended to. */
  list: HTMLElement;
  /** True when this client owns the run, so its own draft is not duplicated. */
  isLocalRun: (runId: string) => boolean;
}

export interface AiDraftView {
  /** Replace every remote draft row with the current set. */
  renderRemoteDrafts: (drafts: Map<string, RemoteDraft>) => void;
}

export function createAiDraftView(deps: AiDraftViewDeps): AiDraftView {
  function renderRemoteDrafts(drafts: Map<string, RemoteDraft>): void {
    deps.list.querySelectorAll('[data-remote-ai-draft]').forEach((element) => element.remove());
    for (const [runId, draft] of drafts) {
      if (deps.isLocalRun(runId) || draft.status !== 'streaming') continue;
      const row = renderAiDraft(runId, draft.text, false);
      row.dataset.remoteAiDraft = 'true';
      deps.list.append(row);
    }
  }

  return { renderRemoteDrafts };
}
