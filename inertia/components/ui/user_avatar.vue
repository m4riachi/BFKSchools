<script setup lang="ts">
withDefaults(defineProps<{ initials: string; tone?: 'brand' | 'warning' | 'info' }>(), {
  tone: 'brand',
})
</script>

<template>
  <div
    aria-hidden="true"
    class="flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
    :class="{
      'bg-brand-tint text-brand-strong': tone === 'brand',
      'bg-[#fbe9cf] text-warning': tone === 'warning',
      'bg-info-soft text-info': tone === 'info',
    }"
  >
    {{ initials }}
  </div>
</template>
