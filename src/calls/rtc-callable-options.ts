import type { HttpsCallableOptions } from 'firebase/functions';

/** All replay-sensitive RTC transitions must use the same limited-use App Check policy. */
export const RTC_CALLABLE_OPTIONS: HttpsCallableOptions = Object.freeze({
  limitedUseAppCheckTokens: true,
});
