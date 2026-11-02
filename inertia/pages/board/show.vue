<script setup lang="ts">
/**
 * School display board (D46): one layout, made for the portrait screen at
 * the school (490 × 1800 mm), opened on its public address, no login. Shows
 * the published menu two dishes at a time, side by side — the whole photo,
 * never cropped — with the day's supplements under them; after the last
 * dishes, the next day.
 * Slides change on their own; the menu reloads every minute
 * (SchoolBoardService). Sizes follow the narrow side of the screen (vmin).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Head, usePoll } from '@inertiajs/vue3'
import InstallButton from '~/components/ui/install_button.vue'
import { useI18n } from '~/composables/use_i18n'

type BoardMeal = {
  mealId: number
  name: string
  description: string | null
  mealType: 'subscription' | 'supplement'
  photoUrl: string | null
}
type BoardDay = {
  date: string
  holiday: string | null
  dishes: BoardMeal[]
  supplements: BoardMeal[]
}

const props = defineProps<{
  schoolName: string
  board: { weekStart: string; today: string; published: boolean; days: BoardDay[] }
}>()

// Always English: BoardController overrides the shared locale.
const { t, formatDate, locale } = useI18n()

// Bound on purpose: Vite would resolve a literal `src` as a module import, and
// these files are served by the app from `public/`, outside Vite's root.
// The SVG animates on its own (intro, then the chef, lid and steam loop).
const logoUrl = '/bfk-logo-animated.svg'
const schoolLogoUrl = '/logo-academy.png'
const watermarkUrl = '/logo-bfk.png'

/** Seconds each pair of dishes stays on screen. */
const SLIDE_SECONDS = 10
/** Dishes shown side by side on one slide. */
const PER_SLIDE = 2

usePoll(60_000, { only: ['board'] })

type Slide = {
  key: string
  day: BoardDay
  /** Empty on a holiday or a day without dishes: the day gets one slide. */
  dishes: BoardMeal[]
  /** Position of the first dish in the day's menu. */
  offset: number
}
/** One slide per pair of dishes, in day order; the week is read in that order. */
const slides = computed<Slide[]>(() =>
  props.board.days.flatMap((day): Slide[] => {
    if (day.holiday || !day.dishes.length) return [{ key: day.date, day, dishes: [], offset: 0 }]
    const groups: Slide[] = []
    for (let offset = 0; offset < day.dishes.length; offset += PER_SLIDE) {
      groups.push({
        key: `${day.date}-${offset}`,
        day,
        dishes: day.dishes.slice(offset, offset + PER_SLIDE),
        offset,
      })
    }
    return groups
  })
)
const startIndex = () => {
  const today = slides.value.findIndex((slide) => slide.day.date === props.board.today)
  return today >= 0 ? today : 0
}
const current = ref(startIndex())
const slide = computed(() => slides.value[Math.min(current.value, slides.value.length - 1)])
const day = computed(() => slide.value?.day)

// `cycle` restarts the progress bar animation on every slide change.
const cycle = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
function restart() {
  if (timer) clearInterval(timer)
  cycle.value += 1
  timer = setInterval(next, SLIDE_SECONDS * 1000)
}
function next() {
  if (!slides.value.length) return
  current.value = (current.value + 1) % slides.value.length
  cycle.value += 1
}
watch(
  () => props.board.weekStart,
  () => {
    current.value = startIndex()
    restart()
  }
)

const clock = ref('')
let clockTimer: ReturnType<typeof setInterval> | undefined
function tick() {
  clock.value = new Intl.DateTimeFormat(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Casablanca',
  }).format(new Date())
}

const isFullscreen = ref(false)
function syncFullscreen() {
  isFullscreen.value = Boolean(document.fullscreenElement)
}
async function fullscreen() {
  try {
    await document.documentElement.requestFullscreen()
  } catch {
    // Not allowed (iframe, old TV browser): the page still works windowed.
  }
}

onMounted(() => {
  restart()
  tick()
  clockTimer = setInterval(tick, 10_000)
  document.addEventListener('fullscreenchange', syncFullscreen)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  if (clockTimer) clearInterval(clockTimer)
  document.removeEventListener('fullscreenchange', syncFullscreen)
})

/** "Monday 2": weekday and day number, no month. */
function dayLabel(date: string) {
  return `${formatDate(date, { weekday: 'long' })} ${formatDate(date, { day: 'numeric' })}`
}

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase()
}
</script>

<template>
  <Head :title="t('board.title')" />
  <div
    class="board relative isolate flex h-dvh flex-col gap-[2vmin] overflow-hidden bg-white px-[3vmin] py-[2vmin] text-ink"
  >
    <!-- Watermark: the logo tiled faintly over the white background, drifting slowly -->
    <div
      class="board-watermark pointer-events-none absolute -inset-[20%] -z-10"
      :style="{ backgroundImage: `url(${watermarkUrl})` }"
      aria-hidden="true"
    />

    <!-- Header: BFK on the left, the school on the right, the day between -->
    <header class="flex items-center justify-between gap-[2vmin]">
      <div class="board-logo shrink-0 rounded-[2vmin] bg-white px-[1.5vmin] py-[0.8vmin]">
        <img
          :src="logoUrl"
          alt="Beldi Fusion Kitchen"
          width="437"
          height="285"
          class="h-[8vmin] w-auto object-contain"
        />
      </div>
      <!-- The day on screen: weekday and day number only -->
      <div class="flex min-w-0 flex-1 flex-col items-center text-center">
        <div class="flex items-center justify-center gap-[1.5vmin]">
          <h1
            class="text-[4.4vmin] leading-tight font-extrabold tracking-[-0.02em] first-letter:uppercase"
          >
            {{ day ? dayLabel(day.date) : t('board.title') }}
          </h1>
          <span
            v-if="day && day.date === board.today"
            class="rounded-full bg-pink-500 px-[1.5vmin] py-[0.5vmin] text-[1.7vmin] font-bold text-white"
            >{{ t('board.today') }}</span
          >
        </div>
        <span
          class="tabular mt-[0.8vmin] rounded-full bg-black/5 px-[2vmin] py-[0.4vmin] text-[2.6vmin] font-extrabold"
        >
          {{ clock }}
        </span>
        <!-- Shown only where the browser can install the app (phone, tablet, laptop). -->
        <InstallButton variant="pill" :auto-open="false" class="mt-[1vmin]" />
      </div>
      <div class="board-logo shrink-0 rounded-[2vmin] bg-white px-[1.5vmin] py-[0.8vmin]">
        <img
          :src="schoolLogoUrl"
          :alt="schoolName"
          width="631"
          height="160"
          class="h-[8vmin] w-auto object-contain"
        />
      </div>
    </header>

    <!-- Slide: one dish of one day -->
    <Transition name="board-slide" mode="out-in">
      <main
        v-if="!board.published || !slide"
        key="not-published"
        class="flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl bg-black/5 p-10 text-center"
      >
        <span class="text-[8vmin]" aria-hidden="true">🍽️</span>
        <span class="text-[3.4vmin] font-extrabold">{{ t('board.not_published') }}</span>
      </main>

      <main v-else :key="slide.key" class="flex min-h-0 flex-1 flex-col gap-[2vmin]">
        <!-- Slide timer -->
        <div class="h-[1vmin] w-full overflow-hidden rounded-full bg-black/10" aria-hidden="true">
          <span
            :key="cycle"
            class="board-progress block h-full rounded-full bg-pink-500"
            :style="{ animationDuration: `${SLIDE_SECONDS}s` }"
          />
        </div>

        <div
          v-if="slide.day.holiday"
          class="flex flex-1 flex-col items-center justify-center gap-3 rounded-3xl bg-black/5 p-10 text-center"
        >
          <span class="text-[10vmin]" aria-hidden="true">🎉</span>
          <span class="text-[4.5vmin] font-extrabold">{{ t('board.holiday') }}</span>
          <span class="text-[2.6vmin] text-ink-3">{{ slide.day.holiday }}</span>
        </div>

        <div
          v-else-if="!slide.dishes.length"
          class="flex flex-1 items-center justify-center rounded-3xl bg-black/5 p-10 text-[3vmin] font-bold text-ink-3"
        >
          {{ t('board.no_menu') }}
        </div>

        <template v-else>
          <!-- Two dishes side by side: the whole photo, never cropped, then the name -->
          <section class="flex min-h-0 flex-1 flex-col gap-[1.2vmin]">
            <div class="flex items-center justify-between">
              <h3 class="text-[1.9vmin] font-bold tracking-[0.12em] text-ink-3 uppercase">
                {{ t('board.dishes') }}
              </h3>
              <span class="flex gap-[0.8vmin]" aria-hidden="true">
                <span
                  v-for="(dish, dot) in slide.day.dishes"
                  :key="dish.mealId"
                  class="h-[1.2vmin] rounded-full transition-all duration-300"
                  :class="
                    dot >= slide.offset && dot < slide.offset + slide.dishes.length
                      ? 'w-[4vmin] bg-brand'
                      : 'w-[1.2vmin] bg-black/15'
                  "
                />
              </span>
            </div>
            <div class="grid min-h-0 flex-1 grid-cols-2 gap-[1.6vmin]">
              <article
                v-for="(dish, index) in slide.dishes"
                :key="dish.mealId"
                class="board-card relative flex min-h-0 flex-col overflow-hidden rounded-[3vmin] bg-white shadow-overlay ring-1 ring-black/10"
                :style="{ '--i': index }"
              >
                <div class="relative min-h-0 flex-1 bg-neutral-100">
                  <img
                    v-if="dish.photoUrl"
                    :src="dish.photoUrl"
                    alt=""
                    class="board-photo absolute inset-0 size-full object-contain"
                    :style="{ animationDelay: `${index * 1.3}s` }"
                  />
                  <span
                    v-else
                    class="absolute inset-0 flex items-center justify-center text-[16vmin] font-extrabold text-brand"
                    aria-hidden="true"
                    >{{ initial(dish.name) }}</span
                  >
                  <span
                    class="absolute top-[1.6vmin] left-[1.6vmin] flex size-[5vmin] items-center justify-center rounded-full bg-brand text-[2.6vmin] font-extrabold text-white shadow-overlay"
                    aria-hidden="true"
                    >{{ slide.offset + index + 1 }}</span
                  >
                </div>
                <div class="flex shrink-0 flex-col gap-[0.5vmin] px-[2.2vmin] py-[1.8vmin]">
                  <span class="text-[3.6vmin] leading-[1.1] font-extrabold text-balance">{{
                    dish.name
                  }}</span>
                  <span
                    v-if="dish.description"
                    class="line-clamp-2 text-[2vmin] leading-snug text-ink-3"
                    >{{ dish.description }}</span
                  >
                </div>
              </article>
            </div>
          </section>

          <!-- Supplements of the day: a compact grid -->
          <section v-if="slide.day.supplements.length" class="flex shrink-0 flex-col gap-[1.2vmin]">
            <h3 class="text-[1.9vmin] font-bold tracking-[0.12em] text-ink-3 uppercase">
              {{ t('board.supplements') }}
            </h3>
            <div class="grid grid-cols-2 gap-[1.2vmin]">
              <article
                v-for="(meal, index) in slide.day.supplements"
                :key="`x-${meal.mealId}`"
                class="board-card flex items-center gap-[1.4vmin] rounded-[2vmin] bg-white p-[0.9vmin] pr-[2vmin] shadow-overlay ring-1 ring-black/10"
                :style="{ '--i': index }"
              >
                <img
                  v-if="meal.photoUrl"
                  :src="meal.photoUrl"
                  alt=""
                  class="size-[7vmin] shrink-0 rounded-[1.4vmin] object-cover"
                />
                <span
                  v-else
                  class="flex size-[7vmin] shrink-0 items-center justify-center rounded-[1.4vmin] bg-pink-100 text-[2.6vmin] font-extrabold text-pink-700"
                  aria-hidden="true"
                  >{{ initial(meal.name) }}</span
                >
                <span class="min-w-0 flex-1 text-[2.2vmin] leading-tight font-bold text-balance">{{
                  meal.name
                }}</span>
              </article>
            </div>
          </section>
        </template>
      </main>
    </Transition>

    <button
      v-if="!isFullscreen"
      type="button"
      class="absolute right-[1vmin] bottom-[1vmin] rounded-lg border border-black/15 px-[1.2vmin] py-[0.5vmin] text-[1.3vmin] font-bold text-ink-3 hover:bg-black/5"
      @click="fullscreen"
    >
      {{ t('board.fullscreen') }}
    </button>
  </div>
</template>

<style scoped>
.board-progress {
  animation-name: board-progress;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
@keyframes board-progress {
  from {
    width: 0;
  }
  to {
    width: 100%;
  }
}

/* Logo tiled over the white, on a low opacity, rotated and drifting. */
.board-watermark {
  background-repeat: repeat;
  background-size: 18vw auto;
  background-position: 0 0;
  opacity: 0.05;
  transform: rotate(-12deg);
  animation: board-watermark-drift 90s linear infinite;
}
@keyframes board-watermark-drift {
  from {
    background-position: 0 0;
  }
  to {
    background-position: 18vw 11.7vw;
  }
}

/* The logos on white panels, lifted by a soft shadow, with a slow breath. */
.board-logo {
  box-shadow: 0 1.5vmin 4vmin rgba(0, 0, 0, 0.18);
  animation: board-logo-glow 4s ease-in-out infinite alternate;
}
@keyframes board-logo-glow {
  from {
    transform: scale(1);
    box-shadow: 0 1.5vmin 4vmin rgba(0, 0, 0, 0.18);
  }
  to {
    transform: scale(1.03);
    box-shadow: 0 2vmin 5vmin rgba(0, 0, 0, 0.26);
  }
}

.board-card {
  animation: board-card-in 0.7s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
  animation-delay: calc(var(--i, 0) * 120ms);
}
@keyframes board-card-in {
  from {
    opacity: 0;
    transform: translateY(5vmin) scale(0.94);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* A very slow breath on the photo so the screen never looks frozen (never cropped). */
.board-photo {
  animation: board-photo-drift 8s ease-in-out infinite alternate;
}
@keyframes board-photo-drift {
  from {
    transform: scale(0.97);
  }
  to {
    transform: scale(1);
  }
}

.board-slide-enter-active,
.board-slide-leave-active {
  transition:
    opacity 0.5s ease,
    transform 0.5s ease;
}
.board-slide-enter-from {
  opacity: 0;
  transform: translateX(6vw);
}
.board-slide-leave-to {
  opacity: 0;
  transform: translateX(-6vw);
}

@media (prefers-reduced-motion: reduce) {
  .board-card,
  .board-progress,
  .board-photo,
  .board-logo,
  .board-watermark {
    animation: none;
  }
  .board-slide-enter-active,
  .board-slide-leave-active {
    transition: none;
  }
}
</style>
