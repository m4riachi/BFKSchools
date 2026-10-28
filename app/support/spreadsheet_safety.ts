/**
 * CSV / Excel formula injection ("CSV injection", OWASP): a cell whose text
 * starts with `=`, `+`, `-`, `@`, a tab or a carriage return can be run as a
 * formula by Excel/LibreOffice when the file is opened. Child names, class
 * names, meal names and notes are typed by people, so every **text** cell of
 * an export goes through `safeCell()`, which prefixes such values with a
 * single quote (the usual neutralization; spreadsheet apps show the text
 * as typed). Numbers (quantities, centimes) are written as numbers and never
 * escaped.
 *
 * Fullwidth variants (`＝`, `＋`, `－`, `＠`) are escaped too: some
 * spreadsheet apps normalize them to their ASCII forms.
 */
const DANGEROUS_FIRST_CHAR = new RegExp('^[=+\\-@\\t\\r\\uFF1D\\uFF0B\\uFF0D\\uFF20]')

/** Control characters other than tab/newline/CR (never useful in a report cell). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export function safeCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value).replace(CONTROL_CHARS, '')
  return DANGEROUS_FIRST_CHAR.test(text) ? `'${text}` : text
}

/** True when `safeCell` would escape the value (used by tests). */
export function needsEscaping(value: string): boolean {
  return DANGEROUS_FIRST_CHAR.test(value)
}

/**
 * A safe file name part: ASCII letters, digits, `-` and `_` only (dates are
 * validated `YYYY-MM-DD` strings already). Used in Content-Disposition.
 */
export function fileNamePart(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'all'
  )
}
