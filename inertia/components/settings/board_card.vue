<script setup lang="ts">
/**
 * School display board (D46): the public address (`/board/<slug>`) that a
 * screen at the school opens without logging in. Turn on, move, turn off.
 */
import { computed, ref } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import AppButton from '~/components/ui/app_button.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import TextInput from '~/components/ui/text_input.vue'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  board: {
    slug: string | null
    url: string | null
    suggestion: string
    origin: string
    printerButton: boolean
  }
}>()

const { t } = useI18n()
const page = usePage()

const slug = ref(props.board.slug ?? props.board.suggestion)
const error = computed(() => (page.props.errors as Record<string, string> | undefined)?.board_slug)
const changed = computed(() => slug.value.trim().toLowerCase() !== props.board.slug)

const copied = ref(false)
async function copy() {
  if (!props.board.url) return
  try {
    await navigator.clipboard.writeText(props.board.url)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // No clipboard (plain http): the link stays on screen to select by hand.
  }
}

const busy = ref(false)
const confirmDisable = ref(false)
const options = {
  preserveScroll: true,
  onStart: () => (busy.value = true),
  onFinish: () => (busy.value = false),
}
function enable() {
  router.post('/admin/settings/board', { board_slug: slug.value }, options)
}
/** D51: the 🖨 button on the board — hide it once the printer is paired. */
function setPrinterButton(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  router.put('/admin/settings/board/printer-button', { enabled }, options)
}
function disable() {
  confirmDisable.value = false
  router.delete('/admin/settings/board', {
    ...options,
    onSuccess: () => (slug.value = props.board.suggestion),
  })
}
</script>

<template>
  <section class="card flex max-w-3xl flex-col gap-4 p-5">
    <div class="flex flex-col gap-1">
      <h2 class="text-lg font-bold">{{ t('settings.board.title') }}</h2>
      <p class="text-[13px] text-ink-4">{{ t('settings.board.hint') }}</p>
    </div>

    <form class="flex flex-col gap-4" @submit.prevent="enable">
      <div class="flex flex-wrap items-end gap-2">
        <div class="min-w-0 flex-1 basis-72">
          <TextInput
            id="board_slug"
            v-model="slug"
            :label="t('settings.board.slug')"
            :hint="t('settings.board.slug_hint')"
            :error="error"
            :placeholder="board.suggestion"
            autocomplete="off"
            required
          />
        </div>
        <AppButton
          type="submit"
          :variant="board.slug && !changed ? 'secondary' : 'primary'"
          :loading="busy"
          :disabled="Boolean(board.slug) && !changed"
        >
          {{ board.slug ? t('settings.board.save') : t('settings.board.enable') }}
        </AppButton>
      </div>
      <p class="-mt-2 text-[13px] text-ink-4">{{ board.origin }}{{ slug }}</p>
    </form>

    <div v-if="board.url" class="flex flex-col gap-1.5">
      <span class="text-[13px] font-bold">{{ t('settings.board.link') }}</span>
      <div class="flex flex-wrap items-center gap-2">
        <code class="min-w-0 flex-1 basis-60 rounded-lg bg-subtle p-2.5 text-[13px] break-all">
          {{ board.url }}
        </code>
        <AppButton variant="secondary" @click="copy">
          {{ copied ? t('settings.api.copied') : t('settings.api.copy') }}
        </AppButton>
        <a
          :href="board.url"
          target="_blank"
          rel="noopener noreferrer"
          class="rounded-xl border border-line px-3.5 py-2 text-sm font-semibold no-underline"
        >
          {{ t('settings.board.open') }}
        </a>
        <AppButton variant="secondary" :disabled="busy" @click="confirmDisable = true">
          {{ t('settings.board.disable') }}
        </AppButton>
      </div>
    </div>
    <p v-else class="text-sm text-ink-3">{{ t('settings.board.empty') }}</p>

    <label v-if="board.url" class="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        class="mt-1 size-4"
        :checked="board.printerButton"
        :disabled="busy"
        @change="setPrinterButton"
      />
      <span class="flex flex-col gap-0.5">
        <span class="font-bold">{{ t('settings.board.printer_button') }}</span>
        <span class="text-[13px] text-ink-4">{{ t('settings.board.printer_button_hint') }}</span>
      </span>
    </label>

    <ConfirmDialog
      v-model:open="confirmDisable"
      :title="t('settings.board.disable_title')"
      :message="t('settings.board.disable_body')"
      :confirm-label="t('settings.board.disable')"
      danger
      @confirm="disable"
    />
  </section>
</template>
