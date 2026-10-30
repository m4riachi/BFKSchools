<script setup lang="ts">
/**
 * Invitation to install the app, shown only when it can do something: the
 * browser offers the install prompt, or on iOS (Safari has no prompt: the
 * steps are explained instead). Hidden once running as the installed app.
 *
 * `pill`: sticky button of the parent portal, which also opens the modal by
 * itself (not again for a while after "later"). `icon`: small button.
 */
import { computed, onMounted, ref, watch } from 'vue'
import AppButton from '~/components/ui/app_button.vue'
import ModalDialog from '~/components/ui/modal_dialog.vue'
import NavIcon from '~/components/ui/nav_icon.vue'
import { useI18n } from '~/composables/use_i18n'
import { useInstallApp } from '~/composables/use_install_app'

const props = withDefaults(defineProps<{ variant?: 'icon' | 'pill' }>(), { variant: 'icon' })

const { t } = useI18n()
const {
  promptEvent,
  installed,
  runningAsApp,
  isIos,
  install,
  rememberDismissed,
  dismissedRecently,
} = useInstallApp()

// Browser-only checks: read after mount.
const ios = ref(false)
const asApp = ref(false)
onMounted(() => {
  ios.value = isIos()
  asApp.value = runningAsApp()
})

const visible = computed(
  () => !asApp.value && !installed.value && (promptEvent.value !== null || ios.value)
)
const modalOpen = ref(false)
// Bound on purpose: Vite would resolve a literal `src` as a module import.
const iconUrl = '/icons/icon-192.png'

// Immediate: the browser's install event often comes before this page mounts.
watch(
  visible,
  (canInstall) => {
    if (canInstall && props.variant === 'pill' && !dismissedRecently()) {
      setTimeout(() => (modalOpen.value = true), 800)
    }
  },
  { immediate: true }
)
watch(modalOpen, (isOpen) => {
  if (!isOpen) rememberDismissed()
})

function onInstall() {
  modalOpen.value = false
  install()
}
</script>

<template>
  <button
    v-if="visible && variant === 'icon'"
    type="button"
    class="flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-ink-2 hover:bg-subtle"
    :aria-label="t('app.install')"
    :title="t('app.install')"
    @click="modalOpen = true"
  >
    <NavIcon name="install" />
  </button>
  <button
    v-if="visible && variant === 'pill'"
    type="button"
    class="flex min-h-11 items-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-white shadow-overlay hover:bg-brand-deep"
    @click="modalOpen = true"
  >
    <NavIcon name="install" :size="18" />
    {{ t('app.install_action') }}
  </button>

  <ModalDialog v-model:open="modalOpen" :title="t('app.install_title')" size="sm">
    <div class="flex flex-col items-center gap-3 text-center">
      <img :src="iconUrl" alt="" width="192" height="192" class="size-20 rounded-2xl" />
      <p class="m-0">{{ t('app.install_body') }}</p>
      <ol v-if="!promptEvent" class="m-0 flex list-decimal flex-col gap-1 pl-5 text-left">
        <li>{{ t('app.install_ios_step_share') }}</li>
        <li>{{ t('app.install_ios_step_add') }}</li>
      </ol>
    </div>
    <template #footer>
      <template v-if="promptEvent">
        <AppButton variant="secondary" @click="modalOpen = false">
          {{ t('app.install_later') }}
        </AppButton>
        <AppButton @click="onInstall">{{ t('app.install_action') }}</AppButton>
      </template>
      <AppButton v-else @click="modalOpen = false">{{ t('app.install_ios_done') }}</AppButton>
    </template>
  </ModalDialog>
</template>
