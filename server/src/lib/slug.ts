const FOLD: Record<string, string> = {
  ə: 'e', ı: 'i', ö: 'o', ü: 'u', ç: 'c', ş: 's', ğ: 'g',
  â: 'a', î: 'i', û: 'u', é: 'e', è: 'e', ñ: 'n',
}

/**
 * Azerbaijani Latin has several letters that NFD does not decompose
 * (schwa, dotless i), so they are folded explicitly before normalisation.
 */
export function slugify(input: string): string {
  const folded = input
    .toLowerCase()
    .split('')
    .map((char) => FOLD[char] ?? char)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')

  const slug = folded
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)

  return slug || 'item'
}

/**
 * Appends -2, -3, ... until `isTaken` reports the candidate is free.
 * Keeps unique slugs working without surfacing constraint violations to users.
 */
export async function uniqueSlug(base: string, isTaken: (candidate: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base)
  let candidate = root
  let suffix = 2
  while (await isTaken(candidate)) {
    candidate = `${root}-${suffix}`
    suffix += 1
    if (suffix > 500) return `${root}-${Date.now()}`
  }
  return candidate
}
