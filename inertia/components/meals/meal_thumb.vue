<script setup lang="ts">
/**
 * Meal image: the cover thumbnail when there is one, otherwise the design's
 * tinted plate placeholder. `size` = CSS size class of the square tile;
 * `fill` makes it cover its container (grid cards).
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ src?: string | null; alt?: string; seed?: number; fill?: boolean }>(),
  { src: null, alt: '', seed: 0, fill: false }
)

/** Warm tints from the design's meal tiles. */
const TINTS = [
  '#F3E9DA',
  '#EAF1DC',
  '#F2E7D3',
  '#F1E4D6',
  '#F7E1E6',
  '#FBE9CF',
  '#E6F0DA',
  '#E3ECF2',
]
const tint = computed(() => TINTS[Math.abs(props.seed) % TINTS.length])
</script>

<template>
  <img
    v-if="src"
    :src="src"
    :alt="alt"
    loading="lazy"
    decoding="async"
    class="object-cover"
    :class="fill ? 'size-full' : ''"
  />
  <div
    v-else
    aria-hidden="true"
    class="flex items-center justify-center text-[#8B6A45]"
    :class="fill ? 'size-full' : ''"
    :style="{ background: tint }"
  >
    <svg
      class="size-[45%] max-h-14 max-w-14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
    >
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.5" />
    </svg>
  </div>
</template>
