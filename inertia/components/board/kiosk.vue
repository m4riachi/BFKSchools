<script setup lang="ts">
/**
 * D51: the children's ordering kiosk, full screen over the board.
 * Steps: code → one choice among the dishes and today's special (same cards,
 * one pick) → one of the other supplements (if any) → confirm → done.
 * Every rule is the server's (KioskService): this only shows what it
 * answers. Inactivity closes the kiosk; "done" closes it after a moment.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '~/composables/use_i18n'
import { base64ToBytes, rawbtUrl, useUsbPrinter } from '~/composables/use_usb_printer'

type Option = {
  mealId: number
  name: string
  description: string | null
  price: string | null
  photoUrl: string | null
}
type Session = {
  token: string
  childName: string
  date: string
  /** D58: the dish cutoff has passed — the dish is fixed, only supplements can be added. */
  extrasOnly: boolean
  fixedDishName: string | null
  ordered: { name: string; quantity: number }[]
  dishes: Option[]
  specials: Option[]
  extras: Option[]
  current: { subscriptionMealId: number | null; specialMealIds: number[]; extraMealIds: number[] }
}

const props = defineProps<{ slug: string }>()
const emit = defineEmits<{ close: [] }>()

const { t, formatDate } = useI18n()
const printer = useUsbPrinter()
/** The child's ticket (ESC/POS, base64) returned with the order. */
const ticket = ref<string | null>(null)
const printState = ref<'idle' | 'printing' | 'printed' | 'failed'>('idle')
const printError = ref('')
const printFallback = computed(() => (ticket.value ? rawbtUrl(ticket.value) : null))

/**
 * Prints the ticket right after the confirmation: on the USB printer paired
 * with the board when there is one, otherwise (Android) through the RawBT
 * app, opened by URL while the confirm tap still counts as a user gesture.
 */
async function printTicket() {
  if (!ticket.value) return
  printState.value = 'printing'
  const paired = printer.device.value ?? (await printer.restore())
  if (paired) {
    try {
      await printer.print(base64ToBytes(ticket.value))
      printState.value = 'printed'
    } catch (error) {
      printError.value = `${paired.productName ?? 'USB'} — ${(error as Error).message}`
      console.error('kiosk print', error)
      printState.value = 'failed'
    }
    return
  }
  if (/android/i.test(navigator.userAgent) && printFallback.value) {
    window.location.href = printFallback.value
    printState.value = 'printed'
    return
  }
  printError.value = 'no printer paired'
  printState.value = 'failed'
}

const IDLE_MS = 60_000
const DONE_MS = 5_000

const step = ref<'pin' | 'dish' | 'extras' | 'confirm' | 'done'>('pin')
const pin = ref('')
const error = ref('')
const busy = ref(false)
const session = ref<Session | null>(null)
const dish = ref<Option | null>(null)
const specials = ref<Set<number>>(new Set())
/** The other supplements picked (any number, one portion each). */
const extras = ref<Set<number>>(new Set())
const chosenExtras = computed(() =>
  (session.value?.extras ?? []).filter((option) => extras.value.has(option.mealId))
)

/** "Tuesday 3": weekday then day number (English puts the number first otherwise). */
const dateLabel = computed(() =>
  session.value
    ? `${formatDate(session.value.date, { weekday: 'long' })} ${formatDate(session.value.date, { day: 'numeric' })}`
    : ''
)
const chosenSpecials = computed(() =>
  (session.value?.specials ?? []).filter((option) => specials.value.has(option.mealId))
)
const canContinue = computed(() => dish.value !== null || chosenSpecials.value.length > 0)
/** The supplements a child can add on the extras screen (extrasOnly adds specials). */
const addable = computed<{ option: Option; special: boolean }[]>(() =>
  session.value?.extrasOnly
    ? [
        ...(session.value?.specials ?? []).map((option) => ({ option, special: true })),
        ...(session.value?.extras ?? []).map((option) => ({ option, special: false })),
      ]
    : (session.value?.extras ?? []).map((option) => ({ option, special: false }))
)
function isAdded(option: Option, special: boolean) {
  return special ? specials.value.has(option.mealId) : extras.value.has(option.mealId)
}
function toggleAdd(option: Option, special: boolean) {
  touch()
  const set = new Set(special ? specials.value : extras.value)
  if (set.has(option.mealId)) set.delete(option.mealId)
  else set.add(option.mealId)
  if (special) specials.value = set
  else extras.value = set
}
/** Dishes and specials side by side, same cards: the child picks exactly one. */
const choices = computed(() => [
  ...(session.value?.dishes ?? []).map((option) => ({ option, special: false })),
  ...(session.value?.specials ?? []).map((option) => ({ option, special: true })),
])
function isChosen(option: Option, special: boolean) {
  return special ? specials.value.has(option.mealId) : dish.value?.mealId === option.mealId
}
function choose(option: Option, special: boolean) {
  touch()
  if (special) {
    dish.value = null
    specials.value = new Set([option.mealId])
  } else {
    dish.value = option
    specials.value = new Set()
  }
}

/* Inactivity: back to the board */
let idle: ReturnType<typeof setTimeout> | undefined
let doneTimer: ReturnType<typeof setTimeout> | undefined
function touch() {
  if (idle) clearTimeout(idle)
  idle = setTimeout(() => emit('close'), IDLE_MS)
}
onMounted(touch)
onBeforeUnmount(() => {
  if (idle) clearTimeout(idle)
  if (doneTimer) clearTimeout(doneTimer)
})

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/board/${props.slug}/kiosk/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(data.error || t('board.kiosk.error'))
  return data as T
}

function press(digit: string) {
  touch()
  error.value = ''
  if (pin.value.length < 4) pin.value += digit
  if (pin.value.length === 4) void submitPin()
}
function backspace() {
  touch()
  pin.value = pin.value.slice(0, -1)
}

async function submitPin() {
  busy.value = true
  try {
    const data = await post<Session>('session', { pin: pin.value })
    session.value = data
    extras.value = new Set(data.current.extraMealIds)
    if (data.extrasOnly) {
      // D58: the dish is fixed — the child only adds supplements.
      dish.value = null
      specials.value = new Set(data.current.specialMealIds)
      step.value = 'extras'
      return
    }
    // One pick: the current dish, else the current special.
    const current = data.dishes.find((o) => o.mealId === data.current.subscriptionMealId)
    dish.value = current ?? null
    specials.value = new Set(current ? [] : data.current.specialMealIds.slice(0, 1))
    step.value = 'dish'
    if (!data.dishes.length && !data.specials.length) {
      error.value = t('board.kiosk.no_dish')
      step.value = 'pin'
      session.value = null
    }
  } catch (caught) {
    error.value = (caught as Error).message
    pin.value = ''
  } finally {
    busy.value = false
  }
}

/** After the dish screen: the other supplements if the day has some, else the summary. */
function afterDish() {
  touch()
  if (!canContinue.value) {
    error.value = t('board.kiosk.choose_dish_first')
    return
  }
  error.value = ''
  step.value = addable.value.length ? 'extras' : 'confirm'
}
function toConfirm() {
  touch()
  step.value = 'confirm'
}
function back() {
  touch()
  error.value = ''
  if (step.value === 'confirm')
    step.value = addable.value.length ? 'extras' : session.value?.extrasOnly ? 'extras' : 'dish'
  else if (step.value === 'extras') reset()
  else if (step.value === 'dish') reset()
}
function reset() {
  step.value = 'pin'
  pin.value = ''
  session.value = null
  dish.value = null
  specials.value = new Set()
  extras.value = new Set()
  error.value = ''
}

async function confirm() {
  if (!session.value) return
  touch()
  busy.value = true
  error.value = ''
  try {
    const result = await post<{ ticket: string | null }>('order', {
      token: session.value.token,
      subscriptionMealId: dish.value?.mealId ?? null,
      specialMealIds: [...specials.value],
      extraMealIds: [...extras.value],
    })
    step.value = 'done'
    ticket.value = result.ticket
    printState.value = 'idle'
    if (ticket.value) void printTicket()
    doneTimer = setTimeout(() => emit('close'), ticket.value ? DONE_MS * 2 : DONE_MS)
  } catch (caught) {
    error.value = (caught as Error).message
  } finally {
    busy.value = false
  }
}

const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex flex-col bg-white text-ink"
    role="dialog"
    aria-modal="true"
    :aria-label="t('board.kiosk.title')"
    @click="touch"
  >
    <!-- Top bar -->
    <header class="flex items-center justify-between px-[3vmin] py-[2vmin]">
      <button
        type="button"
        class="rounded-full border border-line px-[3vmin] py-[1.2vmin] text-[2.2vmin] font-bold text-ink-3"
        @click="step === 'pin' ? emit('close') : back()"
      >
        ‹ {{ step === 'pin' ? t('board.kiosk.cancel') : t('board.kiosk.back') }}
      </button>
      <span class="text-[2.6vmin] font-extrabold">{{ t('board.kiosk.title') }}</span>
      <button
        type="button"
        class="rounded-full border border-line px-[3vmin] py-[1.2vmin] text-[2.2vmin] font-bold text-ink-3"
        @click="emit('close')"
      >
        ✕
      </button>
    </header>

    <main
      class="flex min-h-0 flex-1 flex-col items-center justify-end gap-[2.5vmin] px-[4vmin] pb-[3vmin]"
    >
      <!-- Step: code -->
      <template v-if="step === 'pin'">
        <h2 class="mt-[2vmin] text-[4.5vmin] font-extrabold">{{ t('board.kiosk.enter_pin') }}</h2>
        <p class="text-[2.2vmin] text-ink-3">{{ t('board.kiosk.pin_hint') }}</p>
        <div class="flex gap-[2vmin]" aria-hidden="true">
          <span
            v-for="i in 4"
            :key="i"
            class="flex size-[9vmin] items-center justify-center rounded-[2vmin] border-2 text-[5vmin] font-extrabold"
            :class="pin.length >= i ? 'border-brand bg-brand-wash' : 'border-line'"
            >{{ pin.length >= i ? '●' : '' }}</span
          >
        </div>
        <p v-if="error" class="text-[2.4vmin] font-bold text-danger" role="alert">{{ error }}</p>
        <div class="grid grid-cols-3 gap-[2vmin]">
          <button
            v-for="key in keys"
            :key="key"
            type="button"
            class="size-[13vmin] rounded-[3vmin] bg-subtle text-[5vmin] font-extrabold hover:bg-brand-wash active:bg-brand-tint disabled:opacity-50"
            :disabled="busy"
            @click="press(key)"
          >
            {{ key }}
          </button>
          <button
            type="button"
            class="size-[13vmin] rounded-[3vmin] text-[3vmin] font-bold text-ink-3 hover:bg-subtle"
            :aria-label="t('board.kiosk.back')"
            @click="backspace"
          >
            ⌫
          </button>
          <button
            type="button"
            class="size-[13vmin] rounded-[3vmin] bg-subtle text-[5vmin] font-extrabold hover:bg-brand-wash active:bg-brand-tint disabled:opacity-50"
            :disabled="busy"
            @click="press('0')"
          >
            0
          </button>
          <span />
        </div>
      </template>

      <!-- Step: dish + today's special, on one screen -->
      <template v-else-if="step === 'dish' && session">
        <h2 class="mt-[1vmin] text-[4vmin] font-extrabold">
          {{ t('board.kiosk.hello', { name: session.childName }) }}
        </h2>
        <p class="text-[2.6vmin] text-ink-3 first-letter:uppercase">
          {{ t('board.kiosk.choose_dish', { date: dateLabel }) }}
        </p>
        <div class="grid min-h-0 w-full flex-1 grid-cols-2 content-start gap-[2vmin] overflow-auto">
          <button
            v-for="{ option, special } in choices"
            :key="`${special ? 's' : 'd'}-${option.mealId}`"
            type="button"
            class="flex flex-col overflow-hidden rounded-[3vmin] border-4 bg-white text-left shadow-overlay"
            :class="
              isChosen(option, special)
                ? special
                  ? 'border-pink-500'
                  : 'border-brand'
                : 'border-transparent'
            "
            @click="choose(option, special)"
          >
            <span class="relative block aspect-[4/3] w-full bg-neutral-100">
              <img
                v-if="option.photoUrl"
                :src="option.photoUrl"
                alt=""
                class="absolute inset-0 size-full object-cover"
              />
              <span
                v-if="special"
                class="absolute top-[1.5vmin] left-[1.5vmin] rounded-full bg-pink-500 px-[2vmin] py-[0.6vmin] text-[2vmin] font-extrabold text-white"
                >★ {{ t('board.kiosk.special_section') }}</span
              >
              <span
                v-if="isChosen(option, special)"
                class="absolute top-[1.5vmin] right-[1.5vmin] flex size-[6vmin] items-center justify-center rounded-full text-[3vmin] font-extrabold text-white"
                :class="special ? 'bg-pink-500' : 'bg-brand'"
                aria-hidden="true"
                >✓</span
              >
            </span>
            <span class="flex flex-col gap-[0.4vmin] p-[2vmin]">
              <span class="text-[3vmin] leading-tight font-extrabold">{{ option.name }}</span>
              <span v-if="special && option.price" class="text-[2.2vmin] text-ink-3">
                {{ option.price }} · {{ t('board.kiosk.special_hint') }}
              </span>
            </span>
          </button>
        </div>
        <p v-if="error" class="text-[2.4vmin] font-bold text-danger" role="alert">{{ error }}</p>
        <button
          type="button"
          class="shrink-0 rounded-full bg-brand px-[8vmin] py-[2.2vmin] text-[3vmin] font-extrabold text-white disabled:opacity-50"
          :disabled="!canContinue"
          @click="afterDish"
        >
          {{ t('board.kiosk.continue') }} ›
        </button>
      </template>

      <!-- Step: supplements (D58: after the dish cutoff, the dish is fixed) -->
      <template v-else-if="step === 'extras' && session">
        <h2 class="mt-[1vmin] text-[4vmin] font-extrabold">
          {{
            session.extrasOnly
              ? t('board.kiosk.hello', { name: session.childName })
              : t('board.kiosk.extras_title')
          }}
        </h2>
        <!-- The dish is already chosen and can't be changed; the child adds extras -->
        <p
          v-if="session.extrasOnly && session.fixedDishName"
          class="rounded-full bg-brand-wash px-[3vmin] py-[1vmin] text-[2.4vmin] font-extrabold text-brand-strong"
        >
          ✓ {{ session.fixedDishName }}
        </p>
        <p class="text-[2.2vmin] text-ink-3">
          {{
            session.extrasOnly ? t('board.kiosk.extras_only_hint') : t('board.kiosk.extras_hint')
          }}
        </p>
        <div class="grid min-h-0 w-full flex-1 grid-cols-2 content-start gap-[2vmin] overflow-auto">
          <button
            v-for="{ option, special } in addable"
            :key="`${special ? 's' : 'e'}-${option.mealId}`"
            type="button"
            class="flex items-center gap-[2vmin] overflow-hidden rounded-[3vmin] border-4 bg-white p-[1.5vmin] text-left shadow-overlay"
            :class="
              isAdded(option, special)
                ? special
                  ? 'border-pink-500'
                  : 'border-brand'
                : 'border-transparent'
            "
            @click="toggleAdd(option, special)"
          >
            <span
              class="relative block size-[14vmin] shrink-0 overflow-hidden rounded-[2vmin] bg-neutral-100"
            >
              <img
                v-if="option.photoUrl"
                :src="option.photoUrl"
                alt=""
                class="absolute inset-0 size-full object-cover"
              />
            </span>
            <span class="flex min-w-0 flex-1 flex-col gap-[0.5vmin]">
              <span class="text-[2.8vmin] leading-tight font-extrabold">{{ option.name }}</span>
              <span v-if="option.price" class="text-[2.2vmin] text-ink-3">{{ option.price }}</span>
              <span
                class="mt-[0.5vmin] w-fit rounded-full px-[2vmin] py-[0.6vmin] text-[2vmin] font-extrabold"
                :class="isAdded(option, special) ? 'bg-brand text-white' : 'bg-subtle text-ink'"
              >
                <template v-if="special">★ </template
                >{{ isAdded(option, special) ? t('board.kiosk.added') : t('board.kiosk.add') }}
              </span>
            </span>
          </button>
        </div>
        <div class="flex shrink-0 gap-[2vmin]">
          <button
            type="button"
            class="rounded-full bg-subtle px-[5vmin] py-[2vmin] text-[2.8vmin] font-extrabold"
            @click="
              () => {
                extras = new Set()
                toConfirm()
              }
            "
          >
            {{ t('board.kiosk.skip') }}
          </button>
          <button
            type="button"
            class="rounded-full bg-brand px-[5vmin] py-[2vmin] text-[2.8vmin] font-extrabold text-white"
            @click="toConfirm"
          >
            {{ t('board.kiosk.continue') }} ›
          </button>
        </div>
      </template>

      <!-- Step: confirm -->
      <template v-else-if="step === 'confirm' && session">
        <h2 class="mt-[1vmin] text-[4vmin] font-extrabold">{{ t('board.kiosk.confirm_title') }}</h2>
        <p class="text-[2.6vmin] text-ink-3 first-letter:uppercase">
          {{ session.childName }} · {{ dateLabel }}
        </p>
        <ul class="m-0 flex w-full list-none flex-col gap-[1.5vmin] p-0">
          <li
            v-if="session.extrasOnly && session.fixedDishName"
            class="flex items-center gap-[2vmin] rounded-[2.5vmin] bg-brand-wash p-[2vmin] text-[3vmin] font-extrabold text-brand-strong"
          >
            ✓ {{ session.fixedDishName }}
          </li>
          <li
            v-if="dish"
            class="flex items-center gap-[2vmin] rounded-[2.5vmin] bg-subtle p-[2vmin] text-[3vmin] font-extrabold"
          >
            <img
              v-if="dish.photoUrl"
              :src="dish.photoUrl"
              alt=""
              class="size-[12vmin] rounded-[2vmin] object-cover"
            />
            {{ dish.name }}
          </li>
          <li
            v-for="option in chosenSpecials"
            :key="option.mealId"
            class="flex items-center gap-[2vmin] rounded-[2.5vmin] bg-pink-50 p-[2vmin] text-[2.6vmin] font-bold"
          >
            <img
              v-if="option.photoUrl"
              :src="option.photoUrl"
              alt=""
              class="size-[9vmin] rounded-[2vmin] object-cover"
            />
            <span class="flex-1">★ {{ option.name }}</span>
            <span v-if="option.price" class="text-ink-3">{{ option.price }}</span>
          </li>
          <li
            v-for="option in chosenExtras"
            :key="`e-${option.mealId}`"
            class="flex items-center gap-[2vmin] rounded-[2.5vmin] bg-subtle p-[2vmin] text-[2.6vmin] font-bold"
          >
            <img
              v-if="option.photoUrl"
              :src="option.photoUrl"
              alt=""
              class="size-[9vmin] rounded-[2vmin] object-cover"
            />
            <span class="flex-1">+ {{ option.name }}</span>
            <span v-if="option.price" class="text-ink-3">{{ option.price }}</span>
          </li>
        </ul>
        <p v-if="error" class="text-[2.4vmin] font-bold text-danger" role="alert">{{ error }}</p>
        <button
          type="button"
          class="mt-auto rounded-full bg-brand px-[8vmin] py-[2.5vmin] text-[3.2vmin] font-extrabold text-white disabled:opacity-60"
          :disabled="
            busy || (!dish && !chosenSpecials.length && !chosenExtras.length && !session.extrasOnly)
          "
          @click="confirm"
        >
          ✓ {{ t('board.kiosk.confirm') }}
        </button>
      </template>

      <!-- Step: done -->
      <template v-else-if="step === 'done' && session">
        <div class="flex flex-1 flex-col items-center justify-center gap-[3vmin] text-center">
          <span class="text-[14vmin]" aria-hidden="true">🎉</span>
          <h2 class="text-[5vmin] font-extrabold">
            {{ t('board.kiosk.done_title', { name: session.childName }) }}
          </h2>
          <p class="text-[3vmin] text-ink-3">{{ t('board.kiosk.done_body') }}</p>
          <!-- The ticket prints by itself (board's USB printer, or the Android print app) -->
          <p
            v-if="ticket && printState !== 'failed'"
            class="rounded-full bg-pink-50 px-[4vmin] py-[1.5vmin] text-[3vmin] font-extrabold text-pink-700"
          >
            🖨 {{ t('board.kiosk.take_ticket') }}
          </p>
          <template v-else-if="ticket">
            <p class="text-[2.2vmin] font-bold text-danger">
              {{ t('board.kiosk.print_failed') }}
              <span class="block text-[1.8vmin] font-semibold text-ink-3">{{ printError }}</span>
            </p>
            <a
              :href="printFallback ?? '#'"
              class="rounded-full bg-subtle px-[5vmin] py-[2vmin] text-[2.6vmin] font-extrabold text-ink no-underline"
              @click="touch"
            >
              🖨 {{ t('board.kiosk.print_button') }}
            </a>
          </template>
        </div>
      </template>
    </main>
  </div>
</template>
