import { z } from 'zod'

type Issue = Parameters<z.core.$ZodErrorMap>[0]

const typeNames: Record<string, string> = {
  string: 'mətn',
  number: 'rəqəm',
  int: 'tam ədəd',
  bigint: 'tam ədəd',
  boolean: 'hə/yox dəyəri',
  array: 'siyahı',
  object: 'obyekt',
  date: 'tarix',
}

const formatMessages: Record<string, string> = {
  email: 'E-poçt ünvanı düzgün deyil.',
  uuid: 'İdentifikator düzgün deyil.',
  guid: 'İdentifikator düzgün deyil.',
  url: 'Keçid (URL) düzgün deyil.',
  datetime: 'Tarix və saat düzgün deyil.',
  date: 'Tarix düzgün deyil.',
  time: 'Saat düzgün deyil.',
}

function tooSmall(issue: Extract<Issue, { code: 'too_small' }>): string | undefined {
  const min = Number(issue.minimum)
  switch (issue.origin) {
    case 'string':
      return min <= 1 ? 'Bu sahə boş ola bilməz.' : `Ən azı ${min} simvol olmalıdır.`
    case 'array':
    case 'set':
      return `Ən azı ${min} element olmalıdır.`
    case 'number':
    case 'int':
    case 'bigint':
      if (issue.inclusive) return `Dəyər ən azı ${min} olmalıdır.`
      return min === 0 ? 'Dəyər sıfırdan böyük olmalıdır.' : `Dəyər ${min} rəqəmindən böyük olmalıdır.`
    default:
      return undefined
  }
}

function tooBig(issue: Extract<Issue, { code: 'too_big' }>): string | undefined {
  const max = Number(issue.maximum)
  switch (issue.origin) {
    case 'string':
      return `Ən çox ${max} simvol ola bilər.`
    case 'array':
    case 'set':
      return `Ən çox ${max} element ola bilər.`
    case 'number':
    case 'int':
    case 'bigint':
      return issue.inclusive ? `Dəyər ən çox ${max} ola bilər.` : `Dəyər ${max} rəqəmindən kiçik olmalıdır.`
    default:
      return undefined
  }
}

/**
 * User-facing Azerbaijani messages for the validation issues the API produces.
 * The web client shows `details[0].message` verbatim, so these must read as
 * plain sentences, not schema jargon. A message set on the schema itself still
 * wins over this map; anything unmapped falls back to zod's `az` locale.
 */
export const azErrorMap: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case 'invalid_type': {
      if (issue.input === undefined || issue.input === null) return 'Bu sahə məcburidir.'
      const expected = typeNames[issue.expected]
      return expected ? `Dəyər ${expected} olmalıdır.` : 'Dəyərin tipi düzgün deyil.'
    }
    case 'too_small':
      return tooSmall(issue)
    case 'too_big':
      return tooBig(issue)
    case 'invalid_format':
      return formatMessages[issue.format] ?? 'Format düzgün deyil.'
    case 'invalid_value':
      return 'Seçilmiş dəyər icazə verilənlərdən deyil.'
    case 'unrecognized_keys':
      return `Tanınmayan sahə: ${issue.keys.join(', ')}.`
    case 'not_multiple_of':
      return 'Dəyər icazə verilən addıma uyğun deyil.'
    case 'invalid_union':
    case 'invalid_key':
    case 'invalid_element':
      return 'Göndərilən dəyər düzgün deyil.'
    default:
      return undefined
  }
}

let installed = false

/** Installs the Azerbaijani messages globally. Idempotent. */
export function installZodMessages(): void {
  if (installed) return
  installed = true
  z.config({ ...z.locales.az(), customError: azErrorMap })
}
