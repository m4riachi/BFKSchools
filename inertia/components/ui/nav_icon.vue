<script setup lang="ts">
/**
 * Line icons from the approved design (24×24, 1.8 stroke).
 */
export type NavIconName =
  | 'dashboard'
  | 'families'
  | 'meals'
  | 'calendar'
  | 'holidays'
  | 'orders'
  | 'kitchen'
  | 'statements'
  | 'settings'
  | 'history'
  | 'account'
  | 'logout'
  | 'menu'
  | 'close'

defineProps<{ name: NavIconName; size?: number }>()
</script>

<template>
  <svg
    :width="size ?? 20"
    :height="size ?? 20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <template v-if="name === 'dashboard'">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </template>
    <template v-else-if="name === 'families'">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M18 14.2c2.2.6 3.5 2.6 3.5 5.8" />
    </template>
    <template v-else-if="name === 'meals'">
      <path d="M7 3v8" />
      <path d="M4.5 3v5a2.5 2.5 0 0 0 5 0V3" />
      <path d="M7 11v10" />
      <path d="M17 3c-2 1.5-3 4-3 7v3h3v8" />
    </template>
    <template v-else-if="name === 'calendar'">
      <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
      <path d="M3 9.5h18" />
      <path d="M8 2.5v4" />
      <path d="M16 2.5v4" />
      <path d="M7.5 14h3" />
      <path d="M13.5 14h3" />
      <path d="M7.5 17.5h3" />
    </template>
    <template v-else-if="name === 'holidays'">
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </template>
    <template v-else-if="name === 'orders'">
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1" />
      <path d="M8.5 10h7" />
      <path d="M8.5 14h7" />
      <path d="M8.5 18h4" />
    </template>
    <template v-else-if="name === 'kitchen'">
      <path d="M4 11h16v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" />
      <path d="M2 11h20" />
      <path d="M9 7c0-1.5 1-2 1-3.5" />
      <path d="M14 7c0-1.5 1-2 1-3.5" />
    </template>
    <template v-else-if="name === 'statements'">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </template>
    <template v-else-if="name === 'settings'">
      <path d="M4 6h10" />
      <path d="M18 6h2" />
      <circle cx="16" cy="6" r="2" />
      <path d="M4 12h4" />
      <path d="M12 12h8" />
      <circle cx="10" cy="12" r="2" />
      <path d="M4 18h12" />
      <circle cx="18" cy="18" r="2" />
    </template>
    <template v-else-if="name === 'history'">
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3.5 4v4h4" />
      <path d="M12 8v4l3 2" />
    </template>
    <template v-else-if="name === 'account'">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c0-3.9 3.4-6.5 7.5-6.5s7.5 2.6 7.5 6.5" />
    </template>
    <template v-else-if="name === 'logout'">
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 16l-4-4 4-4" />
      <path d="M6 12h10" />
    </template>
    <template v-else-if="name === 'menu'">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </template>
    <template v-else-if="name === 'close'">
      <path d="M6 6l12 12M18 6 6 18" />
    </template>
  </svg>
</template>
