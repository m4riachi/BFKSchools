<script setup lang="ts">
/**
 * D59: what staff can do while a sign-up's email is not confirmed — send a
 * new link by email or on WhatsApp, or confirm it themselves after checking
 * the parent another way (recorded). The server checks everything.
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import AppButton from '~/components/ui/app_button.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  parentId: number
  fullName: string
  email: string
  hasWhatsapp: boolean
}>()

const { t } = useI18n()
const processing = ref(false)
const confirmOpen = ref(false)

function post(path: string) {
  router.post(
    `/admin/parents/${props.parentId}/registration/${path}`,
    {},
    {
      preserveScroll: true,
      onStart: () => (processing.value = true),
      onFinish: () => {
        processing.value = false
        confirmOpen.value = false
      },
    }
  )
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <AppButton size="sm" variant="secondary" :disabled="processing" @click="post('confirmation')">
      {{ t('families.registration.resend_confirmation') }}
    </AppButton>
    <AppButton
      size="sm"
      variant="secondary"
      :disabled="!hasWhatsapp || processing"
      :title="hasWhatsapp ? undefined : t('families.parent_show.whatsapp_no_phone')"
      @click="post('confirmation/whatsapp')"
    >
      {{ t('families.registration.resend_confirmation_whatsapp') }}
    </AppButton>
    <AppButton size="sm" variant="secondary" :disabled="processing" @click="confirmOpen = true">
      {{ t('families.registration.confirm_email') }}
    </AppButton>
    <ConfirmDialog
      v-model:open="confirmOpen"
      :title="t('families.registration.confirm_email_title')"
      :message="t('families.registration.confirm_email_body', { email, name: fullName })"
      :confirm-label="t('families.registration.confirm_email')"
      :processing="processing"
      @confirm="post('email-confirmed')"
    />
  </div>
</template>
