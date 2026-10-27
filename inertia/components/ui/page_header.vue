<script setup lang="ts">
/**
 * Page title block: sets the document title, shows an optional eyebrow
 * (e.g. today's date) and actions on the right.
 */
import { Head } from '@inertiajs/vue3'

defineProps<{ title: string; eyebrow?: string; description?: string }>()
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-4">
    <Head :title="title" />
    <div class="flex min-w-0 flex-col gap-1">
      <span v-if="eyebrow" class="text-[13px] font-semibold text-ink-4">{{ eyebrow }}</span>
      <h1 class="text-[26px] font-extrabold tracking-[-0.02em] sm:text-[28px]">{{ title }}</h1>
      <p v-if="description" class="text-sm text-ink-3">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2.5">
      <slot name="actions" />
    </div>
  </header>
</template>
