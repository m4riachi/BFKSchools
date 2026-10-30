<script setup lang="ts">
/**
 * Beldi Fusion logo and a spinner while a choice is being saved. Stays at
 * least a moment, so a fast save does not flash, and it blocks clicks so
 * nothing changes under a save in progress.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import BrandMark from '~/components/ui/brand_mark.vue'
import { useI18n } from '~/composables/use_i18n'

const MIN_VISIBLE_MS = 500

const props = defineProps<{ show: boolean }>()
const { t } = useI18n()

const visible = ref(false)
let shownAt = 0
let timer: ReturnType<typeof setTimeout> | undefined

watch(
  () => props.show,
  (show) => {
    clearTimeout(timer)
    if (show) {
      shownAt = Date.now()
      visible.value = true
    } else {
      timer = setTimeout(
        () => (visible.value = false),
        Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt))
      )
    }
  }
)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150 motion-reduce:transition-none"
      leave-active-class="transition-opacity duration-150 motion-reduce:transition-none"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="visible"
        class="fixed inset-0 z-40 flex items-center justify-center bg-ink/20"
        role="status"
        aria-live="polite"
      >
        <div
          class="flex flex-col items-center gap-3 rounded-[18px] bg-surface px-8 py-5 shadow-overlay"
        >
          <BrandMark size="lg" />
          <span
            class="size-7 animate-spin rounded-full border-[3px] border-brand-soft border-t-brand motion-reduce:animate-[spin_3s_linear_infinite]"
            aria-hidden="true"
          />
          <span class="text-sm font-bold text-ink-2">{{ t('orders.week.saving') }}</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
