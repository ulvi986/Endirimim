import { z } from 'zod'

/**
 * `z.url()` accepts any scheme, including `javascript:` and `data:`. Every URL
 * the API stores is later rendered as a link or image by the web client, so
 * only http(s) is allowed.
 */
/**
 * Builds a `%term%` ILIKE pattern that matches the term literally. Without this a
 * search for "%" or "_" becomes a wildcard and matches every row. Postgres LIKE
 * uses backslash as its default escape character.
 */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

export const httpUrl = (max = 1000) => z.url({ protocol: /^https?$/, error: 'Yalnız http(s) keçidlərinə icazə verilir.' }).max(max)
