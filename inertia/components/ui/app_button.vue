<script setup lang="ts">
/**
 * Button or link styled as a button.
 * - variant: primary (green), secondary (white, bordered), danger, ghost
 * - pass `href` to render an Inertia link
 */
import { computed } from 'vue'
// Upstream Link on purpose: the @adonisjs/inertia/vue wrapper drops `method` in href mode,
// so a non-GET button link would become a GET (docs/STACK_NOTES.md).
// eslint-disable-next-line @adonisjs/prefer-adonisjs-inertia-link
import { Link } from '@inertiajs/vue3'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
    size?: 'sm' | 'md' | 'lg'
    type?: 'button' | 'submit' | 'reset'
    href?: string
    method?: 'get' | 'post' | 'put' | 'patch' | 'delete'
    disabled?: boolean
    loading?: boolean
    block?: boolean
  }>(),
  {
    variant: 'primary',
    size: 'md',
    type: 'button',
    href: undefined,
    method: 'get',
    disabled: false,
    loading: false,
    block: false,
  }
)

const classes = computed(() => [
  'inline-flex items-center justify-center gap-2 font-bold no-underline transition-colors select-none',
  'disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60',
  {
    'h-9 rounded-[10px] px-3 text-[13px]': props.size === 'sm',
    'h-11 rounded-xl px-[18px] text-sm': props.size === 'md',
    'h-[52px] rounded-[14px] px-5 text-base': props.size === 'lg',
    'w-full': props.block,
    'bg-brand text-white hover:bg-brand-strong hover:text-white': props.variant === 'primary',
    'border border-line-strong bg-surface text-ink font-semibold hover:bg-subtle hover:text-ink':
      props.variant === 'secondary',
    'bg-danger text-white hover:bg-danger-ink hover:text-white': props.variant === 'danger',
    'bg-transparent text-ink-2 font-semibold hover:bg-subtle hover:text-ink':
      props.variant === 'ghost',
  },
])
</script>

<template>
  <Link
    v-if="href"
    :href="href"
    :method="method"
    :as="method === 'get' ? 'a' : 'button'"
    :class="classes"
    v-bind="disabled || loading ? { 'aria-disabled': 'true' } : {}"
  >
    <slot />
  </Link>
  <button v-else :type="type" :class="classes" :disabled="disabled || loading" :aria-busy="loading">
    <svg
      v-if="loading"
      class="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity=".25" stroke-width="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
      />
    </svg>
    <slot />
  </button>
</template>
