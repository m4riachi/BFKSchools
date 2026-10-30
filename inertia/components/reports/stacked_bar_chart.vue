<script setup lang="ts">
/**
 * Stacked columns over time, with a legend and one tooltip per column (hover,
 * keyboard focus or tap). Values and their texts come from the server; this
 * component only scales them. The table under the charts holds the same numbers.
 */
import { computed, ref } from 'vue'

export type ChartSeries = { key: string; label: string; color: string }
export type ChartPoint = {
  date: string
  /** Column label in the tooltip. */
  title: string
  /** Short label under the axis. */
  axis: string
  values: Record<string, number>
  /** Tooltip text per series. */
  texts: Record<string, string>
  total?: string
}

const props = defineProps<{
  label: string
  series: ChartSeries[]
  points: ChartPoint[]
  totalLabel?: string
  emptyText: string
  /** Text of an axis tick, from a value in the chart's unit. */
  formatTick: (value: number) => string
}>()

function totalOf(point: ChartPoint) {
  return props.series.reduce((sum, item) => sum + (point.values[item.key] ?? 0), 0)
}

const largest = computed(() => Math.max(0, ...props.points.map(totalOf)))

/** Rounded top of the axis: 1, 2 or 5 × 10ⁿ per step, four steps at most. */
const axis = computed(() => {
  if (largest.value === 0) return { max: 0, ticks: [] as number[] }
  const raw = largest.value / 4
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 5, 10].find((factor) => factor * power >= raw) ?? 10) * power
  const count = Math.ceil(largest.value / step)
  return { max: count * step, ticks: Array.from({ length: count + 1 }, (_, index) => index * step) }
})

/** At most seven labels under the axis, so they never collide. */
const labelEvery = computed(() => Math.max(1, Math.ceil(props.points.length / 7)))

const active = ref<number | null>(null)
const activePoint = computed(() => (active.value === null ? null : props.points[active.value]))
const tooltipOnLeft = computed(() => (active.value ?? 0) > props.points.length / 2)
const tooltipPosition = computed(() => {
  const edge = (((active.value ?? 0) + 0.5) * 100) / props.points.length
  return tooltipOnLeft.value ? { right: `${100 - edge}%` } : { left: `${edge}%` }
})

/** The top non-empty segment gets the rounded end. */
function segments(point: ChartPoint) {
  const filled = props.series.filter((item) => (point.values[item.key] ?? 0) > 0)
  return filled.map((item, index) => ({
    ...item,
    height: ((point.values[item.key] ?? 0) * 100) / axis.value.max,
    isTop: index === filled.length - 1,
  }))
}
</script>

<template>
  <figure class="m-0 flex flex-col gap-3" role="group" :aria-label="label">
    <div v-if="series.length > 1" class="flex flex-wrap gap-x-4 gap-y-1">
      <span
        v-for="item in series"
        :key="item.key"
        class="flex items-center gap-1.5 text-xs font-semibold text-ink-3"
      >
        <span
          class="size-2.5 rounded-[3px]"
          :style="{ backgroundColor: item.color }"
          aria-hidden="true"
        />
        {{ item.label }}
      </span>
    </div>

    <p v-if="largest === 0" class="py-10 text-center text-sm text-ink-3">{{ emptyText }}</p>

    <div v-else class="flex gap-2">
      <div class="tabular relative h-52 w-14 shrink-0 text-right text-[11px] text-ink-4">
        <span
          v-for="tick in axis.ticks"
          :key="tick"
          class="absolute right-0 translate-y-1/2 whitespace-nowrap"
          :style="{ bottom: `${(tick * 100) / axis.max}%` }"
        >
          {{ formatTick(tick) }}
        </span>
      </div>

      <div class="min-w-0 flex-1">
        <div class="relative h-52" @pointerleave="active = null">
          <span
            v-for="tick in axis.ticks"
            :key="tick"
            class="absolute inset-x-0 h-px bg-line-soft"
            :class="tick === 0 ? 'bg-line-strong' : ''"
            :style="{ bottom: `${(tick * 100) / axis.max}%` }"
            aria-hidden="true"
          />

          <div class="absolute inset-0 flex">
            <div
              v-for="(point, index) in points"
              :key="point.date"
              tabindex="0"
              class="flex min-w-0 flex-1 cursor-default flex-col items-center justify-end rounded-t outline-none focus-visible:bg-subtle"
              :class="active === index ? 'bg-subtle' : ''"
              :aria-label="
                [
                  point.title,
                  ...series.map((item) => `${item.label} ${point.texts[item.key]}`),
                  point.total,
                ]
                  .filter(Boolean)
                  .join(', ')
              "
              @pointerenter="active = index"
              @focus="active = index"
              @blur="active = null"
              @click="active = index"
            >
              <div class="flex h-full w-[70%] max-w-6 flex-col justify-end gap-0.5">
                <span
                  v-for="segment in [...segments(point)].reverse()"
                  :key="segment.key"
                  class="block w-full"
                  :class="segment.isTop ? 'rounded-t' : ''"
                  :style="{ height: `${segment.height}%`, backgroundColor: segment.color }"
                />
              </div>
            </div>
          </div>

          <div
            v-if="activePoint"
            class="pointer-events-none absolute top-0 z-10 flex min-w-40 flex-col gap-1 rounded-xl border border-line bg-surface p-3 shadow-overlay"
            :style="tooltipPosition"
            role="status"
          >
            <span class="text-xs font-semibold text-ink-4 first-letter:uppercase">
              {{ activePoint.title }}
            </span>
            <span
              v-for="item in series"
              :key="item.key"
              class="flex items-center gap-1.5 text-xs whitespace-nowrap text-ink-3"
            >
              <span
                class="h-0.5 w-3 rounded-full"
                :style="{ backgroundColor: item.color }"
                aria-hidden="true"
              />
              <strong class="tabular font-bold text-ink">{{ activePoint.texts[item.key] }}</strong>
              {{ item.label }}
            </span>
            <span
              v-if="activePoint.total"
              class="mt-0.5 border-t border-line-soft pt-1 text-xs whitespace-nowrap text-ink-3"
            >
              <strong class="tabular font-bold text-ink">{{ activePoint.total }}</strong>
              {{ totalLabel }}
            </span>
          </div>
        </div>

        <div class="relative mt-1.5 h-4 text-[11px] text-ink-4" aria-hidden="true">
          <template v-for="(point, index) in points" :key="point.date">
            <span
              v-if="index % labelEvery === 0"
              class="absolute -translate-x-1/2 whitespace-nowrap"
              :style="{ left: `${((index + 0.5) * 100) / points.length}%` }"
            >
              {{ point.axis }}
            </span>
          </template>
        </div>
      </div>
    </div>
  </figure>
</template>
