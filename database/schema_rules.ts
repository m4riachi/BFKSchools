import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

/**
 * Overrides for the generated `database/schema.ts` (docs/STACK_NOTES.md §2):
 * - `date` → 'YYYY-MM-DD' string (pg parser OID 1082), never Luxon;
 * - arrays and jsonb → precise TypeScript types per column;
 * - timestamptz stays Luxon DateTime (Lucid default).
 */
export default {
  types: {
    date: {
      tsType: 'string',
      imports: [],
      decorators: [{ name: '@column' }],
    },
  },
  tables: {
    schools: {
      columns: {
        school_days: {
          tsType: 'number[]',
          imports: [],
          decorators: [{ name: '@column' }],
        },
        settings: {
          tsType: 'StoredSchoolSettings',
          imports: [{ source: '#types/school_settings', typeImports: ['StoredSchoolSettings'] }],
          decorators: [{ name: '@column' }],
        },
      },
    },
    users: {
      columns: {
        role: {
          tsType: 'Role',
          imports: [{ source: '#enums/roles', typeImports: ['Role'] }],
          decorators: [{ name: '@column' }],
        },
        locale: {
          tsType: 'AppLocale',
          imports: [{ source: '#enums/locales', typeImports: ['AppLocale'] }],
          decorators: [{ name: '@column' }],
        },
        notification_prefs: {
          tsType: 'Record<string, boolean>',
          imports: [],
          decorators: [{ name: '@column' }],
        },
      },
    },
  },
} satisfies SchemaRules
