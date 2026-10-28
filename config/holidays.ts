import type { IsoWeekday } from '#support/dates'

/**
 * Holiday settings (Phase 4). Not stored in the database: changing a value
 * here is a code change (reviewed, tested). Names are stored in the
 * `holidays.name` column in French (the back-office language); the admin can
 * rename any row afterwards.
 */

export type HolidayRule = {
  code: string
  nameFr: string
  nameEn: string
  /** First calendar year the holiday exists (older years are skipped). */
  sinceYear?: number
} & (
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'nth_weekday'; month: number; weekday: IsoWeekday; n: number }
  | { kind: 'last_weekday'; month: number; weekday: IsoWeekday }
  | { kind: 'nth_weekday_plus'; month: number; weekday: IsoWeekday; n: number; plusDays: number }
)

/**
 * US federal holidays closed by Britech School (brief §5.3), computed by rule
 * in `UsHolidayCalculator`. Fixed-date holidays follow the federal "observed"
 * rule (Saturday → Friday, Sunday → Monday). Rule keys: `us_<code>_<year>`.
 */
export const US_FEDERAL_HOLIDAY_RULES: readonly HolidayRule[] = [
  {
    code: 'new_year',
    nameFr: "Jour de l'An",
    nameEn: "New Year's Day",
    kind: 'fixed',
    month: 1,
    day: 1,
  },
  {
    code: 'mlk_day',
    nameFr: 'Martin Luther King Jr. Day',
    nameEn: 'Martin Luther King Jr. Day',
    kind: 'nth_weekday',
    month: 1,
    weekday: 1,
    n: 3,
  },
  {
    code: 'presidents_day',
    nameFr: "Presidents' Day",
    nameEn: "Presidents' Day",
    kind: 'nth_weekday',
    month: 2,
    weekday: 1,
    n: 3,
  },
  {
    code: 'memorial_day',
    nameFr: 'Memorial Day',
    nameEn: 'Memorial Day',
    kind: 'last_weekday',
    month: 5,
    weekday: 1,
  },
  {
    code: 'juneteenth',
    nameFr: 'Juneteenth',
    nameEn: 'Juneteenth',
    kind: 'fixed',
    month: 6,
    day: 19,
  },
  {
    code: 'labor_day',
    nameFr: 'Labor Day',
    nameEn: 'Labor Day',
    kind: 'nth_weekday',
    month: 9,
    weekday: 1,
    n: 1,
  },
  {
    code: 'columbus_day',
    nameFr: 'Columbus Day / Indigenous Peoples’ Day',
    nameEn: 'Columbus Day / Indigenous Peoples’ Day',
    kind: 'nth_weekday',
    month: 10,
    weekday: 1,
    n: 2,
  },
  {
    code: 'veterans_day',
    nameFr: 'Veterans Day',
    nameEn: 'Veterans Day',
    kind: 'fixed',
    month: 11,
    day: 11,
  },
  {
    code: 'thanksgiving',
    nameFr: 'Thanksgiving',
    nameEn: 'Thanksgiving',
    kind: 'nth_weekday',
    month: 11,
    weekday: 4,
    n: 4,
  },
  {
    code: 'thanksgiving_friday',
    nameFr: 'Lendemain de Thanksgiving',
    nameEn: 'Day after Thanksgiving',
    kind: 'nth_weekday_plus',
    month: 11,
    weekday: 4,
    n: 4,
    plusDays: 1,
  },
  { code: 'christmas', nameFr: 'Noël', nameEn: 'Christmas Day', kind: 'fixed', month: 12, day: 25 },
]

/**
 * Moroccan **fixed-date** national holidays, generated only when the school
 * setting `generate_moroccan_holidays` is on (D6: off by default). Morocco
 * has no "observed" rule: a holiday on a weekend is simply not a school day.
 * Lunar holidays (Aïd al-Fitr, Aïd al-Adha, 1er Moharram, Aïd al-Mawlid) move
 * every year with the moon sighting announced by the Ministry of Habous and
 * are added by hand in the back-office.
 *
 * Verified 2026-10-28 (see docs/STACK_NOTES.md §Holidays):
 * - list of paid public holidays: décret n° 2.04.426 (29 Dec 2004) and the
 *   public-sector décret n° 2.77.169 (1977), as amended;
 * - 14 January (Nouvel An amazigh / Id Yennayer): royal decision of May 2023,
 *   decrees adopted by the Government Council on 23 Nov 2023, first observed
 *   on 14 Jan 2024 — https://telquel.ma/instant-t/2023/08/07/nouvel-an-amazigh-le-14-janvier-desormais-jour-ferie-national-officiellement-remunere_1825156/
 * - 31 October (Fête de l'Unité / Aïd Al Wahda): royal cabinet communiqué of
 *   4 Nov 2025 — https://www.maroc.ma/fr/actualites/sa-majeste-le-roi-decrete-le-31-octobre-fete-de-lunite-communique-du-cabinet-royal
 *   — decree n° 2.26.14 adopted by the Government Council in Jan 2026
 *   (https://telquel.ma/instant-t/2026/01/16/le-conseil-de-gouvernement-adopte-definitivement-le-31-octobre-comme-fete-de-lunite_1970625/),
 *   first observed on 31 Oct 2026;
 * - complete current list cross-checked with https://wafir.ma/fr/guide/calendrier-jours-feries-maroc-2026-2027
 *
 * Rule keys: `ma_<code>_<year>`.
 */
export const MOROCCAN_FIXED_HOLIDAY_RULES: readonly HolidayRule[] = [
  {
    code: 'new_year',
    nameFr: 'Nouvel An',
    nameEn: "New Year's Day",
    kind: 'fixed',
    month: 1,
    day: 1,
  },
  {
    code: 'independence_manifesto',
    nameFr: "Manifeste de l'Indépendance",
    nameEn: 'Independence Manifesto Day',
    kind: 'fixed',
    month: 1,
    day: 11,
  },
  {
    code: 'amazigh_new_year',
    nameFr: 'Nouvel An amazigh (Id Yennayer)',
    nameEn: 'Amazigh New Year (Yennayer)',
    kind: 'fixed',
    month: 1,
    day: 14,
  },
  {
    code: 'labour_day',
    nameFr: 'Fête du Travail',
    nameEn: 'Labour Day',
    kind: 'fixed',
    month: 5,
    day: 1,
  },
  {
    code: 'throne_day',
    nameFr: 'Fête du Trône',
    nameEn: 'Throne Day',
    kind: 'fixed',
    month: 7,
    day: 30,
  },
  {
    code: 'oued_eddahab',
    nameFr: 'Journée de Oued Eddahab',
    nameEn: 'Oued Ed-Dahab Day',
    kind: 'fixed',
    month: 8,
    day: 14,
  },
  {
    code: 'revolution_day',
    nameFr: 'Révolution du Roi et du Peuple',
    nameEn: 'Revolution of the King and the People',
    kind: 'fixed',
    month: 8,
    day: 20,
  },
  {
    code: 'youth_day',
    nameFr: 'Fête de la Jeunesse',
    nameEn: 'Youth Day',
    kind: 'fixed',
    month: 8,
    day: 21,
  },
  {
    code: 'unity_day',
    nameFr: "Fête de l'Unité",
    nameEn: 'Unity Day',
    kind: 'fixed',
    month: 10,
    day: 31,
    // First observed in 2026 (see the source above).
    sinceYear: 2026,
  },
  {
    code: 'green_march',
    nameFr: 'Marche Verte',
    nameEn: 'Green March Day',
    kind: 'fixed',
    month: 11,
    day: 6,
  },
  {
    code: 'independence_day',
    nameFr: "Fête de l'Indépendance",
    nameEn: 'Independence Day',
    kind: 'fixed',
    month: 11,
    day: 18,
  },
]

/** Generated names get this suffix when the observed rule moved the day. */
export const OBSERVED_SUFFIX_FR = '(observé)'

/** Holiday names (manual, imported, generated): 1–120 characters. */
export const HOLIDAY_NAME_MAX_LENGTH = 120

/** A range created by hand can span at most this many calendar days. */
export const HOLIDAY_RANGE_MAX_DAYS = 120

/** List page size (one entry per range or single holiday). */
export const HOLIDAYS_PER_PAGE = 30

/**
 * ICS import (file upload or URL). The file is never trusted: size and event
 * counts are capped before and after parsing, names are sanitized.
 */
export const ICS_IMPORT = {
  /** Uploaded file or downloaded body. */
  maxBytes: 1024 * 1024,
  /** VEVENT components read from one calendar. */
  maxEvents: 1000,
  /** Occurrences produced by expanding one recurring event (expansion stops there). */
  maxOccurrencesPerEvent: 400,
  /** Occurrences node-ical may build for the whole calendar (else the file is refused). */
  maxOccurrencesTotal: 5000,
  /** RRULE screening: highest COUNT, total items of the BY* lists, oldest DTSTART. */
  maxRruleCount: 1000,
  maxRruleListItems: 60,
  maxRruleYearsBack: 5,
  /** Recurring events read per calendar (the others are ignored as invalid). */
  maxRecurringEvents: 100,
  /** Hard CPU budget for recurrence expansion (else the file is refused). */
  maxExpansionMs: 1500,
  /**
   * Every parse runs in a worker thread: killed after this time (worker
   * start-up included) or when its heap exceeds these limits → "too complex".
   */
  workerTimeoutMs: 2000,
  workerMaxOldGenerationMb: 256,
  workerMaxYoungGenerationMb: 32,
  /** Parses at the same time (others get "busy, retry"). */
  maxConcurrentParses: 2,
  /** Holiday rows written by one import (each checked range × its school days). */
  maxImportDays: 5000,
  /** Ranges shown in one preview. */
  maxPreviewRanges: 500,
  /** One all-day event can cover at most this many days (longer = ignored). */
  maxEventDays: 120,
  /** URL import: total time for the download, redirects included. */
  timeoutMs: 10_000,
  /** URL import: redirects followed (each target is re-checked). */
  maxRedirects: 3,
} as const
