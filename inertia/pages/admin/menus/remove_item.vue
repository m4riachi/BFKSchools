<script setup lang="ts">
/**
 * Removing a meal from a published menu (D18, Phase 6 impact flow): lists
 * the active orders that contain it, then switches them to another meal of
 * the same day or removes the line (empty orders are cancelled). The server
 * re-checks everything (capacity, allergies) and notifies the parents.
 */
import { computed, ref } from 'vue'
import { Head, router, usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import { useI18n } from '~/composables/use_i18n'
import { useFeatures, usePlacement } from '~/composables/use_features'

const props = defineProps<{
  week: string
  menuStatus: string
  isPast: boolean
  item: {
    id: number
    date: string
    type: string
    isDefault: boolean
    meal: { name: string; price: string | null }
  }
  affected: {
    orderId: number
    childName: string
    className: string | null
    grade: string | null
    parentName: string
    quantity: number
    allergies: { code: string; label: string }[]
  }[]
  alternatives: {
    id: number
    name: string
    price: string | null
    maxQuantity: number | null
    allergicChildren: number
  }[]
}>()

const { t, formatDate } = useI18n()
const features = useFeatures()
const placement = usePlacement()
const page = usePage()
const mode = ref<'switch' | 'cancel'>(props.alternatives.length ? 'switch' : 'cancel')
const target = ref<number | null>(props.alternatives[0]?.id ?? null)
const processing = ref(false)
const chosen = computed(() => props.alternatives.find((a) => a.id === target.value) ?? null)
const day = computed(() =>
  formatDate(props.item.date, { weekday: 'long', day: 'numeric', month: 'long' })
)

function submit() {
  const data: Record<string, any> = props.affected.length
    ? mode.value === 'switch'
      ? { mode: 'switch', targetItemId: target.value, confirmedCount: props.affected.length }
      : { mode: 'cancel', confirmedCount: props.affected.length }
    : {}
  router.delete(`/admin/menus/${props.week}/items/${props.item.id}`, {
    data,
    onStart: () => (processing.value = true),
    onFinish: () => (processing.value = false),
  })
}
</script>

<template>
  <AdminLayout>
    <Head :title="t('menus.remove.title')" />
    <PageHeader :title="t('menus.remove.title')" />
    <Link :href="`/admin/menus/${week}`" class="text-sm font-bold"
      >← {{ t('menus.remove.back') }}</Link
    >

    <p class="text-sm text-ink-2">{{ t('menus.remove.intro', { meal: item.meal.name, day }) }}</p>
    <p v-if="isPast" class="rounded-xl bg-danger-soft px-4 py-3 text-sm font-bold text-danger">
      {{ t('menus.remove.past') }}
    </p>

    <section class="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <h2 class="text-base font-extrabold">
        {{ t('menus.remove.affected', { count: affected.length }) }}
      </h2>
      <div v-if="affected.length" class="overflow-x-auto">
        <table class="w-full min-w-[560px] text-left text-sm">
          <thead class="text-xs font-bold text-ink-4 uppercase">
            <tr class="border-b border-line">
              <th class="py-2 pr-3">{{ t('menus.remove.child') }}</th>
              <th v-if="features.grade || features.className" class="py-2 pr-3">
                {{ t('menus.remove.class') }}
              </th>
              <th class="py-2 pr-3">{{ t('menus.remove.parent') }}</th>
              <th class="py-2 pr-3">{{ t('menus.remove.quantity') }}</th>
              <th v-if="features.allergens" class="py-2">{{ t('menus.remove.allergies') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in affected"
              :key="row.orderId"
              class="border-b border-line-soft last:border-0"
            >
              <td class="py-2 pr-3 font-bold">{{ row.childName }}</td>
              <td v-if="features.grade || features.className" class="py-2 pr-3">
                {{ placement(row.grade, row.className) }}
              </td>
              <td class="py-2 pr-3">{{ row.parentName }}</td>
              <td class="tabular py-2 pr-3">{{ row.quantity }}</td>
              <td v-if="features.allergens" class="py-2 text-danger">
                {{ row.allergies.map((a) => a.label).join(', ') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section
      v-if="affected.length && !isPast"
      class="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
    >
      <h2 class="text-base font-extrabold">{{ t('menus.remove.how') }}</h2>
      <label
        class="flex items-start gap-3 text-sm"
        :class="alternatives.length ? '' : 'opacity-60'"
      >
        <input
          v-model="mode"
          type="radio"
          value="switch"
          class="mt-0.5 size-5 accent-brand"
          :disabled="!alternatives.length"
        />
        <span class="flex flex-col gap-2">
          <span class="font-bold">{{ t('menus.remove.switch') }}</span>
          <select
            v-if="alternatives.length"
            v-model="target"
            class="min-h-10 rounded-lg border border-line-input bg-surface px-3"
            :disabled="mode !== 'switch'"
          >
            <option v-for="option in alternatives" :key="option.id" :value="option.id">
              {{ option.name }}<template v-if="option.price"> — {{ option.price }}</template>
            </option>
          </select>
          <span v-else class="text-ink-3">{{ t('menus.remove.no_alternative') }}</span>
          <span v-if="chosen && chosen.allergicChildren" class="font-bold text-warning">
            {{ t('menus.remove.switch_allergy', { count: chosen.allergicChildren }) }}
          </span>
          <span v-if="page.props.errors?.targetItemId" class="font-bold text-danger">{{
            page.props.errors.targetItemId
          }}</span>
        </span>
      </label>
      <label class="flex items-start gap-3 text-sm">
        <input v-model="mode" type="radio" value="cancel" class="mt-0.5 size-5 accent-brand" />
        <span class="font-bold">{{ t('menus.remove.cancel') }}</span>
      </label>
      <p class="text-xs text-ink-3">{{ t('menus.remove.notify') }}</p>
    </section>

    <div v-if="!isPast">
      <AppButton
        variant="danger"
        :loading="processing"
        :disabled="processing || (affected.length > 0 && mode === 'switch' && !target)"
        @click="submit"
      >
        {{ t('menus.remove.confirm') }}
      </AppButton>
    </div>
  </AdminLayout>
</template>
