<script setup lang="ts">
import { computed } from 'vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import { useI18n } from '~/composables/use_i18n'

export type AccessStatus = 'active' | 'invited' | 'expired' | 'not_invited' | 'inactive'

const props = defineProps<{ status: AccessStatus }>()
const { t } = useI18n()

const tone = computed(
  () =>
    (
      ({
        active: 'brand',
        invited: 'info',
        expired: 'warning',
        not_invited: 'neutral',
        inactive: 'danger',
      }) as const
    )[props.status]
)
</script>

<template>
  <StatusBadge :tone="tone">{{ t(`families.access.${status}`) }}</StatusBadge>
</template>
