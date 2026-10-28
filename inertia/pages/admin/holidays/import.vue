<script setup lang="ts">
import { computed, ref } from 'vue'
import { useForm } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import FormField from '~/components/ui/form_field.vue'
import TextInput from '~/components/ui/text_input.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import { useI18n } from '~/composables/use_i18n'
import { useImpactConfirm } from '~/composables/use_impact_confirm'

type RangeStatus = 'new' | 'overlap' | 'imported' | 'no_school_day'
type PreviewRange = {
  key: string
  name: string
  startDate: string
  endDate: string
  recurring: boolean
  schoolDays: number
  newDays: number
  status: RangeStatus
  overlaps: string[]
  selected: boolean
}
type Preview = {
  ranges: PreviewRange[]
  ignored: { summary: string; reason: string }[]
  truncated: boolean
}

const props = defineProps<{
  schoolYear: { start: string; end: string; label: string }
  maxBytes: number
  importId: string | null
  preview: Preview | null
}>()

const { t, formatDate } = useI18n()

/* Step 1: file or URL */
const upload = useForm<{ calendar: File | null }>({ calendar: null })
function onFile(event: Event) {
  upload.calendar = (event.target as HTMLInputElement).files?.[0] ?? null
}
function submitUpload() {
  upload.post('/admin/holidays/import', { forceFormData: true })
}
const urlForm = useForm({ url: '' })
function submitUrl() {
  urlForm.post('/admin/holidays/import/url')
}

/* Step 2: choose and import */
const selectable = (range: PreviewRange) =>
  range.status !== 'imported' && range.status !== 'no_school_day'
const confirmForm = useForm({
  ranges: (props.preview?.ranges ?? []).filter((r) => r.selected).map((r) => r.key),
  confirmImpact: false,
})
const impact = useImpactConfirm()
const impactOpen = impact.open
const impactMessage = impact.message

function submitConfirm() {
  if (!props.importId) return
  confirmForm.post(`/admin/holidays/import/${props.importId}/confirm`, {
    preserveScroll: true,
    onError: (errors) =>
      impact.handle(errors, () => {
        confirmForm.confirmImpact = true
        submitConfirm()
      }),
    onFinish: () => (confirmForm.confirmImpact = false),
  })
}

function selectAll(on: boolean) {
  confirmForm.ranges = on ? (props.preview?.ranges ?? []).filter(selectable).map((r) => r.key) : []
}

const statusTone = (status: RangeStatus) =>
  status === 'new' ? 'brand' : status === 'overlap' ? 'warning' : 'neutral'

function datesLabel(range: PreviewRange) {
  if (range.startDate === range.endDate) return formatDate(range.startDate, { dateStyle: 'medium' })
  return t('holidays.form.range', {
    start: formatDate(range.startDate, { dateStyle: 'medium' }),
    end: formatDate(range.endDate, { dateStyle: 'medium' }),
  })
}

const maxKb = computed(() => Math.round(props.maxBytes / 1024))
const showIgnored = ref(false)
</script>

<template>
  <AdminLayout>
    <div>
      <Link href="/admin/holidays" class="text-[13px] font-semibold"
        >← {{ t('holidays.import.back') }}</Link
      >
    </div>
    <PageHeader :title="t('holidays.import.title')" :eyebrow="t('holidays.import.eyebrow')" />

    <!-- Step 1 -->
    <section v-if="!preview" class="card flex max-w-3xl flex-col gap-5 p-5 sm:p-6">
      <p class="text-sm leading-relaxed text-ink-3">
        {{ t('holidays.import.instructions', { label: schoolYear.label }) }}
      </p>

      <form class="flex flex-col gap-4" novalidate @submit.prevent="submitUpload">
        <FormField
          id="calendar"
          :label="t('holidays.import.file')"
          :error="upload.errors.calendar"
          :hint="t('holidays.import.max_size', { size: maxKb })"
          required
        >
          <input
            id="calendar"
            type="file"
            name="calendar"
            accept=".ics,text/calendar"
            class="block w-full rounded-xl border border-line-input bg-surface p-3 text-sm file:mr-3 file:rounded-[10px] file:border-0 file:bg-brand-soft file:px-3 file:py-2 file:font-bold file:text-brand-strong"
            :aria-invalid="upload.errors.calendar ? 'true' : 'false'"
            :aria-describedby="upload.errors.calendar ? 'calendar-error' : undefined"
            @change="onFile"
          />
        </FormField>
        <div>
          <AppButton type="submit" :loading="upload.processing" :disabled="!upload.calendar">
            {{ upload.processing ? t('holidays.import.uploading') : t('holidays.import.upload') }}
          </AppButton>
        </div>
      </form>

      <hr class="border-line" />

      <form class="flex flex-col gap-4" novalidate @submit.prevent="submitUrl">
        <h2 class="text-sm font-extrabold">{{ t('holidays.import.or_url') }}</h2>
        <TextInput
          id="url"
          v-model="urlForm.url"
          type="url"
          :label="t('holidays.import.url')"
          placeholder="https://"
          :hint="t('holidays.import.url_hint')"
          :error="urlForm.errors.url"
        />
        <div>
          <AppButton
            type="submit"
            variant="secondary"
            :loading="urlForm.processing"
            :disabled="!urlForm.url"
          >
            {{ t('holidays.import.fetch') }}
          </AppButton>
        </div>
      </form>
    </section>

    <!-- Step 2 -->
    <section v-if="preview" class="card flex flex-col gap-4 p-5 sm:p-6">
      <div class="flex flex-col gap-1">
        <h2 class="text-base font-extrabold">{{ t('holidays.import.preview_title') }}</h2>
        <p class="text-sm text-ink-3">{{ t('holidays.import.preview_body') }}</p>
      </div>

      <p
        v-if="preview.truncated"
        role="alert"
        class="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm font-semibold text-warning-ink"
      >
        {{ t('holidays.import.truncated') }}
      </p>

      <p v-if="preview.ranges.length === 0" class="text-sm text-ink-4">
        {{ t('holidays.import.empty') }}
      </p>

      <template v-else>
        <div class="flex gap-2">
          <AppButton size="sm" variant="ghost" @click="selectAll(true)">
            {{ t('holidays.import.select_all') }}
          </AppButton>
          <AppButton size="sm" variant="ghost" @click="selectAll(false)">
            {{ t('holidays.import.select_none') }}
          </AppButton>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr
                class="border-b border-line text-left text-xs font-bold tracking-[0.04em] text-ink-4 uppercase"
              >
                <th scope="col" class="w-10 px-3 py-2.5"><span class="sr-only">✓</span></th>
                <th scope="col" class="px-3 py-2.5">{{ t('holidays.import.columns.name') }}</th>
                <th scope="col" class="px-3 py-2.5">{{ t('holidays.import.columns.dates') }}</th>
                <th scope="col" class="px-3 py-2.5">{{ t('holidays.import.columns.days') }}</th>
                <th scope="col" class="px-3 py-2.5">{{ t('holidays.import.columns.status') }}</th>
              </tr>
            </thead>
            <tbody class="tabular">
              <tr
                v-for="range in preview.ranges"
                :key="range.key"
                class="border-b border-line-soft last:border-b-0"
              >
                <td class="px-3 py-3">
                  <input
                    v-model="confirmForm.ranges"
                    type="checkbox"
                    class="size-5 accent-brand"
                    :value="range.key"
                    :disabled="!selectable(range)"
                    :aria-label="range.name"
                  />
                </td>
                <td class="px-3 py-3">
                  <span class="font-bold">{{ range.name }}</span>
                  <StatusBadge v-if="range.recurring" class="ml-2">{{
                    t('holidays.import.recurring')
                  }}</StatusBadge>
                </td>
                <td class="px-3 py-3 whitespace-nowrap">{{ datesLabel(range) }}</td>
                <td class="px-3 py-3">
                  {{ range.schoolDays }}
                  <span
                    v-if="range.newDays !== range.schoolDays && range.newDays > 0"
                    class="text-xs text-ink-4"
                  >
                    ({{ t('holidays.import.new_days', { count: range.newDays }) }})
                  </span>
                </td>
                <td class="px-3 py-3">
                  <StatusBadge :tone="statusTone(range.status)">
                    {{
                      t(`holidays.import.status.${range.status}`, {
                        names: range.overlaps.join(', '),
                      })
                    }}
                  </StatusBadge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="confirmForm.errors.ranges" class="text-sm font-semibold text-danger">
          {{ confirmForm.errors.ranges }}
        </p>
      </template>

      <div v-if="preview.ignored.length" class="flex flex-col gap-2">
        <button
          type="button"
          class="self-start text-[13px] font-bold text-brand-strong"
          @click="showIgnored = !showIgnored"
        >
          {{ t('holidays.import.ignored_title') }} ({{ preview.ignored.length }})
        </button>
        <ul v-if="showIgnored" class="list-disc pl-5 text-[13px] text-ink-3">
          <li v-for="(item, index) in preview.ignored" :key="index">
            <strong>{{ item.summary || t('holidays.import.untitled') }}</strong> —
            {{ t(`holidays.import.ignored.${item.reason}`) }}
          </li>
        </ul>
      </div>

      <div class="flex flex-wrap gap-2.5 pt-2">
        <AppButton
          :loading="confirmForm.processing"
          :disabled="confirmForm.ranges.length === 0"
          @click="submitConfirm"
        >
          {{ t('holidays.import.confirm', { count: confirmForm.ranges.length }) }}
        </AppButton>
        <AppButton variant="secondary" href="/admin/holidays/import">{{
          t('holidays.import.restart')
        }}</AppButton>
      </div>
    </section>

    <ConfirmDialog
      v-model:open="impactOpen"
      :title="t('holidays.impact.title')"
      :message="impactMessage"
      :confirm-label="t('holidays.impact.confirm_button')"
      danger
      @confirm="impact.confirm"
    />
  </AdminLayout>
</template>
