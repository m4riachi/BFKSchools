<script setup lang="ts">
withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' })
</script>

<template>
  <div
    aria-hidden="true"
    class="bg-brand flex shrink-0 items-center justify-center font-extrabold tracking-[0.02em] text-white"
    :class="{
      'size-9 rounded-[10px] text-[11px]': size === 'sm',
      'size-10 rounded-xl text-[13px]': size === 'md',
      'size-16 rounded-[18px] text-[17px]': size === 'lg',
    }"
  >
    BFK
  </div>
</template>
