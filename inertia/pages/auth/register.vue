<script setup lang="ts">
/**
 * D59: public sign-up form reached from the school's QR code. The server
 * decides everything (which fields count, duplicates, the final status);
 * this page only collects the parent's details and their children.
 */
import { computed, ref } from 'vue'
import { Head, useForm, usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import GuestLayout from '~/layouts/guest_layout.vue'
import TextInput from '~/components/ui/text_input.vue'
import TextArea from '~/components/ui/text_area.vue'
import SelectInput from '~/components/ui/select_input.vue'
import AppButton from '~/components/ui/app_button.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import AllergenPicker from '~/components/families/allergen_picker.vue'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  action: string
  schoolName: string
  sent: boolean
  fields: { grade: boolean; className: boolean; allergens: boolean }
  allergens: string[]
  maxChildren: number
  minLength: number
}>()

const { t } = useI18n()
const page = usePage()
const flashError = computed(() => page.flash?.error)

type ChildForm = {
  firstName: string
  lastName: string
  grade: string
  className: string
  allergies: string[]
  dietaryNotes: string
}
const emptyChild = (): ChildForm => ({
  firstName: '',
  lastName: '',
  grade: '',
  className: '',
  allergies: [],
  dietaryNotes: '',
})

const form = useForm({
  website: '',
  fullName: '',
  email: '',
  phone: '',
  locale: page.props.locale === 'en' ? 'en' : 'fr',
  password: '',
  password_confirmation: '',
  children: [emptyChild()] as ChildForm[],
})
const showPassword = ref(false)

const errors = computed(() => form.errors as Record<string, string | undefined>)
function childError(index: number, field: string) {
  return errors.value[`children.${index}.${field}`]
}
function allergyError(index: number) {
  const prefix = `children.${index}.allergies`
  return Object.entries(errors.value).find(([key]) => key.startsWith(prefix))?.[1]
}

function addChild() {
  if (form.children.length < props.maxChildren) form.children.push(emptyChild())
}
function removeChild(index: number) {
  if (form.children.length > 1) form.children.splice(index, 1)
}

const localeOptions = computed(() => [
  { value: 'fr', label: t('families.parent_form.locale_fr') },
  { value: 'en', label: t('families.parent_form.locale_en') },
])

/** Mirrors the server rule (app/validators/rules.ts); the server decides. */
const rules = computed(() => [
  {
    key: 'length',
    ok: form.password.length >= props.minLength,
    label: t('auth.set_password.rule_length', { min: props.minLength }),
  },
  { key: 'letter', ok: /\p{L}/u.test(form.password), label: t('auth.set_password.rule_letter') },
  { key: 'digit', ok: /\p{N}/u.test(form.password), label: t('auth.set_password.rule_digit') },
  {
    key: 'match',
    ok: form.password.length > 0 && form.password === form.password_confirmation,
    label: t('auth.set_password.rule_match'),
  },
])

function submit() {
  form
    .transform((data) => ({
      ...data,
      children: data.children.map((child) => ({
        firstName: child.firstName,
        lastName: child.lastName,
        ...(props.fields.grade && child.grade.trim() ? { grade: child.grade } : {}),
        ...(props.fields.className && child.className.trim() ? { className: child.className } : {}),
        ...(props.fields.allergens ? { allergies: child.allergies } : {}),
        ...(child.dietaryNotes.trim() ? { dietaryNotes: child.dietaryNotes } : {}),
      })),
    }))
    .post(props.action, {
      preserveScroll: (visit) => Object.keys(visit.props.errors ?? {}).length > 0,
      onFinish: () => form.reset('password', 'password_confirmation'),
    })
}
</script>

<template>
  <GuestLayout>
    <Head :title="t('families.registration.page_title')" />

    <section
      v-if="sent"
      class="flex flex-col gap-2 rounded-3xl border border-line bg-surface px-5 py-6"
    >
      <EmptyState
        tone="info"
        :title="t('families.registration.sent_title')"
        :description="t('families.registration.sent_body')"
      >
        <Link href="/login" class="text-sm font-semibold">
          {{ t('families.registration.back_to_login') }}
        </Link>
      </EmptyState>
    </section>

    <form
      v-else
      class="flex flex-col gap-[18px] rounded-3xl border border-line bg-surface px-5 py-6"
      novalidate
      @submit.prevent="submit"
    >
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-extrabold tracking-[-0.02em]">
          {{ t('families.registration.title') }}
        </h1>
        <p class="text-sm leading-normal text-ink-3">
          {{ t('families.registration.subtitle', { school: schoolName }) }}
        </p>
      </div>

      <div
        v-if="flashError"
        role="alert"
        class="rounded-xl border border-danger-line bg-danger-soft px-3.5 py-3 text-sm font-semibold text-danger-ink"
      >
        {{ flashError }}
      </div>

      <!-- Honeypot: hidden from people, robots fill it in. -->
      <div class="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
        <label for="website">{{ t('families.registration.website') }}</label>
        <input id="website" v-model="form.website" type="text" tabindex="-1" autocomplete="off" />
      </div>

      <h2 class="text-base font-extrabold">{{ t('families.registration.parent_section') }}</h2>
      <TextInput
        id="fullName"
        v-model="form.fullName"
        autocomplete="name"
        :label="t('families.registration.full_name')"
        :error="form.errors.fullName"
        required
      />
      <TextInput
        id="email"
        v-model="form.email"
        type="email"
        autocomplete="username"
        :label="t('families.registration.email')"
        :error="form.errors.email"
        required
      />
      <TextInput
        id="phone"
        v-model="form.phone"
        type="tel"
        autocomplete="tel"
        :label="t('families.registration.phone')"
        :hint="t('families.registration.phone_hint')"
        :error="form.errors.phone"
        required
      />
      <SelectInput
        id="locale"
        v-model="form.locale"
        :label="t('families.registration.locale')"
        :options="localeOptions"
        :error="form.errors.locale"
      />

      <TextInput
        id="password"
        v-model="form.password"
        :type="showPassword ? 'text' : 'password'"
        autocomplete="new-password"
        :label="t('families.registration.password')"
        :error="form.errors.password"
        required
      >
        <template #trailing>
          <button
            type="button"
            class="flex size-11 items-center justify-center rounded-[10px] text-ink-3 hover:bg-subtle"
            :aria-label="
              showPassword
                ? t('families.registration.hide_password')
                : t('families.registration.show_password')
            "
            :aria-pressed="showPassword"
            @click="showPassword = !showPassword"
          >
            <svg
              class="size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
              <circle cx="12" cy="12" r="3" />
              <path v-if="showPassword" d="M4 4l16 16" />
            </svg>
          </button>
        </template>
      </TextInput>
      <TextInput
        id="password_confirmation"
        v-model="form.password_confirmation"
        :type="showPassword ? 'text' : 'password'"
        autocomplete="new-password"
        :label="t('families.registration.password_confirmation')"
        :error="form.errors.password_confirmation"
        required
      />
      <ul class="flex flex-col gap-1 text-[13px]" aria-live="polite">
        <li
          v-for="rule in rules"
          :key="rule.key"
          class="flex items-center gap-2"
          :class="rule.ok ? 'font-semibold text-brand-strong' : 'text-ink-4'"
        >
          <span aria-hidden="true">{{ rule.ok ? '✓' : '•' }}</span>
          {{ rule.label }}
        </li>
      </ul>

      <h2 class="pt-2 text-base font-extrabold">
        {{ t('families.registration.children_section') }}
      </h2>
      <p v-if="errors.children" class="text-[13px] font-semibold text-danger" role="alert">
        {{ errors.children }}
      </p>

      <fieldset
        v-for="(child, index) in form.children"
        :key="index"
        class="flex flex-col gap-4 rounded-2xl border border-line p-4"
      >
        <div class="flex items-center justify-between gap-2">
          <legend class="text-sm font-extrabold">
            {{ t('families.registration.child_title', { number: index + 1 }) }}
          </legend>
          <AppButton
            v-if="form.children.length > 1"
            size="sm"
            variant="secondary"
            @click="removeChild(index)"
          >
            {{ t('families.registration.remove_child') }}
          </AppButton>
        </div>
        <TextInput
          :id="`child-${index}-first`"
          v-model="child.firstName"
          :label="t('families.registration.first_name')"
          :error="childError(index, 'firstName')"
          required
        />
        <TextInput
          :id="`child-${index}-last`"
          v-model="child.lastName"
          :label="t('families.registration.last_name')"
          :error="childError(index, 'lastName')"
          required
        />
        <TextInput
          v-if="fields.grade"
          :id="`child-${index}-grade`"
          v-model="child.grade"
          :label="t('families.registration.grade')"
          :error="childError(index, 'grade')"
        />
        <TextInput
          v-if="fields.className"
          :id="`child-${index}-class`"
          v-model="child.className"
          :label="t('families.registration.class_name')"
          :error="childError(index, 'className')"
        />
        <AllergenPicker
          v-if="fields.allergens"
          v-model="child.allergies"
          :allergens="allergens"
          :label="t('families.registration.allergies')"
          :hint="t('families.registration.allergies_hint')"
          :error="allergyError(index)"
        />
        <TextArea
          :id="`child-${index}-notes`"
          v-model="child.dietaryNotes"
          :label="t('families.registration.dietary_notes')"
          :hint="t('families.registration.dietary_notes_hint')"
          :maxlength="1000"
          :error="childError(index, 'dietaryNotes')"
        />
      </fieldset>

      <AppButton
        v-if="form.children.length < maxChildren"
        variant="secondary"
        block
        @click="addChild"
      >
        + {{ t('families.registration.add_child') }}
      </AppButton>

      <AppButton type="submit" size="lg" block :loading="form.processing">
        {{
          form.processing
            ? t('families.registration.submitting')
            : t('families.registration.submit')
        }}
      </AppButton>
    </form>
  </GuestLayout>
</template>
