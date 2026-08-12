import { algoliasearch } from 'algoliasearch';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall } from 'firebase-functions/v2/https';

import { algoliaAdminKey, algoliaAppId, algoliaIndexName, appCheckEnforced, REGION } from '../config.js';
import { getActiveMembership } from '../shared/membership.js';
import { requireAuth, requireRecord, requireString } from '../shared/validation.js';

interface MessageRecord {
  objectID: string;
  roomId: string;
  messageId: string;
  senderDisplayName: string;
  senderType: string;
  kind: string;
  text: string;
  createdAt: number;
}

const ENFORCE_APP_CHECK = appCheckEnforced('search');

function client() {
  return algoliasearch(algoliaAppId.value(), algoliaAdminKey.value());
}

export const syncMessageSearchIndex = onDocumentWritten(
  {
    region: REGION,
    document: 'rooms/{roomId}/messages/{messageId}',
    secrets: [algoliaAppId, algoliaAdminKey, algoliaIndexName],
    retry: true,
  },
  async (event) => {
    const objectID = `${event.params.roomId}_${event.params.messageId}`;
    const after = event.data?.after;
    const data = after?.data();
    if (!after?.exists || data?.deletedAt || data?.kind !== 'text' || typeof data.text !== 'string') {
      await client().deleteObject({ indexName: algoliaIndexName.value(), objectID });
      return;
    }
    await client().saveObject({
      indexName: algoliaIndexName.value(),
      body: {
        objectID,
        roomId: event.params.roomId,
        messageId: event.params.messageId,
        senderDisplayName: String(data.senderDisplayName || ''),
        senderType: String(data.senderType || ''),
        kind: String(data.kind),
        text: data.text,
        createdAt: data.createdAt?.toMillis?.() ?? 0,
      } satisfies MessageRecord,
    });
  },
);

export const searchMessages = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    secrets: [algoliaAppId, algoliaAdminKey, algoliaIndexName],
  },
  async (request) => {
    const auth = requireAuth(request);
    const data = requireRecord(request.data);
    const roomId = requireString(data.roomId, 'roomId', 50);
    const query = requireString(data.query, 'query', 200);
    const page = Number.isSafeInteger(data.page) ? Math.max(0, Number(data.page)) : 0;
    await getActiveMembership(roomId, auth.uid);
    const response = await client().searchSingleIndex<MessageRecord>({
      indexName: algoliaIndexName.value(),
      searchParams: {
        query,
        filters: `roomId:${JSON.stringify(roomId)}`,
        page,
        hitsPerPage: 30,
        attributesToRetrieve: ['roomId', 'messageId', 'senderDisplayName', 'senderType', 'kind', 'text', 'createdAt'],
      },
    });
    return { hits: response.hits, page: response.page, pages: response.nbPages };
  },
);
