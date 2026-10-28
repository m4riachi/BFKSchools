/**
 * Route param matcher for database ids (PostgreSQL `integer`): only
 * 1..2147483647 written without sign, leading zeros or decimals. Anything
 * else does not match the route → 404, instead of reaching the database
 * (where an int4 overflow would be a 500).
 */
export const DB_ID_MAX = 2_147_483_647

const DB_ID_PATTERN =
  /^(?:[1-9]\d{0,8}|1\d{9}|20\d{8}|21[0-3]\d{7}|214[0-6]\d{6}|2147[0-3]\d{5}|21474[0-7]\d{4}|214748[0-2]\d{3}|2147483[0-5]\d{2}|21474836[0-3]\d|214748364[0-7])$/

export function isDbId(value: string): boolean {
  return DB_ID_PATTERN.test(value)
}

export const dbIdMatcher = {
  match: DB_ID_PATTERN,
  cast: (value: string) => Number(value),
}
