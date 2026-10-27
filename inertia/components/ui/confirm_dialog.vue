<script setup lang="ts">
/**
 * Confirmation modal. Emits `confirm`; the parent closes it (or keeps it
 * open while `processing`).
 */
import ModalDialog from '~/components/ui/modal_dialog.vue'
import AppButton from '~/components/ui/app_button.vue'
import { useI18n } from '~/composables/use_i18n'

const open = defineModel<boolean>('open', { default: false })
defineProps<{
  title?: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  processing?: boolean
}>()
const emit = defineEmits<{ confirm: [] }>()

const { t } = useI18n()
</script>

<template>
  <ModalDialog v-model:open="open" :title="title ?? t('ui.confirm_title')" size="sm">
    <slot>{{ message ?? t('ui.confirm_body') }}</slot>
    <template #footer>
      <AppButton variant="secondary" :disabled="processing" @click="open = false">
        {{ cancelLabel ?? t('ui.cancel') }}
      </AppButton>
      <AppButton
        :variant="danger ? 'danger' : 'primary'"
        :loading="processing"
        @click="emit('confirm')"
      >
        {{ confirmLabel ?? t('ui.confirm') }}
      </AppButton>
    </template>
  </ModalDialog>
</template>
