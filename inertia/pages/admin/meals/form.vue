<script setup lang="ts">
import { computed, ref } from 'vue'
import { router, useForm } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import TextInput from '~/components/ui/text_input.vue'
import TextArea from '~/components/ui/text_area.vue'
import SelectInput from '~/components/ui/select_input.vue'
import CheckboxField from '~/components/ui/checkbox_field.vue'
import AppButton from '~/components/ui/app_button.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import AllergenPicker from '~/components/families/allergen_picker.vue'
import PhotoManager from '~/components/meals/photo_manager.vue'
import type { MealDetail, MealOptions, PhotoLimits } from '~/components/meals/types'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  meal: MealDetail | null
  options: MealOptions
  photoLimits: PhotoLimits
}>()

const { t } = useI18n()

const form = useForm({
  nameFr: props.meal?.nameFr ?? '',
  nameEn: props.meal?.nameEn ?? '',
  descriptionFr: props.meal?.descriptionFr ?? '',
  descriptionEn: props.meal?.descriptionEn ?? '',
  type: props.meal?.type ?? 'subscription',
  category: props.meal?.category ?? 'main',
  price: props.meal?.priceInput ?? '',
  allergens: [...(props.meal?.allergens ?? [])],
  tags: [...(props.meal?.tags ?? [])],
  isActive: props.meal?.isActive ?? true,
  externalRecipeRef: props.meal?.externalRecipeRef ?? '',
})

/** First error of an array field (`allergens` or `allergens.3`). */
function arrayError(field: string) {
  const errors = form.errors as Record<string, string | undefined>
  return (
    errors[field] ??
    Object.entries(errors).find(([key]) => key.startsWith(`${field}.`))?.[1] ??
    undefined
  )
}

function submit() {
  if (props.meal) form.put(`/admin/meals/${props.meal.id}`, { preserveScroll: true })
  else form.post('/admin/meals')
}

function toggleTag(tag: string, checked: boolean) {
  form.tags = checked ? [...form.tags, tag] : form.tags.filter((value) => value !== tag)
}

const categoryOptions = computed(() =>
  props.options.categories.map((value) => ({ value, label: t(`meals.categories.${value}`) }))
)

/* Duplicate / delete */
const duplicateOpen = ref(false)
const deleteOpen = ref(false)
const processing = ref(false)

function duplicate() {
  if (!props.meal) return
  router.post(
    `/admin/meals/${props.meal.id}/duplicate`,
    {},
    {
      onStart: () => (processing.value = true),
      onFinish: () => {
        processing.value = false
        duplicateOpen.value = false
      },
    }
  )
}

function destroy() {
  if (!props.meal) return
  router.delete(`/admin/meals/${props.meal.id}`, {
    onStart: () => (processing.value = true),
    onFinish: () => {
      processing.value = false
      deleteOpen.value = false
    },
  })
}

const typeClass = (selected: boolean) => [
  'flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-[9px] px-4 text-sm font-bold',
  selected ? 'bg-surface text-ink shadow-pressed' : 'text-ink-4 hover:text-ink',
]
</script>

<template>
  <AdminLayout>
    <div>
      <Link href="/admin/meals" class="text-[13px] font-semibold"
        >← {{ t('meals.form.back') }}</Link
      >
    </div>
    <PageHeader
      :title="meal ? t('meals.form.edit_title', { name: meal.name }) : t('meals.form.create_title')"
    >
      <template v-if="meal" #actions>
        <AppButton variant="secondary" @click="duplicateOpen = true">
          {{ t('meals.form.duplicate') }}
        </AppButton>
        <AppButton variant="danger" @click="deleteOpen = true">
          {{ t('meals.form.delete') }}
        </AppButton>
      </template>
    </PageHeader>

    <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start">
      <form class="card flex flex-col gap-5 p-5 sm:p-6" novalidate @submit.prevent="submit">
        <h2 class="text-base font-extrabold">{{ t('meals.form.details') }}</h2>

        <div class="grid gap-5 sm:grid-cols-2">
          <TextInput
            id="nameFr"
            v-model="form.nameFr"
            required
            autocomplete="off"
            :label="t('meals.form.name_fr')"
            :error="form.errors.nameFr"
          />
          <TextInput
            id="nameEn"
            v-model="form.nameEn"
            required
            autocomplete="off"
            :label="t('meals.form.name_en')"
            :error="form.errors.nameEn"
          />
        </div>

        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1.5 text-[13px] font-bold text-ink">{{ t('meals.form.type') }}</legend>
          <div class="flex gap-1 rounded-xl bg-subtle p-1">
            <label v-for="type in options.types" :key="type" :class="typeClass(form.type === type)">
              <input v-model="form.type" type="radio" name="type" :value="type" class="sr-only" />
              {{ t(`meals.types.${type}`) }}
            </label>
          </div>
          <p class="text-[13px] text-ink-4">{{ t('meals.form.type_hint') }}</p>
          <p v-if="form.errors.type" class="text-[13px] font-semibold text-danger" role="alert">
            {{ form.errors.type }}
          </p>
        </fieldset>

        <div class="grid gap-5 sm:grid-cols-2">
          <SelectInput
            id="category"
            v-model="form.category"
            required
            :options="categoryOptions"
            :label="t('meals.form.category')"
            :error="form.errors.category"
          />
          <TextInput
            id="price"
            v-model="form.price"
            required
            autocomplete="off"
            :label="t('meals.form.price')"
            :hint="t('meals.form.price_hint')"
            :placeholder="'45,00'"
            :error="form.errors.price"
          />
        </div>

        <TextArea
          id="descriptionFr"
          v-model="form.descriptionFr"
          :maxlength="2000"
          :label="t('meals.form.description_fr')"
          :hint="t('meals.form.description_hint')"
          :error="form.errors.descriptionFr"
        />
        <TextArea
          id="descriptionEn"
          v-model="form.descriptionEn"
          :maxlength="2000"
          :label="t('meals.form.description_en')"
          :error="form.errors.descriptionEn"
        />

        <AllergenPicker
          v-model="form.allergens"
          :allergens="options.allergens"
          :label="t('meals.form.allergens')"
          :hint="t('meals.form.allergens_hint')"
          :error="arrayError('allergens')"
        />

        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1.5 text-[13px] font-bold text-ink">{{ t('meals.form.tags') }}</legend>
          <div class="flex flex-wrap gap-2">
            <label
              v-for="tag in options.tags"
              :key="tag"
              class="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold"
              :class="
                form.tags.includes(tag)
                  ? 'border-brand bg-brand-soft text-brand-strong'
                  : 'border-line bg-surface text-ink-2 hover:bg-subtle'
              "
            >
              <input
                type="checkbox"
                class="m-0 size-[18px] accent-brand"
                :checked="form.tags.includes(tag)"
                @change="toggleTag(tag, ($event.target as HTMLInputElement).checked)"
              />
              {{ t(`meals.tags.${tag}`) }}
            </label>
          </div>
          <p v-if="arrayError('tags')" class="text-[13px] font-semibold text-danger" role="alert">
            {{ arrayError('tags') }}
          </p>
        </fieldset>

        <TextInput
          id="externalRecipeRef"
          v-model="form.externalRecipeRef"
          autocomplete="off"
          :label="t('meals.form.external_recipe_ref')"
          :hint="t('meals.form.external_recipe_ref_hint')"
          :error="form.errors.externalRecipeRef"
        />

        <CheckboxField
          id="isActive"
          v-model="form.isActive"
          :label="t('meals.form.is_active')"
          :hint="t('meals.form.is_active_hint')"
        />

        <div class="flex flex-wrap gap-2.5">
          <AppButton type="submit" :loading="form.processing">
            {{ meal ? t('meals.form.save') : t('meals.form.create') }}
          </AppButton>
          <AppButton variant="secondary" href="/admin/meals">{{ t('ui.cancel') }}</AppButton>
        </div>
      </form>

      <PhotoManager
        v-if="meal"
        :meal-id="meal.id"
        :meal-name="meal.name"
        :photos="meal.photos"
        :limits="photoLimits"
      />
      <section v-else class="card p-5 text-sm text-ink-4 sm:p-6">
        {{ t('meals.form.photos_after_create') }}
      </section>
    </div>

    <ConfirmDialog
      v-if="meal"
      v-model:open="duplicateOpen"
      :title="t('meals.form.duplicate_title')"
      :message="t('meals.form.duplicate_body', { name: meal.name })"
      :confirm-label="t('meals.form.duplicate_confirm')"
      :processing="processing"
      @confirm="duplicate"
    />
    <ConfirmDialog
      v-if="meal"
      v-model:open="deleteOpen"
      danger
      :title="t('meals.form.delete_title')"
      :message="t('meals.form.delete_body', { name: meal.name })"
      :confirm-label="t('meals.form.delete_confirm')"
      :processing="processing"
      @confirm="destroy"
    />
  </AdminLayout>
</template>
