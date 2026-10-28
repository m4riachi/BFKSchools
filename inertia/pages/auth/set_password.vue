<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head, useForm, usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import GuestLayout from '~/layouts/guest_layout.vue'
import TextInput from '~/components/ui/text_input.vue'
import AppButton from '~/components/ui/app_button.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  mode: 'invitation' | 'password_reset'
  valid: boolean
  action: string
  fullName: string | null
  email: string | null
  minLength: number
}>()

const { t } = useI18n()
const page = usePage()
const flashError = computed(() => page.flash?.error)

const form = useForm({ password: '', password_confirmation: '' })
const showPassword = ref(false)

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
  form.post(props.action, { onFinish: () => form.reset('password', 'password_confirmation') })
}
</script>

<template>
  <GuestLayout>
    <Head :title="t(`auth.set_password.page_title_${mode}`)" />

    <section
      v-if="!valid"
      class="flex flex-col gap-2 rounded-3xl border border-line bg-surface px-5 py-6"
    >
      <EmptyState
        tone="info"
        :title="t('auth.set_password.invalid_title')"
        :description="t(`auth.set_password.invalid_body_${mode}`)"
      >
        <div class="flex flex-col items-center gap-3">
          <AppButton v-if="mode === 'password_reset'" href="/password/forgot">
            {{ t('auth.set_password.request_new_link') }}
          </AppButton>
          <Link href="/login" class="text-sm font-semibold">
            {{ t('auth.set_password.back_to_login') }}
          </Link>
        </div>
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
          {{ t(`auth.set_password.title_${mode}`) }}
        </h1>
        <p class="text-sm leading-normal text-ink-3">
          {{ t(`auth.set_password.subtitle_${mode}`) }}
        </p>
      </div>

      <div v-if="email" class="flex flex-col gap-0.5 rounded-xl bg-subtle px-3.5 py-3 text-sm">
        <span class="text-xs font-semibold text-ink-4">{{ t('auth.set_password.account') }}</span>
        <span class="font-bold">{{ fullName }}</span>
        <span class="break-all text-ink-3">{{ email }}</span>
      </div>

      <div
        v-if="flashError"
        role="alert"
        class="rounded-xl border border-danger-line bg-danger-soft px-3.5 py-3 text-sm font-semibold text-danger-ink"
      >
        {{ flashError }}
      </div>

      <!-- Lets password managers link the new password to the account. -->
      <input
        v-if="email"
        type="email"
        name="username"
        :value="email"
        autocomplete="username"
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        readonly
      />

      <TextInput
        id="password"
        v-model="form.password"
        :type="showPassword ? 'text' : 'password'"
        autocomplete="new-password"
        :label="t('auth.set_password.password')"
        :error="form.errors.password"
      >
        <template #trailing>
          <button
            type="button"
            class="flex size-11 items-center justify-center rounded-[10px] text-ink-3 hover:bg-subtle"
            :aria-label="
              showPassword
                ? t('auth.set_password.hide_password')
                : t('auth.set_password.show_password')
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
        :label="t('auth.set_password.password_confirmation')"
        :error="form.errors.password_confirmation"
      />

      <div class="flex flex-col gap-1.5 text-[13px]" aria-live="polite">
        <span class="font-bold text-ink-2">{{ t('auth.set_password.rules_title') }}</span>
        <ul class="flex flex-col gap-1">
          <li
            v-for="rule in rules"
            :key="rule.key"
            class="flex items-center gap-2"
            :class="rule.ok ? 'font-semibold text-brand-strong' : 'text-ink-4'"
          >
            <svg
              class="size-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path v-if="rule.ok" d="M5 12.5l4.5 4.5L19 7.5" />
              <circle v-else cx="12" cy="12" r="3" />
            </svg>
            {{ rule.label }}
          </li>
        </ul>
      </div>

      <AppButton type="submit" size="lg" block :loading="form.processing">
        {{
          form.processing
            ? t('auth.set_password.submitting')
            : t(`auth.set_password.submit_${mode}`)
        }}
      </AppButton>
    </form>
  </GuestLayout>
</template>
