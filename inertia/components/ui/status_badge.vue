<script setup lang="ts">
/**
 * Pill used for statuses, tags and allergens.
 */
withDefaults(
  defineProps<{ tone?: 'neutral' | 'brand' | 'warning' | 'danger' | 'info'; solid?: boolean }>(),
  { tone: 'neutral', solid: false }
)
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-xs leading-none font-bold whitespace-nowrap"
    :class="
      solid
        ? {
            'bg-ink-3 text-white': tone === 'neutral',
            'bg-brand text-white': tone === 'brand',
            'bg-warning text-white': tone === 'warning',
            'bg-danger text-white': tone === 'danger',
            'bg-info text-white': tone === 'info',
          }
        : {
            'bg-muted-bg text-ink-3': tone === 'neutral',
            'bg-brand-soft text-brand-strong': tone === 'brand',
            'bg-warning-soft text-warning': tone === 'warning',
            'bg-danger-soft text-danger': tone === 'danger',
            'bg-info-soft text-info': tone === 'info',
          }
    "
  >
    <slot />
  </span>
</template>
