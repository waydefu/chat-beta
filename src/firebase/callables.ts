import type { HttpsCallableOptions, HttpsCallableResult } from 'firebase/functions';

import { FIREBASE_REGION, firebaseApp } from './app';

export async function callFunction<Request, Response>(
  name: string,
  data: Request,
  options?: HttpsCallableOptions,
): Promise<Response> {
  const [{ initializeClientAppCheck }, { getFunctions, httpsCallable }] = await Promise.all([
    import('./app-check'),
    import('firebase/functions'),
  ]);
  await initializeClientAppCheck();
  const callable = httpsCallable<Request, Response>(getFunctions(firebaseApp, FIREBASE_REGION), name, options);
  const result: HttpsCallableResult<Response> = await callable(data);
  return result.data;
}
