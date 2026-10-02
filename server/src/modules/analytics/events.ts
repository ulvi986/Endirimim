import { db } from '../../db/client.js'
import { storeAnalyticsEvents } from '../../db/schema.js'

export type AnalyticsEventType = 'view' | 'offer_click' | 'favorite' | 'alert'

/**
 * Views and clicks are anonymous, so one visitor reloading a page would otherwise
 * inflate a merchant's numbers. The same visitor + target is counted once per
 * window. Kept in process memory: good enough for one instance, and a lost entry
 * only means one extra count, never a missing one.
 */
const DEDUPE_WINDOW_MS = 30 * 60 * 1000
const DEDUPE_MAX_ENTRIES = 50_000
const recentlySeen = new Map<string, number>()

function seenRecently(key: string, now: number): boolean {
  const last = recentlySeen.get(key)
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return true

  // Re-insert so iteration order stays oldest-first, then evict from the front.
  recentlySeen.delete(key)
  recentlySeen.set(key, now)
  while (recentlySeen.size > DEDUPE_MAX_ENTRIES) {
    const oldest = recentlySeen.keys().next().value
    if (oldest === undefined) break
    recentlySeen.delete(oldest)
  }
  return false
}

/**
 * Analytics must never break a shopper's request, so failures are logged and
 * swallowed rather than propagated. Callers intentionally do not await this.
 */
export function recordEvent(input: {
  merchantId: string | null | undefined
  productId?: string | null
  eventType: AnalyticsEventType
  /** Identifies the visitor + target (e.g. ip and offer id); repeats within the window are dropped. */
  dedupeKey?: string
}): void {
  if (!input.merchantId) return
  if (input.dedupeKey && seenRecently(`${input.eventType}:${input.dedupeKey}`, Date.now())) return

  void db
    .insert(storeAnalyticsEvents)
    .values({
      merchantId: input.merchantId,
      productId: input.productId ?? null,
      eventType: input.eventType,
    })
    .catch((error) => {
      console.error('[analytics] failed to record event', { ...input, error })
    })
}
