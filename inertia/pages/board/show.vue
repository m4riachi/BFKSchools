<script setup lang="ts">
/**
 * School display board (D46): one layout, made for the portrait screen at
 * the school (490 × 1800 mm), opened on its public address, no login. Shows
 * the published menu one day at a time: each main dish is a card filled by
 * its photo, then the supplements. Slides change on their own; the menu
 * reloads every minute (SchoolBoardService). Sizes follow the narrow side of
 * the screen (vmin).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Head, usePoll } from '@inertiajs/vue3'
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

/** Seconds each day stays on screen. */
const SLIDE_SECONDS = 15

usePoll(60_000, { only: ['board'] })

const days = computed(() => props.board.days)
const startIndex = () => {
  const today = days.value.findIndex((day) => day.date === props.board.today)
  return today >= 0 ? today : 0
}
const current = ref(startIndex())
const day = computed(() => days.value[Math.min(current.value, days.value.length - 1)])

// `cycle` restarts the progress bar animation on every slide change.
const cycle = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
function restart() {
  if (timer) clearInterval(timer)
  cycle.value += 1
  timer = setInterval(next, SLIDE_SECONDS * 1000)
}
function next() {
  if (!days.value.length) return
  current.value = (current.value + 1) % days.value.length
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
    class="board relative isolate flex h-dvh flex-col gap-[2vmin] overflow-hidden bg-neutral-950 px-[3vmin] py-[2vmin] text-white"
  >
    <!-- Watermark: the logo tiled faintly over the black background, drifting slowly -->
    <div
      class="board-watermark pointer-events-none absolute -inset-[20%] -z-10"
      :style="{ backgroundImage: `url(${watermarkUrl})` }"
      aria-hidden="true"
    />

    <!-- Header: BFK on the left, the school on the right, the title between -->
    <header class="flex items-center justify-between gap-[2vmin]">
      <div
        class="board-logo shrink-0 rounded-[2vmin] bg-white/85 px-[1.5vmin] py-[0.8vmin] backdrop-blur"
      >
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
          class="tabular mt-[0.8vmin] rounded-full bg-white/10 px-[2vmin] py-[0.4vmin] text-[2.6vmin] font-extrabold"
        >
          {{ clock }}
        </span>
      </div>
      <div
        class="board-logo shrink-0 rounded-[2vmin] bg-white/85 px-[1.5vmin] py-[0.8vmin] backdrop-blur"
      >
        <img
          :src="schoolLogoUrl"
          :alt="schoolName"
          width="631"
          height="160"
          class="h-[8vmin] w-auto object-contain"
        />
      </div>
    </header>

    <!-- Slide -->
    <Transition name="board-slide" mode="out-in">
      <main
        v-if="!board.published || !day"
        key="not-published"
        class="flex flex-1 flex-col items-center justify-center gap-4 rounded-3xl bg-white/10 p-10 text-center"
      >
        <span class="text-[8vmin]" aria-hidden="true">🍽️</span>
        <span class="text-[3.4vmin] font-extrabold">{{ t('board.not_published') }}</span>
      </main>

      <main v-else :key="day.date" class="flex min-h-0 flex-1 flex-col gap-[2vmin]">
        <!-- Slide timer -->
        <div class="h-[1vmin] w-full overflow-hidden rounded-full bg-white/15" aria-hidden="true">
          <span
            :key="cycle"
            class="board-progress block h-full rounded-full bg-pink-500"
            :style="{ animationDuration: `${SLIDE_SECONDS}s` }"
          />
        </div>

        <div
          v-if="day.holiday"
          class="flex flex-1 flex-col items-center justify-center gap-3 rounded-3xl bg-white/10 p-10 text-center"
        >
          <span class="text-[10vmin]" aria-hidden="true">🎉</span>
          <span class="text-[4.5vmin] font-extrabold">{{ t('board.holiday') }}</span>
          <span class="text-[2.6vmin] text-white/80">{{ day.holiday }}</span>
        </div>

        <div
          v-else-if="!day.dishes.length && !day.supplements.length"
          class="flex flex-1 items-center justify-center rounded-3xl bg-white/10 p-10 text-[3vmin] font-bold text-white/80"
        >
          {{ t('board.no_menu') }}
        </div>

        <template v-else>
          <!-- Main dishes: stacked cards sharing the height, each filled by its photo -->
          <section class="flex min-h-0 flex-1 flex-col gap-[1.6vmin]">
            <h3 class="text-[1.9vmin] font-bold tracking-[0.12em] text-white/70 uppercase">
              {{ t('board.dishes') }}
            </h3>
            <div
              class="board-dishes grid min-h-0 flex-1 gap-[1.6vmin]"
              :style="{ '--n': day.dishes.length }"
            >
              <article
                v-for="(meal, index) in day.dishes"
                :key="`d-${meal.mealId}`"
                class="board-card relative min-h-0 overflow-hidden rounded-[2.5vmin] bg-brand-wash shadow-overlay"
                :style="{ '--i': index }"
              >
                <img
                  v-if="meal.photoUrl"
                  :src="meal.photoUrl"
                  alt=""
                  class="board-photo absolute inset-0 size-full object-cover"
                  :style="{ animationDelay: `${index * 1.3}s` }"
                />
                <span
                  v-else
                  class="absolute inset-0 flex items-center justify-center text-[14vmin] font-extrabold text-brand"
                  aria-hidden="true"
                  >{{ initial(meal.name) }}</span
                >
                <span
                  class="absolute top-[1.6vmin] left-[1.6vmin] flex size-[5vmin] items-center justify-center rounded-full bg-brand text-[2.6vmin] font-extrabold text-white shadow-overlay"
                  aria-hidden="true"
                  >{{ index + 1 }}</span
                >
                <!-- Name over the bottom of the photo -->
                <div
                  class="absolute inset-x-0 bottom-0 flex flex-col gap-[0.4vmin] bg-gradient-to-t from-black/80 via-black/50 to-transparent px-[3vmin] pt-[6vmin] pb-[2.2vmin] text-white"
                >
                  <span
                    class="text-[4.4vmin] leading-[1.1] font-extrabold text-balance drop-shadow"
                    >{{ meal.name }}</span
                  >
                  <span
                    v-if="meal.description"
                    class="line-clamp-1 text-[2.1vmin] leading-snug text-white/85"
                    >{{ meal.description }}</span
                  >
                </div>
              </article>
            </div>
          </section>

          <!-- Supplements: a compact grid -->
          <section v-if="day.supplements.length" class="flex shrink-0 flex-col gap-[1.2vmin]">
            <h3 class="text-[1.9vmin] font-bold tracking-[0.12em] text-white/70 uppercase">
              {{ t('board.supplements') }}
            </h3>
            <div class="grid grid-cols-2 gap-[1.2vmin]">
              <article
                v-for="(meal, index) in day.supplements"
                :key="`x-${meal.mealId}`"
                class="board-card flex items-center gap-[1.4vmin] rounded-[2vmin] bg-white/10 p-[0.9vmin] pr-[2vmin] backdrop-blur"
                :style="{ '--i': index + day.dishes.length }"
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
      class="absolute right-[1vmin] bottom-[1vmin] rounded-lg border border-white/20 px-[1.2vmin] py-[0.5vmin] text-[1.3vmin] font-bold text-white/60 hover:bg-white/10 hover:text-white"
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

/* Logo tiled over the black, white on a low opacity, rotated and drifting. */
.board-watermark {
  background-repeat: repeat;
  background-size: 18vw auto;
  background-position: 0 0;
  opacity: 0.09;
  filter: invert(1);
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

/* The restaurant's logo on a translucent panel, lifted by a shadow, with a slow glow. */
.board-logo {
  box-shadow: 0 2.5vmin 6vmin rgba(0, 0, 0, 0.45);
  animation: board-logo-glow 4s ease-in-out infinite alternate;
}
@keyframes board-logo-glow {
  from {
    transform: scale(1);
    box-shadow: 0 2.5vmin 6vmin rgba(0, 0, 0, 0.45);
  }
  to {
    transform: scale(1.03);
    box-shadow:
      0 3vmin 8vmin rgba(0, 0, 0, 0.55),
      0 0 6vmin 0.6vmin rgba(255, 255, 255, 0.25);
  }
}

/* Dishes: one per row, the rows sharing the height equally. */
.board-dishes {
  grid-template-rows: repeat(var(--n), minmax(0, 1fr));
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

/* A very slow zoom on the photos so the screen never looks frozen. */
.board-photo {
  animation: board-photo-drift 14s ease-in-out infinite alternate;
}
@keyframes board-photo-drift {
  from {
    transform: scale(1);
  }
  to {
    transform: scale(1.06);
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
