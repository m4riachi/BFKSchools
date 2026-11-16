<script setup lang="ts">
/** D59: opens right after "Renvoyer par WhatsApp" with the wa.me link (staff press Send). */
import { ref, watch } from 'vue'
import ModalDialog from '~/components/ui/modal_dialog.vue'
import AppButton from '~/components/ui/app_button.vue'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{ url: string | null }>()

const { t } = useI18n()
const open = ref(false)
watch(
  () => props.url,
  (url) => (open.value = Boolean(url)),
  { immediate: true }
)
</script>

<template>
  <ModalDialog
    v-model:open="open"
    :title="t('families.registration.whatsapp_confirmation_ready_title')"
    size="sm"
  >
    <p class="m-0 text-sm text-ink-2">
      {{ t('families.registration.whatsapp_confirmation_ready_body') }}
    </p>
    <template #footer>
      <AppButton variant="secondary" @click="open = false">
        {{ t('families.parent_show.whatsapp_close') }}
      </AppButton>
      <a
        v-if="url"
        :href="url"
        target="_blank"
        rel="noopener noreferrer"
        class="flex min-h-11 items-center rounded-xl bg-[#25D366] px-4 text-sm font-bold text-white no-underline hover:bg-[#1EBE5B] hover:text-white"
        @click="open = false"
      >
        {{ t('families.parent_show.whatsapp_open') }}
      </a>
    </template>
  </ModalDialog>
</template>
