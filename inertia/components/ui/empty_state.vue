<script setup lang="ts">
/**
 * Placeholder for empty lists and areas not built yet.
 */
withDefaults(defineProps<{ title: string; description?: string; tone?: 'brand' | 'info' }>(), {
  description: undefined,
  tone: 'brand',
})
</script>

<template>
  <div class="flex flex-col items-center gap-3 px-5 py-10 text-center">
    <div
      class="flex size-14 items-center justify-center rounded-2xl"
      :class="tone === 'info' ? 'bg-info-soft text-info' : 'bg-brand-soft text-brand-strong'"
    >
      <slot name="icon">
        <svg
          class="size-[26px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
          <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
        </svg>
      </slot>
    </div>
    <h2 class="text-[19px] font-extrabold">{{ title }}</h2>
    <p v-if="description" class="max-w-md text-sm leading-relaxed text-ink-3">{{ description }}</p>
    <div v-if="$slots.default" class="pt-1"><slot /></div>
  </div>
</template>
