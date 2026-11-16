<script setup lang="ts">
/**
 * D59: parent self-registration — turn on/off, the form link and its QR,
 * a new link (the old QR stops working), the A4 poster (PDF).
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import AppButton from '~/components/ui/app_button.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  registration: { enabled: boolean; url: string | null; qr: string | null }
}>()

const { t } = useI18n()

const busy = ref(false)
const confirmRegenerate = ref(false)
const options = {
  preserveScroll: true,
  onStart: () => (busy.value = true),
  onFinish: () => (busy.value = false),
}
function enable() {
  router.post('/admin/settings/registration', {}, options)
}
function disable() {
  router.delete('/admin/settings/registration', options)
}
function regenerate() {
  confirmRegenerate.value = false
  router.post('/admin/settings/registration/token', {}, options)
}

const copied = ref(false)
async function copy() {
  if (!props.registration.url) return
  try {
    await navigator.clipboard.writeText(props.registration.url)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // No clipboard (plain http): the link stays on screen to select by hand.
  }
}
</script>

<template>
  <section class="card flex max-w-3xl flex-col gap-4 p-5">
    <div class="flex flex-col gap-1">
      <h2 class="text-lg font-bold">{{ t('settings.registration.title') }}</h2>
      <p class="text-[13px] text-ink-4">{{ t('settings.registration.hint') }}</p>
    </div>

    <template v-if="registration.enabled && registration.url">
      <div class="flex flex-wrap items-start gap-5">
        <img
          v-if="registration.qr"
          :src="registration.qr"
          :alt="t('settings.registration.qr_alt')"
          class="size-40 shrink-0 rounded-lg border border-line bg-white p-1"
        />
        <div class="flex min-w-0 flex-1 basis-60 flex-col gap-2">
          <span class="text-[13px] font-bold">{{ t('settings.registration.link') }}</span>
          <code class="rounded-lg bg-subtle p-2.5 text-[13px] break-all">
            {{ registration.url }}
          </code>
          <p class="text-[13px] text-ink-4">{{ t('settings.registration.board_hint') }}</p>
          <div class="flex flex-wrap gap-2">
            <AppButton variant="secondary" @click="copy">
              {{ copied ? t('settings.api.copied') : t('settings.api.copy') }}
            </AppButton>
            <a
              href="/admin/settings/registration/poster"
              class="flex min-h-11 items-center rounded-xl border border-line px-3.5 text-sm font-semibold no-underline"
            >
              {{ t('settings.registration.poster.download') }}
            </a>
            <AppButton variant="secondary" :disabled="busy" @click="confirmRegenerate = true">
              {{ t('settings.registration.regenerate') }}
            </AppButton>
            <AppButton variant="secondary" :disabled="busy" @click="disable">
              {{ t('settings.registration.disable') }}
            </AppButton>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="flex flex-wrap items-center gap-3">
      <p class="m-0 flex-1 text-sm text-ink-3">{{ t('settings.registration.off') }}</p>
      <AppButton :loading="busy" @click="enable">
        {{ t('settings.registration.enable') }}
      </AppButton>
    </div>

    <ConfirmDialog
      v-model:open="confirmRegenerate"
      :title="t('settings.registration.regenerate_title')"
      :message="t('settings.registration.regenerate_body')"
      :confirm-label="t('settings.registration.regenerate')"
      danger
      @confirm="regenerate"
    />
  </section>
</template>
