<script setup lang="ts">
/**
 * Single checkbox with a label and an optional hint (44px touch target).
 */
const model = defineModel<boolean>({ default: false })
defineProps<{ id: string; label: string; hint?: string; error?: string }>()
</script>

<template>
  <div class="flex flex-col gap-1">
    <label :for="id" class="flex min-h-11 cursor-pointer items-start gap-2.5 py-2 text-sm text-ink">
      <input
        :id="id"
        v-model="model"
        type="checkbox"
        class="m-0 mt-0.5 size-[18px] shrink-0 accent-brand"
        :aria-describedby="hint ? `${id}-hint` : undefined"
      />
      <span class="flex flex-col gap-0.5">
        <span class="font-semibold">{{ label }}</span>
        <span v-if="hint" :id="`${id}-hint`" class="text-[13px] text-ink-4">{{ hint }}</span>
      </span>
    </label>
    <p v-if="error" class="text-[13px] font-semibold text-danger" role="alert">{{ error }}</p>
  </div>
</template>
