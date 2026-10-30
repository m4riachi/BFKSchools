<script setup lang="ts">
withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' })

// Bound on purpose: Vite would resolve a literal `src` as a module import, and
// this file is served by the app from `public/`, outside Vite's root.
const logoUrl = '/logo-bfk.png'
</script>

<template>
  <img
    :src="logoUrl"
    alt=""
    aria-hidden="true"
    width="429"
    height="277"
    class="w-auto shrink-0 object-contain"
    :class="{
      'h-10': size === 'sm',
      'h-12': size === 'md',
      'h-24': size === 'lg',
    }"
  />
</template>
