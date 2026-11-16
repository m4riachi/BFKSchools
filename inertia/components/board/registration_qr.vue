<script setup lang="ts">
/**
 * D59: full-screen QR of the parent sign-up form, over the board. The QR
 * image comes from the server (SVG data URL of the public form link only);
 * it closes on a tap on "Close" or after two minutes.
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from '~/composables/use_i18n'

defineProps<{ qr: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

const AUTO_CLOSE_MS = 120_000
let timer: ReturnType<typeof setTimeout> | undefined
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}
onMounted(() => {
  timer = setTimeout(() => emit('close'), AUTO_CLOSE_MS)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-[3vmin] bg-white px-[5vmin] text-center text-ink"
    role="dialog"
    aria-modal="true"
    :aria-label="t('board.registration.title')"
  >
    <h2 class="text-[5vmin] leading-tight font-extrabold">{{ t('board.registration.title') }}</h2>
    <p class="max-w-[80vmin] text-[2.8vmin] text-ink-2">{{ t('board.registration.body') }}</p>
    <img
      :src="qr"
      :alt="t('board.registration.qr_alt')"
      class="size-[60vmin] rounded-[2vmin] border border-line bg-white p-[1.5vmin]"
    />
    <p class="max-w-[80vmin] text-[2.2vmin] text-ink-3">{{ t('board.registration.after') }}</p>
    <button
      type="button"
      class="rounded-full border border-line px-[5vmin] py-[1.6vmin] text-[2.8vmin] font-bold text-ink-2 hover:bg-subtle"
      @click="emit('close')"
    >
      {{ t('board.registration.close') }}
    </button>
  </div>
</template>
