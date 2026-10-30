<script setup lang="ts">
/**
 * External API (D36): endpoint and keys of the school. The secret is not part
 * of the page: it is fetched only when the admin asks to display it.
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import AppButton from '~/components/ui/app_button.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  api: { endpoint: string; publicKey: string | null; generatedAt: string | null }
  /** Is the amount of one subscription meal set? */
  hasMealPrice: boolean
}>()

const { t, formatDateTime } = useI18n()

const secret = ref<string | null>(null)
const loadingSecret = ref(false)
const secretFailed = ref(false)

async function toggleSecret() {
  if (secret.value) {
    secret.value = null
    return
  }
  loadingSecret.value = true
  secretFailed.value = false
  try {
    const response = await fetch('/admin/settings/api-keys/secret', {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(String(response.status))
    secret.value = ((await response.json()) as { secret: string }).secret
  } catch {
    secretFailed.value = true
  } finally {
    loadingSecret.value = false
  }
}

const copiedField = ref<string | null>(null)
async function copy(field: string, value: string) {
  try {
    await navigator.clipboard.writeText(value)
    copiedField.value = field
    setTimeout(() => (copiedField.value = null), 2000)
  } catch {
    // No clipboard (plain http): the value stays on screen to select by hand.
  }
}

const confirmOpen = ref(false)
const generating = ref(false)
function generate() {
  confirmOpen.value = false
  router.post(
    '/admin/settings/api-keys',
    {},
    {
      preserveScroll: true,
      onStart: () => (generating.value = true),
      onFinish: () => (generating.value = false),
      onSuccess: () => {
        secret.value = null
        secretFailed.value = false
      },
    }
  )
}
function askGenerate() {
  if (props.api.publicKey) confirmOpen.value = true
  else generate()
}
</script>

<template>
  <section class="card flex max-w-3xl flex-col gap-4 p-5">
    <div class="flex flex-col gap-1">
      <h2 class="text-lg font-bold">{{ t('settings.api.title') }}</h2>
      <p class="text-[13px] text-ink-4">{{ t('settings.api.hint') }}</p>
    </div>

    <p
      v-if="!hasMealPrice"
      class="rounded-xl bg-warning-soft p-3 text-[13px] font-semibold text-warning-ink"
    >
      {{ t('settings.api.no_meal_price') }}
    </p>

    <div class="flex flex-col gap-1.5">
      <span class="text-[13px] font-bold">{{ t('settings.api.endpoint') }}</span>
      <div class="flex items-center gap-2">
        <code class="min-w-0 flex-1 rounded-lg bg-subtle p-2.5 text-[13px] break-all">
          GET {{ api.endpoint }}
        </code>
        <AppButton variant="secondary" @click="copy('endpoint', api.endpoint)">
          {{ copiedField === 'endpoint' ? t('settings.api.copied') : t('settings.api.copy') }}
        </AppButton>
      </div>
      <p class="text-[13px] text-ink-4">{{ t('settings.api.usage') }}</p>
    </div>

    <template v-if="api.publicKey">
      <div class="flex flex-col gap-1.5">
        <span class="text-[13px] font-bold">{{ t('settings.api.public_key') }}</span>
        <div class="flex items-center gap-2">
          <code class="min-w-0 flex-1 rounded-lg bg-subtle p-2.5 text-[13px] break-all">
            {{ api.publicKey }}
          </code>
          <AppButton variant="secondary" @click="copy('public', api.publicKey!)">
            {{ copiedField === 'public' ? t('settings.api.copied') : t('settings.api.copy') }}
          </AppButton>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-[13px] font-bold">{{ t('settings.api.secret_key') }}</span>
        <div class="flex flex-wrap items-center gap-2">
          <code class="min-w-0 flex-1 basis-60 rounded-lg bg-subtle p-2.5 text-[13px] break-all">
            {{ secret ?? '••••••••••••••••••••••••' }}
          </code>
          <AppButton variant="secondary" :loading="loadingSecret" @click="toggleSecret">
            {{ secret ? t('settings.api.hide') : t('settings.api.show') }}
          </AppButton>
          <AppButton v-if="secret" variant="secondary" @click="copy('secret', secret!)">
            {{ copiedField === 'secret' ? t('settings.api.copied') : t('settings.api.copy') }}
          </AppButton>
        </div>
        <p v-if="secretFailed" class="text-[13px] font-semibold text-danger" role="alert">
          {{ t('settings.api.secret_error') }}
        </p>
        <p class="text-[13px] text-ink-4">{{ t('settings.api.secret_hint') }}</p>
      </div>

      <p v-if="api.generatedAt" class="text-[13px] text-ink-4">
        {{ t('settings.api.generated_at', { date: formatDateTime(api.generatedAt) }) }}
      </p>
    </template>
    <p v-else class="text-sm text-ink-3">{{ t('settings.api.empty') }}</p>

    <div>
      <AppButton
        :variant="api.publicKey ? 'secondary' : 'primary'"
        :loading="generating"
        @click="askGenerate"
      >
        {{ api.publicKey ? t('settings.api.regenerate') : t('settings.api.generate') }}
      </AppButton>
    </div>

    <ConfirmDialog
      v-model:open="confirmOpen"
      :title="t('settings.api.confirm_title')"
      :message="t('settings.api.confirm_body')"
      :confirm-label="t('settings.api.regenerate')"
      danger
      @confirm="generate"
    />
  </section>
</template>
