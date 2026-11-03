<script setup lang="ts">
/**
 * D55: a meal's fiche technique. Pick ingredients from the kitchen catalog
 * (searchable) and tick which ones parents see when ordering. The order of
 * the list is kept. The server stores only known ingredient ids.
 */
import { ref } from 'vue'
import { router, useForm } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import TextInput from '~/components/ui/text_input.vue'
import AppButton from '~/components/ui/app_button.vue'
import { useI18n } from '~/composables/use_i18n'

type FicheLine = {
  ingredientId: number
  code: string
  label: string
  famille: string | null
  customerVisible: boolean
}

const props = defineProps<{ meal: { id: number; name: string }; fiche: FicheLine[] }>()

const { t } = useI18n()

const lines = ref<FicheLine[]>(props.fiche.map((line) => ({ ...line })))
const dirty = ref(false)
function touched() {
  dirty.value = true
}

/* Search (autocomplete) */
const query = ref('')
const results = ref<FicheLine[]>([])
const searching = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
function onSearch() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runSearch, 200)
}
async function runSearch() {
  searching.value = true
  try {
    const response = await fetch(`/admin/ingredients?q=${encodeURIComponent(query.value)}`, {
      headers: { Accept: 'application/json' },
    })
    const data = (await response.json()) as { results: FicheLine[] }
    const have = new Set(lines.value.map((line) => line.ingredientId))
    results.value = data.results.filter((item) => !have.has(item.ingredientId))
  } catch {
    results.value = []
  } finally {
    searching.value = false
  }
}
function add(item: FicheLine) {
  lines.value.push({ ...item, customerVisible: true })
  results.value = results.value.filter((r) => r.ingredientId !== item.ingredientId)
  touched()
}
function remove(index: number) {
  lines.value.splice(index, 1)
  touched()
}
function toggleVisible(line: FicheLine, event: Event) {
  line.customerVisible = (event.target as HTMLInputElement).checked
  touched()
}
function move(index: number, delta: -1 | 1) {
  const to = index + delta
  if (to < 0 || to >= lines.value.length) return
  const [item] = lines.value.splice(index, 1)
  lines.value.splice(to, 0, item)
  touched()
}

const saving = ref(false)
function save() {
  router.put(
    `/admin/meals/${props.meal.id}/ingredients`,
    {
      ingredients: lines.value.map((l) => ({
        ingredientId: l.ingredientId,
        customerVisible: l.customerVisible,
      })),
    },
    {
      preserveScroll: true,
      onStart: () => (saving.value = true),
      onFinish: () => {
        saving.value = false
        dirty.value = false
      },
    }
  )
}

// Unused in template but kept for parity with other forms.
void useForm
</script>

<template>
  <AdminLayout>
    <div class="flex flex-col gap-1">
      <Link :href="`/admin/meals/${meal.id}/edit`" class="text-[13px] font-semibold">
        ‹ {{ t('meals.fiche.back') }}
      </Link>
      <PageHeader :title="t('meals.fiche.title', { name: meal.name })">
        <template #actions>
          <AppButton :loading="saving" :disabled="!dirty" @click="save">
            {{ t('meals.fiche.save') }}
          </AppButton>
        </template>
      </PageHeader>
    </div>

    <p class="text-sm text-ink-3">{{ t('meals.fiche.intro') }}</p>

    <!-- Add an ingredient -->
    <section class="card flex flex-col gap-3 p-5">
      <h2 class="text-sm font-bold">{{ t('meals.fiche.add_title') }}</h2>
      <TextInput
        id="ingredient_search"
        v-model="query"
        :placeholder="t('meals.fiche.search_placeholder')"
        autocomplete="off"
        @update:model-value="onSearch"
      />
      <ul
        v-if="results.length"
        class="m-0 flex max-h-72 list-none flex-col gap-1 overflow-auto p-0"
      >
        <li v-for="item in results" :key="item.ingredientId">
          <button
            type="button"
            class="flex w-full items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-subtle"
            @click="add(item)"
          >
            <span class="min-w-0">
              <span class="font-semibold">{{ item.label }}</span>
              <span v-if="item.famille" class="ml-2 text-xs text-ink-4">{{ item.famille }}</span>
            </span>
            <span class="shrink-0 text-xs font-bold text-brand-strong"
              >+ {{ t('meals.fiche.add') }}</span
            >
          </button>
        </li>
      </ul>
      <p v-else-if="query && !searching" class="text-[13px] text-ink-4">
        {{ t('meals.fiche.no_result') }}
      </p>
    </section>

    <!-- The fiche technique -->
    <section class="card flex flex-col gap-3 p-5">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-bold">{{ t('meals.fiche.list_title') }}</h2>
        <span class="text-xs text-ink-4">{{ t('meals.fiche.visible_legend') }}</span>
      </div>
      <p v-if="!lines.length" class="text-[13px] text-ink-4">{{ t('meals.fiche.empty') }}</p>
      <ul v-else class="m-0 flex list-none flex-col gap-2 p-0">
        <li
          v-for="(line, index) in lines"
          :key="line.ingredientId"
          class="flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5"
        >
          <span class="flex shrink-0 flex-col text-ink-4">
            <button
              type="button"
              class="flex size-5 items-center justify-center rounded hover:bg-subtle disabled:opacity-30"
              :disabled="index === 0"
              :aria-label="t('meals.fiche.move_up')"
              @click="move(index, -1)"
            >
              ▲
            </button>
            <button
              type="button"
              class="flex size-5 items-center justify-center rounded hover:bg-subtle disabled:opacity-30"
              :disabled="index === lines.length - 1"
              :aria-label="t('meals.fiche.move_down')"
              @click="move(index, 1)"
            >
              ▼
            </button>
          </span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-sm font-semibold">{{ line.label }}</span>
            <span class="text-xs text-ink-4"
              >{{ line.code }}<template v-if="line.famille"> · {{ line.famille }}</template></span
            >
          </span>
          <label class="flex shrink-0 items-center gap-2 text-[13px] font-semibold">
            <input
              type="checkbox"
              class="size-4"
              :checked="line.customerVisible"
              @change="toggleVisible(line, $event)"
            />
            {{ t('meals.fiche.visible') }}
          </label>
          <button
            type="button"
            class="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-4 hover:bg-subtle"
            :aria-label="t('meals.fiche.remove', { name: line.label })"
            @click="remove(index)"
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
        </li>
      </ul>
    </section>
  </AdminLayout>
</template>
