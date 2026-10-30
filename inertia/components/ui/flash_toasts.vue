<script setup lang="ts">
/**
 * Shows the server's flash messages (`session.flash('success' | 'error', …)`)
 * as toasts. Messages are already translated on the server.
 */
import { watch } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { toast, Toaster } from 'vue-sonner'
import { CircleAlert } from 'lucide-vue-next'

const page = usePage()
// Bound on purpose: Vite would resolve a literal `src` as a module import.
const logoUrl = '/logo-bfk.png'

watch(
  () => page.url,
  () => toast.dismiss()
)

watch(
  () => page.flash,
  (flash) => {
    if (flash?.error) toast.error(flash.error, { id: 'flash' })
    if (flash?.success) toast.success(flash.success, { id: 'flash' })
  },
  { immediate: true }
)
</script>

<template>
  <Toaster position="top-center" :toast-options="{ unstyled: true }">
    <template #success-icon>
      <img :src="logoUrl" alt="" width="429" height="277" class="h-10 w-auto max-w-none" />
    </template>
    <template #error-icon>
      <CircleAlert :size="18" :stroke-width="1.8" />
    </template>
  </Toaster>
</template>
