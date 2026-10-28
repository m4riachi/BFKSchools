<script setup lang="ts">
/**
 * Photos of a meal: drag-and-drop (or pick) several files, reorder by
 * dragging (or with the arrow buttons — keyboard accessible), choose the
 * cover, delete. Every rule (types, sizes, counts, single cover) is
 * enforced by the server; the checks here only save a round trip.
 */
import { computed, ref, watch } from 'vue'
import { router } from '@inertiajs/vue3'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import type { MealPhotoRow, PhotoLimits } from '~/components/meals/types'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  mealId: number
  mealName: string
  photos: MealPhotoRow[]
  limits: PhotoLimits
}>()

const { t } = useI18n()
const base = computed(() => `/admin/meals/${props.mealId}/photos`)
const sizeMb = computed(() => Math.round(props.limits.maxFileBytes / (1024 * 1024)))
const full = computed(() => props.photos.length >= props.limits.maxPerMeal)

/* Upload ------------------------------------------------------------------ */
const input = ref<HTMLInputElement>()
const dragOver = ref(false)
const uploading = ref(false)
const progress = ref<number | null>(null)
const clientError = ref<string | null>(null)

const accepted = computed(() => props.limits.accept.split(','))

function upload(list: FileList | File[] | null | undefined) {
  clientError.value = null
  const files = Array.from(list ?? [])
  if (!files.length || uploading.value) return

  if (files.length > props.limits.maxFilesPerUpload) {
    clientError.value = t('meals.photos.errors.too_many_files', {
      max: props.limits.maxFilesPerUpload,
    })
    return
  }
  if (props.photos.length + files.length > props.limits.maxPerMeal) {
    clientError.value = t('meals.photos.errors.meal_full', { max: props.limits.maxPerMeal })
    return
  }
  for (const file of files) {
    if (file.type && !accepted.value.includes(file.type)) {
      clientError.value = t('meals.photos.errors.type', { name: file.name })
      return
    }
    if (file.size > props.limits.maxFileBytes) {
      clientError.value = t('meals.photos.errors.too_large', { name: file.name, max: sizeMb.value })
      return
    }
  }

  router.post(
    base.value,
    { photos: files },
    {
      forceFormData: true,
      preserveScroll: true,
      onStart: () => (uploading.value = true),
      onProgress: (event) => (progress.value = event?.percentage ?? null),
      onFinish: () => {
        uploading.value = false
        progress.value = null
        if (input.value) input.value.value = ''
      },
    }
  )
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  if (dragging.value !== null) return
  upload(event.dataTransfer?.files)
}

function onDragOver(event: DragEvent) {
  if (dragging.value !== null || full.value) return
  if (event.dataTransfer?.types.includes('Files')) dragOver.value = true
}

/* Reorder ----------------------------------------------------------------- */
const order = ref<MealPhotoRow[]>([...props.photos])
watch(
  () => props.photos,
  (photos) => (order.value = [...photos])
)
const dragging = ref<number | null>(null)

function move(from: number, to: number) {
  if (to < 0 || to >= order.value.length || from === to) return
  const next = [...order.value]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  order.value = next
  saveOrder()
}

function saveOrder() {
  router.put(
    `${base.value}/order`,
    { ids: order.value.map((photo) => photo.id) },
    { preserveScroll: true, onError: () => (order.value = [...props.photos]) }
  )
}

function onPhotoDragStart(index: number, event: DragEvent) {
  dragging.value = index
  event.dataTransfer?.setData('text/plain', String(order.value[index].id))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onPhotoDrop(index: number) {
  if (dragging.value === null) return
  const from = dragging.value
  dragging.value = null
  move(from, index)
}

/* Cover / delete ---------------------------------------------------------- */
function setCover(photo: MealPhotoRow) {
  router.post(`${base.value}/${photo.id}/cover`, {}, { preserveScroll: true })
}

const deleting = ref<MealPhotoRow | null>(null)
const deleteOpen = ref(false)
const deleteProcessing = ref(false)

function askDelete(photo: MealPhotoRow) {
  deleting.value = photo
  deleteOpen.value = true
}

function destroy() {
  if (!deleting.value) return
  router.delete(`${base.value}/${deleting.value.id}`, {
    preserveScroll: true,
    onStart: () => (deleteProcessing.value = true),
    onFinish: () => {
      deleteProcessing.value = false
      deleteOpen.value = false
    },
  })
}

const iconButton =
  'flex size-9 items-center justify-center rounded-[10px] border border-line-strong bg-surface text-ink-2 hover:bg-subtle disabled:opacity-40'
</script>

<template>
  <section class="card flex flex-col gap-5 p-5 sm:p-6" :aria-label="t('meals.photos.title')">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <div class="flex flex-col gap-1">
        <h2 class="text-base font-extrabold">{{ t('meals.photos.title') }}</h2>
        <p class="text-[13px] text-ink-4">{{ t('meals.photos.description') }}</p>
      </div>
      <span class="tabular text-[13px] font-semibold text-ink-4">
        {{ t('meals.photos.count', { count: photos.length, max: limits.maxPerMeal }) }}
      </span>
    </div>

    <!-- Drop zone -->
    <div
      class="flex flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed px-4 py-7 text-center"
      :class="[
        dragOver ? 'border-brand bg-brand-soft' : 'border-[#B9C6BF] bg-surface',
        full ? 'opacity-60' : '',
      ]"
      @dragover.prevent="onDragOver"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <svg
        class="size-7 text-brand-strong"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 16V4M7 9l5-5 5 5" />
        <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
      </svg>
      <template v-if="uploading">
        <p class="text-sm font-bold" role="status">
          {{ t('meals.photos.uploading') }}<span v-if="progress !== null"> {{ progress }} %</span>
        </p>
      </template>
      <template v-else-if="full">
        <p class="text-sm font-bold">{{ t('meals.photos.full_limit') }}</p>
      </template>
      <template v-else>
        <p class="text-sm font-bold">{{ t('meals.photos.drop') }}</p>
        <span class="text-xs text-ink-4">{{ t('meals.photos.or') }}</span>
        <label
          class="inline-flex h-9 cursor-pointer items-center rounded-[10px] border border-line-strong bg-surface px-3 text-[13px] font-bold text-ink hover:bg-subtle focus-within:outline-2 focus-within:outline-brand"
        >
          {{ t('meals.photos.choose') }}
          <input
            ref="input"
            type="file"
            multiple
            class="sr-only"
            :accept="limits.accept"
            @change="upload(($event.target as HTMLInputElement).files)"
          />
        </label>
      </template>
      <p class="text-xs text-ink-4">
        {{
          t('meals.photos.rules', {
            size: sizeMb,
            files: limits.maxFilesPerUpload,
            total: limits.maxPerMeal,
          })
        }}
      </p>
      <p v-if="clientError" class="text-[13px] font-semibold text-danger" role="alert">
        {{ clientError }}
      </p>
    </div>

    <!-- Photos -->
    <p v-if="order.length === 0" class="text-sm text-ink-4">{{ t('meals.photos.empty') }}</p>
    <template v-else>
      <p v-if="order.length > 1" class="text-xs text-ink-4">{{ t('meals.photos.drag_hint') }}</p>
      <ol class="grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 xl:grid-cols-4">
        <li
          v-for="(photo, index) in order"
          :key="photo.id"
          draggable="true"
          class="flex cursor-grab flex-col overflow-hidden rounded-xl border bg-surface"
          :class="[
            photo.isCover ? 'border-brand ring-1 ring-brand' : 'border-line',
            dragging === index ? 'opacity-50' : '',
          ]"
          @dragstart="onPhotoDragStart(index, $event)"
          @dragend="dragging = null"
          @dragover.prevent
          @drop.prevent.stop="onPhotoDrop(index)"
        >
          <div class="relative aspect-[4/3] bg-subtle">
            <img
              :src="photo.thumbUrl"
              :alt="t('meals.photos.alt', { position: index + 1, name: mealName })"
              loading="lazy"
              draggable="false"
              class="size-full object-cover"
            />
            <span v-if="photo.isCover" class="absolute top-2 left-2">
              <StatusBadge tone="brand" solid>{{ t('meals.photos.cover') }}</StatusBadge>
            </span>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-1.5 p-2">
            <div class="flex gap-1">
              <button
                type="button"
                :class="iconButton"
                :disabled="index === 0"
                :aria-label="t('meals.photos.move_before', { position: index + 1 })"
                @click="move(index, index - 1)"
              >
                <svg
                  class="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
              <button
                type="button"
                :class="iconButton"
                :disabled="index === order.length - 1"
                :aria-label="t('meals.photos.move_after', { position: index + 1 })"
                @click="move(index, index + 1)"
              >
                <svg
                  class="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>
            <div class="flex gap-1">
              <button
                v-if="!photo.isCover"
                type="button"
                :class="iconButton"
                :title="t('meals.photos.set_cover')"
                :aria-label="t('meals.photos.set_cover_label', { position: index + 1 })"
                @click="setCover(photo)"
              >
                <svg
                  class="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path
                    d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
                  />
                </svg>
              </button>
              <button
                type="button"
                :class="[iconButton, 'text-danger hover:text-danger-ink']"
                :title="t('meals.photos.delete')"
                :aria-label="t('meals.photos.delete_label', { position: index + 1 })"
                @click="askDelete(photo)"
              >
                <svg
                  class="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  aria-hidden="true"
                >
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                </svg>
              </button>
            </div>
          </div>
        </li>
      </ol>
    </template>

    <ConfirmDialog
      v-model:open="deleteOpen"
      danger
      :title="t('meals.photos.delete_title')"
      :message="t('meals.photos.delete_body')"
      :confirm-label="t('meals.photos.delete')"
      :processing="deleteProcessing"
      @confirm="destroy"
    />
  </section>
</template>
