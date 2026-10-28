<script setup lang="ts">
/**
 * Multi-select of the 14 EU allergens as a checkbox grid (labels from
 * allergens.<code>). v-model is the list of selected codes.
 */
import { useId } from 'vue'
import { useI18n } from '~/composables/use_i18n'

const model = defineModel<string[]>({ default: () => [] })
defineProps<{ allergens: string[]; label: string; hint?: string; error?: string }>()

const { t } = useI18n()
const id = useId()

function toggle(code: string, checked: boolean) {
  const next = model.value.filter((value) => value !== code)
  if (checked) next.push(code)
  model.value = next
}
</script>

<template>
  <fieldset class="flex flex-col gap-2" :aria-describedby="hint ? `${id}-hint` : undefined">
    <legend class="mb-1.5 text-[13px] font-bold text-ink">{{ label }}</legend>
    <p v-if="hint" :id="`${id}-hint`" class="-mt-1 mb-1 text-[13px] text-ink-4">{{ hint }}</p>
    <div class="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-3">
      <label
        v-for="code in allergens"
        :key="code"
        class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border px-3 text-sm font-semibold"
        :class="
          model.includes(code)
            ? 'border-danger-line bg-danger-soft text-danger-ink'
            : 'border-line bg-surface text-ink-2 hover:bg-subtle'
        "
      >
        <input
          type="checkbox"
          class="m-0 size-[18px] shrink-0 accent-danger"
          :value="code"
          :checked="model.includes(code)"
          @change="toggle(code, ($event.target as HTMLInputElement).checked)"
        />
        {{ t(`allergens.${code}`) }}
      </label>
    </div>
    <p v-if="error" class="text-[13px] font-semibold text-danger" role="alert">{{ error }}</p>
  </fieldset>
</template>
