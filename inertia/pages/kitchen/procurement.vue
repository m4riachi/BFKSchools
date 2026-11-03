<script setup lang="ts">
/**
 * D56: économat / bon de commande. The day's purchase list is computed from
 * the orders (provisional) or loaded from the saved order; the kitchen edits
 * quantities, removes or adds articles (existing or brand-new), then confirms
 * it and downloads the bon de commande PDF.
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import KitchenLayout from '~/layouts/kitchen_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import DayNav from '~/components/reports/day_nav.vue'
import TextInput from '~/components/ui/text_input.vue'
import { useI18n } from '~/composables/use_i18n'
import type { DayNav as DayNavType } from '~/components/reports/types'

type Line = {
  ingredientId: number | null
  label: string
  icon: string
  unit: string | null
  quantity: number
}
type Order = {
  date: string
  reference: string
  note: string | null
  saved: boolean
  confirmedAt: string | null
  lines: Line[]
}

const props = defineProps<{
  date: string
  today: string
  previous: string
  next: string
  order: Order | null
}>()

const { t } = useI18n()
const nav: DayNavType = {
  date: props.date,
  today: props.today,
  previous: props.previous,
  next: props.next,
}

const lines = ref<Line[]>((props.order?.lines ?? []).map((l) => ({ ...l })))
const note = ref(props.order?.note ?? '')
const saving = ref(false)

function removeLine(index: number) {
  lines.value.splice(index, 1)
}

/* Add an existing article (search) */
const query = ref('')
const results = ref<{ id: number; label: string; icon: string; unit: string | null }[]>([])
let timer: ReturnType<typeof setTimeout> | undefined
function onSearch() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runSearch, 200)
}
async function runSearch() {
  if (!query.value.trim()) {
    results.value = []
    return
  }
  try {
    const res = await fetch(
      `/kitchen/procurement/ingredients?q=${encodeURIComponent(query.value)}`,
      {
        headers: { Accept: 'application/json' },
      }
    )
    const data = (await res.json()) as {
      results: { id: number; label: string; icon: string; unit: string | null }[]
    }
    const have = new Set(lines.value.map((l) => l.ingredientId))
    results.value = data.results.filter((r) => !have.has(r.id))
  } catch {
    results.value = []
  }
}
function addExisting(item: { id: number; label: string; icon: string; unit: string | null }) {
  lines.value.push({
    ingredientId: item.id,
    label: item.label,
    icon: item.icon,
    unit: item.unit,
    quantity: 0,
  })
  query.value = ''
  results.value = []
}

function xsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

/* Add a brand-new article (not in the catalog) */
const newLabel = ref('')
const newUnit = ref('')
const addingNew = ref(false)
async function addNew() {
  if (!newLabel.value.trim()) return
  addingNew.value = true
  try {
    const res = await fetch('/kitchen/procurement/ingredients', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-XSRF-TOKEN': xsrfToken(),
      },
      body: JSON.stringify({ label: newLabel.value, unit: newUnit.value || null }),
    })
    const data = (await res.json()) as {
      ingredient: { id: number; label: string; icon: string; unit: string | null }
    }
    lines.value.push({
      ingredientId: data.ingredient.id,
      label: data.ingredient.label,
      icon: data.ingredient.icon,
      unit: data.ingredient.unit,
      quantity: 0,
    })
    newLabel.value = ''
    newUnit.value = ''
  } catch {
    // ignored: the kitchen can retry
  } finally {
    addingNew.value = false
  }
}

function confirm() {
  router.post(
    '/kitchen/procurement/confirm',
    {
      date: props.date,
      note: note.value || null,
      lines: lines.value
        .filter((l) => Number(l.quantity) > 0 && l.label.trim())
        .map((l) => ({
          ingredientId: l.ingredientId,
          label: l.label,
          unit: l.unit,
          quantity: Number(l.quantity) || 0,
        })),
    },
    {
      preserveScroll: true,
      onStart: () => (saving.value = true),
      onFinish: () => (saving.value = false),
    }
  )
}
</script>

<template>
  <KitchenLayout>
    <PageHeader :title="t('procurement.title')" :eyebrow="order?.reference ?? ''">
      <template #actions>
        <DayNav path="/kitchen/procurement" :nav="nav" :printable="false">
          <!-- A plain <a>, not an Inertia link: a file download must be a real browser navigation -->
          <a
            v-if="order?.saved"
            :href="`/kitchen/procurement/download?date=${date}`"
            class="inline-flex h-11 items-center justify-center rounded-xl border border-line-strong bg-surface px-[18px] text-sm font-semibold text-ink no-underline hover:bg-subtle hover:text-ink"
          >
            {{ t('procurement.download') }}
          </a>
          <AppButton v-else variant="secondary" :disabled="true">
            {{ t('procurement.download') }}
          </AppButton>
          <AppButton :loading="saving" @click="confirm">{{ t('procurement.confirm') }}</AppButton>
        </DayNav>
      </template>
    </PageHeader>

    <section v-if="!order" class="card">
      <EmptyState
        :title="t('reports.common.no_school_title')"
        :description="t('reports.common.no_school_body')"
      />
    </section>

    <template v-else>
      <p class="text-sm text-ink-3">
        {{ order.saved ? t('procurement.saved_hint') : t('procurement.provisional_hint') }}
      </p>

      <!-- The purchase list -->
      <section class="card overflow-hidden">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr
              class="border-b border-line text-left text-xs tracking-[0.05em] text-ink-4 uppercase"
            >
              <th class="px-4 py-2.5 font-bold">{{ t('procurement.pdf.article') }}</th>
              <th class="w-40 px-4 py-2.5 text-right font-bold">
                {{ t('procurement.pdf.quantity') }}
              </th>
              <th class="w-28 px-4 py-2.5 font-bold">{{ t('procurement.pdf.unit') }}</th>
              <th class="w-12 px-2 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, index) in lines" :key="index" class="border-b border-line/60">
              <td class="px-4 py-2 font-semibold">
                <span aria-hidden="true">{{ line.icon }}</span> {{ line.label }}
              </td>
              <td class="px-4 py-2 text-right">
                <input
                  v-model.number="line.quantity"
                  type="number"
                  min="0"
                  step="0.001"
                  class="h-9 w-28 rounded-lg border border-line px-2 text-right tabular"
                />
              </td>
              <td class="px-4 py-2 text-ink-3">{{ line.unit || '—' }}</td>
              <td class="px-2 py-2 text-center">
                <button
                  type="button"
                  class="flex size-8 items-center justify-center rounded-lg text-ink-4 hover:bg-subtle"
                  :aria-label="t('procurement.remove', { name: line.label })"
                  @click="removeLine(index)"
                >
                  <svg
                    class="size-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </td>
            </tr>
            <tr v-if="!lines.length">
              <td colspan="4" class="px-4 py-6 text-center text-ink-4">
                {{ t('procurement.empty') }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Add articles -->
      <div class="grid gap-3 md:grid-cols-2">
        <section class="card flex flex-col gap-2 p-4">
          <h2 class="text-sm font-bold">{{ t('procurement.add_existing') }}</h2>
          <TextInput
            id="article_search"
            v-model="query"
            :placeholder="t('procurement.search_placeholder')"
            autocomplete="off"
            @update:model-value="onSearch"
          />
          <ul
            v-if="results.length"
            class="m-0 flex max-h-56 list-none flex-col gap-1 overflow-auto p-0"
          >
            <li v-for="item in results" :key="item.id">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-subtle"
                @click="addExisting(item)"
              >
                <span class="font-semibold"
                  ><span aria-hidden="true">{{ item.icon }}</span> {{ item.label }}</span
                >
                <span class="text-xs text-ink-4">{{ item.unit || '—' }}</span>
              </button>
            </li>
          </ul>
        </section>

        <section class="card flex flex-col gap-2 p-4">
          <h2 class="text-sm font-bold">{{ t('procurement.add_new') }}</h2>
          <p class="text-xs text-ink-4">{{ t('procurement.add_new_hint') }}</p>
          <div class="flex flex-wrap items-end gap-2">
            <TextInput
              id="new_label"
              v-model="newLabel"
              :label="t('procurement.new_label')"
              class="min-w-40 flex-1"
            />
            <TextInput
              id="new_unit"
              v-model="newUnit"
              :label="t('procurement.new_unit')"
              class="w-28"
            />
            <AppButton
              variant="secondary"
              :loading="addingNew"
              :disabled="!newLabel.trim()"
              @click="addNew"
            >
              {{ t('procurement.add') }}
            </AppButton>
          </div>
        </section>
      </div>

      <!-- Note -->
      <section class="card flex flex-col gap-2 p-4">
        <label for="po_note" class="text-sm font-bold">{{ t('procurement.note') }}</label>
        <textarea
          id="po_note"
          v-model="note"
          rows="2"
          class="w-full rounded-xl border border-line p-2.5 text-sm"
          :placeholder="t('procurement.note_placeholder')"
        ></textarea>
      </section>
    </template>
  </KitchenLayout>
</template>
