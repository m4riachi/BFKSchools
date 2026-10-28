<script setup lang="ts">
/**
 * Tag pills (green) and allergen pills (red), as in the parent design.
 * `max` limits the allergens shown (the rest becomes "+n").
 */
import { computed } from 'vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import { useI18n } from '~/composables/use_i18n'

const props = withDefaults(defineProps<{ tags?: string[]; allergens?: string[]; max?: number }>(), {
  tags: () => [],
  allergens: () => [],
  max: 99,
})
const { t } = useI18n()

const shown = computed(() => props.allergens.slice(0, props.max))
const hidden = computed(() => props.allergens.length - shown.value.length)
</script>

<template>
  <div v-if="tags.length || allergens.length" class="flex flex-wrap gap-1.5">
    <StatusBadge v-for="tag in tags" :key="`t-${tag}`" tone="brand">
      {{ t(`meals.tags.${tag}`) }}
    </StatusBadge>
    <StatusBadge v-for="code in shown" :key="`a-${code}`" tone="danger">
      {{ t(`allergens.${code}`) }}
    </StatusBadge>
    <StatusBadge v-if="hidden > 0" tone="neutral">
      {{ t('meals.list.allergens_more', { count: hidden }) }}
    </StatusBadge>
  </div>
</template>
