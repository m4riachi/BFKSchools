<script setup lang="ts">
/**
 * Label + control + hint/error wrapper used by TextInput and SelectInput.
 */
defineProps<{ id: string; label?: string; error?: string; hint?: string; required?: boolean }>()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" :for="id" class="text-[13px] font-bold text-ink">
      {{ label }}<span v-if="required" class="text-danger" aria-hidden="true"> *</span>
    </label>
    <slot />
    <p v-if="error" :id="`${id}-error`" class="text-[13px] font-semibold text-danger" role="alert">
      {{ error }}
    </p>
    <p v-else-if="hint" :id="`${id}-hint`" class="text-[13px] text-ink-4">{{ hint }}</p>
  </div>
</template>
