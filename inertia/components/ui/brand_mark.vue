<script setup lang="ts">
withDefaults(defineProps<{ size?: 'sm' | 'md' | 'header' | 'lg' }>(), { size: 'md' })

// Bound on purpose: Vite would resolve a literal `src` as a module import, and
// this file is served by the app from `public/`, outside Vite's root.
const logoUrl = '/bfk-logo-animated.svg'
</script>

<template>
  <img
    :src="logoUrl"
    alt=""
    aria-hidden="true"
    width="437"
    height="285"
    class="w-auto shrink-0 object-contain"
    :class="{
      'h-10': size === 'sm',
      'h-12': size === 'md',
      'h-14': size === 'header',
      'h-24': size === 'lg',
    }"
  />
</template>
