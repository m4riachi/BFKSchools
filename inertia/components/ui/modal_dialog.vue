<script setup lang="ts">
/**
 * Accessible modal built on the native <dialog> element (focus trap, Esc to
 * close, inert background). Use v-model:open.
 */
import { ref, watch, onMounted, useId } from 'vue'
import { useI18n } from '~/composables/use_i18n'

const open = defineModel<boolean>('open', { default: false })
withDefaults(defineProps<{ title: string; size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' })

const dialog = ref<HTMLDialogElement>()
const titleId = useId()
const { t } = useI18n()

function sync(value: boolean) {
  const el = dialog.value
  if (!el) return
  if (value && !el.open) el.showModal()
  if (!value && el.open) el.close()
}

watch(open, sync)
onMounted(() => sync(open.value))

function onBackdropClick(event: MouseEvent) {
  if (event.target === dialog.value) open.value = false
}
</script>

<template>
  <dialog
    ref="dialog"
    :aria-labelledby="titleId"
    class="m-auto w-[calc(100%-32px)] rounded-3xl border border-line bg-surface p-0 text-ink shadow-overlay backdrop:bg-ink/40"
    :class="{ 'max-w-sm': size === 'sm', 'max-w-lg': size === 'md', 'max-w-2xl': size === 'lg' }"
    @close="open = false"
    @click="onBackdropClick"
  >
    <div class="flex flex-col gap-4 p-6">
      <div class="flex items-start justify-between gap-4">
        <h2 :id="titleId" class="text-lg font-bold">{{ title }}</h2>
        <button
          type="button"
          class="-mt-1 -mr-2 flex size-10 items-center justify-center rounded-[10px] text-ink-3 hover:bg-subtle"
          :aria-label="t('ui.close')"
          @click="open = false"
        >
          <svg
            class="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div class="text-sm text-ink-3"><slot /></div>
      <div v-if="$slots.footer" class="flex flex-wrap justify-end gap-2.5 pt-2">
        <slot name="footer" />
      </div>
    </div>
  </dialog>
</template>
