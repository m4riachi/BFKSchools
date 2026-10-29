/**
 * A same-origin path for a redirect: one leading "/", not "//" or "/\\"
 * (browsers treat a backslash like a slash, so "/\\evil.example" is
 * protocol-relative), and no backslash or control character anywhere
 * (browsers strip tabs/newlines before parsing, "/\t/evil.example" → "//evil.example").
 */
export function isLocalPath(href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//')) return false
  for (const char of href) {
    const code = char.charCodeAt(0)
    if (char === '\\' || code < 0x20 || code === 0x7f) return false
  }
  return true
}
