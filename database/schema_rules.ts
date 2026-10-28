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
    user_tokens: {
      columns: {
        type: {
          tsType: 'UserTokenType',
          imports: [{ source: '#enums/user_tokens', typeImports: ['UserTokenType'] }],
          decorators: [{ name: '@column' }],
        },
        token_hash: {
          tsType: 'string',
          imports: [],
          decorators: [{ name: '@column', args: { serializeAs: null } }],
        },
        request_ip: {
          tsType: 'string',
          imports: [],
          decorators: [{ name: '@column' }],
        },
      },
    },
    children: {
      columns: {
        allergies: {
          tsType: 'AllergenCode[]',
          imports: [{ source: '#enums/allergens', typeImports: ['AllergenCode'] }],
          decorators: [{ name: '@column' }],
        },
      },
    },
    subscriptions: {
      columns: {
        status: {
          tsType: 'SubscriptionStatus',
          imports: [{ source: '#enums/subscriptions', typeImports: ['SubscriptionStatus'] }],
          decorators: [{ name: '@column' }],
        },
      },
    },
  },
} satisfies SchemaRules
