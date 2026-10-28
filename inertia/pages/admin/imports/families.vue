<script setup lang="ts">
import { computed } from 'vue'
import { useForm } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import CheckboxField from '~/components/ui/checkbox_field.vue'
import FormField from '~/components/ui/form_field.vue'
import { useI18n } from '~/composables/use_i18n'

type Action = 'create' | 'update' | 'unchanged' | 'none'
type PreviewRow = {
  line: number
  parentName: string
  email: string
  childName: string
  grade: string | null
  className: string | null
  allergies: string[]
  subscription: { start: string; end: string | null } | null
  parentAction: Action
  childAction: Action
  subscriptionAction: Action
  errors: string[]
}
type Plan = {
  fileErrors: string[]
  rows: PreviewRow[]
  summary: {
    rows: number
    invalidRows: number
    newParents: number
    updatedParents: number
    newChildren: number
    updatedChildren: number
    newSubscriptions: number
  }
  valid: boolean
}

const props = defineProps<{
  importId: string | null
  plan: Plan | null
  columns: string[]
  allergens: string[]
  maxRows: number
}>()

const { t } = useI18n()

/* Step 1: upload */
const upload = useForm<{ file: File | null }>({ file: null })
function onFile(event: Event) {
  upload.file = (event.target as HTMLInputElement).files?.[0] ?? null
}
function submitUpload() {
  upload.post('/admin/imports/families', { forceFormData: true })
}

/* Step 2: confirm */
const confirmForm = useForm({ sendInvitations: true })
function submitConfirm() {
  if (!props.importId) return
  confirmForm.post(`/admin/imports/families/${props.importId}/confirm`)
}

const hasChanges = computed(() => {
  const s = props.plan?.summary
  return Boolean(
    s &&
    s.newParents + s.updatedParents + s.newChildren + s.updatedChildren + s.newSubscriptions > 0
  )
})

const summaryItems = computed(() => {
  const s = props.plan?.summary
  if (!s) return []
  return [
    { key: 'rows', value: s.rows },
    { key: 'invalid', value: s.invalidRows, danger: s.invalidRows > 0 },
    { key: 'new_parents', value: s.newParents },
    { key: 'updated_parents', value: s.updatedParents },
    { key: 'new_children', value: s.newChildren },
    { key: 'updated_children', value: s.updatedChildren },
    { key: 'new_subscriptions', value: s.newSubscriptions },
  ]
})

const actionTone = (action: Action) =>
  action === 'create' ? 'brand' : action === 'update' ? 'info' : 'neutral'
</script>

<template>
  <AdminLayout>
    <div>
      <Link href="/admin/parents" class="text-[13px] font-semibold">
        ← {{ t('families.import.back') }}
      </Link>
    </div>
    <PageHeader :title="t('families.import.title')" :eyebrow="t('families.import.eyebrow')" />

    <!-- Step 1 -->
    <section v-if="!plan" class="card flex max-w-3xl flex-col gap-5 p-5 sm:p-6">
      <h2 class="text-base font-extrabold">{{ t('families.import.step_upload') }}</h2>
      <p class="text-sm leading-relaxed text-ink-3">{{ t('families.import.instructions') }}</p>

      <div class="flex flex-col gap-2 rounded-xl bg-subtle p-4 text-[13px] text-ink-2">
        <span class="font-bold">{{ t('families.import.columns') }}</span>
        <code class="text-xs leading-relaxed break-words text-ink">{{ columns.join(', ') }}</code>
        <span>{{ t('families.import.required_columns') }}</span>
        <span>{{ t('families.import.date_format') }}</span>
        <span>
          {{ t('families.import.allergen_codes') }}
          <code class="text-xs text-ink">{{ allergens.join(', ') }}</code>
        </span>
        <span>{{ t('families.import.allergies_note') }}</span>
        <span>{{ t('families.import.max_rows', { max: maxRows }) }}</span>
      </div>

      <div>
        <a href="/admin/imports/families/template" class="text-sm font-bold" download>
          {{ t('families.import.template') }}
        </a>
      </div>

      <form class="flex flex-col gap-4" novalidate @submit.prevent="submitUpload">
        <FormField
          id="file"
          :label="t('families.import.file')"
          :error="upload.errors.file"
          required
        >
          <input
            id="file"
            type="file"
            name="file"
            accept=".csv,text/csv"
            class="block w-full rounded-xl border border-line-input bg-surface p-3 text-sm file:mr-3 file:rounded-[10px] file:border-0 file:bg-brand-soft file:px-3 file:py-2 file:font-bold file:text-brand-strong"
            :aria-invalid="upload.errors.file ? 'true' : 'false'"
            :aria-describedby="upload.errors.file ? 'file-error' : undefined"
            @change="onFile"
          />
        </FormField>
        <div>
          <AppButton type="submit" :loading="upload.processing" :disabled="!upload.file">
            {{ upload.processing ? t('families.import.uploading') : t('families.import.upload') }}
          </AppButton>
        </div>
      </form>
    </section>

    <!-- Step 2 -->
    <template v-else>
      <section class="card flex flex-col gap-4 p-5 sm:p-6">
        <div class="flex flex-col gap-1">
          <h2 class="text-base font-extrabold">{{ t('families.import.preview_title') }}</h2>
          <p class="text-sm text-ink-3">{{ t('families.import.preview_body') }}</p>
        </div>

        <div
          v-if="plan.fileErrors.length"
          role="alert"
          class="flex flex-col gap-1 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-ink"
        >
          <strong>{{ t('families.import.file_errors') }}</strong>
          <ul class="list-disc pl-5">
            <li v-for="error in plan.fileErrors" :key="error">{{ error }}</li>
          </ul>
        </div>

        <dl v-else class="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          <div
            v-for="item in summaryItems"
            :key="item.key"
            class="flex flex-col gap-1 rounded-xl border border-line p-3"
            :class="{ 'border-danger-line bg-danger-soft': item.danger }"
          >
            <dt class="text-xs font-semibold text-ink-4">
              {{ t(`families.import.summary.${item.key}`) }}
            </dt>
            <dd
              class="text-2xl font-extrabold tabular"
              :class="item.danger ? 'text-danger' : 'text-ink'"
            >
              {{ item.value }}
            </dd>
          </div>
        </dl>

        <p
          v-if="!plan.fileErrors.length && plan.summary.invalidRows > 0"
          role="alert"
          class="rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm font-semibold text-danger-ink"
        >
          {{ t('families.import.has_errors') }}
        </p>
      </section>

      <section v-if="plan.rows.length" class="card overflow-x-auto p-2 sm:p-3">
        <table class="w-full border-collapse text-sm">
          <caption class="sr-only">
            {{
              t('families.import.table_caption')
            }}
          </caption>
          <thead>
            <tr class="border-b border-line">
              <th
                v-for="key in [
                  'line',
                  'parent',
                  'child',
                  'class',
                  'allergies',
                  'subscription',
                  'changes',
                ]"
                :key="key"
                scope="col"
                class="px-3 py-2.5 text-left text-xs font-bold tracking-[0.04em] whitespace-nowrap text-ink-4 uppercase"
              >
                {{ t(`families.import.table.${key}`) }}
              </th>
            </tr>
          </thead>
          <tbody class="tabular">
            <tr
              v-for="row in plan.rows"
              :key="row.line"
              class="border-b border-line-soft align-top last:border-b-0"
              :class="{ 'bg-danger-soft/60': row.errors.length }"
            >
              <td class="p-3 font-bold text-ink-4">{{ row.line }}</td>
              <td class="p-3">
                <div class="flex min-w-[180px] flex-col">
                  <span class="font-semibold">{{ row.parentName || '—' }}</span>
                  <span class="text-[13px] break-all text-ink-4">{{ row.email || '—' }}</span>
                </div>
              </td>
              <td class="p-3 font-semibold whitespace-nowrap">{{ row.childName || '—' }}</td>
              <td class="p-3 whitespace-nowrap text-ink-3">
                {{ [row.grade, row.className].filter(Boolean).join(' · ') || '—' }}
              </td>
              <td class="p-3">
                <div class="flex min-w-[120px] flex-wrap gap-1">
                  <StatusBadge v-for="code in row.allergies" :key="code" tone="danger">
                    {{ t(`allergens.${code}`) }}
                  </StatusBadge>
                  <span v-if="!row.allergies.length" class="text-ink-4">—</span>
                </div>
              </td>
              <td class="p-3 whitespace-nowrap text-ink-3">
                <template v-if="row.subscription">
                  {{ row.subscription.start }} → {{ row.subscription.end ?? '…' }}
                </template>
                <template v-else>—</template>
              </td>
              <td class="p-3">
                <ul
                  v-if="row.errors.length"
                  class="flex min-w-[240px] flex-col gap-1 text-[13px] font-semibold text-danger"
                >
                  <li v-for="error in row.errors" :key="error">{{ error }}</li>
                </ul>
                <div v-else class="flex min-w-[160px] flex-col gap-1">
                  <StatusBadge
                    v-if="row.parentAction !== 'none'"
                    :tone="actionTone(row.parentAction)"
                  >
                    {{
                      t('families.import.parent_label', {
                        action: t(`families.import.action.${row.parentAction}`),
                      })
                    }}
                  </StatusBadge>
                  <StatusBadge :tone="actionTone(row.childAction)">
                    {{
                      t('families.import.child_label', {
                        action: t(`families.import.action.${row.childAction}`),
                      })
                    }}
                  </StatusBadge>
                  <StatusBadge
                    v-if="row.subscriptionAction !== 'none'"
                    :tone="actionTone(row.subscriptionAction)"
                  >
                    {{
                      t('families.import.subscription_label', {
                        action: t(`families.import.action.${row.subscriptionAction}`),
                      })
                    }}
                  </StatusBadge>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card flex flex-col gap-4 p-5 sm:p-6">
        <h2 class="text-base font-extrabold">{{ t('families.import.step_preview') }}</h2>
        <template v-if="plan.valid">
          <p v-if="!hasChanges" class="text-sm text-ink-3">
            {{ t('families.import.nothing_to_do') }}
          </p>
          <CheckboxField
            v-if="plan.summary.newParents > 0"
            id="sendInvitations"
            v-model="confirmForm.sendInvitations"
            :label="t('families.import.send_invitations')"
            :hint="t('families.import.send_invitations_hint', { count: plan.summary.newParents })"
          />
        </template>
        <div class="flex flex-wrap gap-2.5">
          <AppButton
            v-if="plan.valid && hasChanges"
            :loading="confirmForm.processing"
            @click="submitConfirm"
          >
            {{
              confirmForm.processing
                ? t('families.import.confirming')
                : t('families.import.confirm')
            }}
          </AppButton>
          <AppButton variant="secondary" href="/admin/imports/families">
            {{ t('families.import.another_file') }}
          </AppButton>
        </div>
      </section>
    </template>
  </AdminLayout>
</template>
