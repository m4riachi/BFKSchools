<script setup lang="ts">
/**
 * Parent portal — "Account" tab (D30): account details, the change
 * password form (current + new password, same strength rules as the
 * set-password page) and links to the email preferences and sign out.
 * The server decides everything (rules, rate limit); the checklist below
 * only mirrors the rules while typing.
 */
import { computed, ref } from 'vue'
import { Head, useForm } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import ParentLayout from '~/layouts/parent_layout.vue'
import TextInput from '~/components/ui/text_input.vue'
import AppButton from '~/components/ui/app_button.vue'
import NavIcon from '~/components/ui/nav_icon.vue'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  account: { fullName: string; email: string; phone: string | null }
  minLength: number
}>()

const { t } = useI18n()

const form = useForm({ currentPassword: '', password: '', password_confirmation: '' })
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
  form.put('/account/password', {
    preserveScroll: true,
    onFinish: () => form.reset(),
  })
}
</script>

<template>
  <ParentLayout>
    <Head :title="t('auth.account.page_title')" />
    <h1 class="text-[26px] font-extrabold tracking-[-0.02em]">{{ t('auth.account.title') }}</h1>

    <section
      aria-labelledby="account-details"
      class="flex flex-col gap-3 rounded-3xl border border-line bg-surface px-5 py-5"
    >
      <h2 id="account-details" class="text-base font-extrabold">
        {{ t('auth.account.details') }}
      </h2>
      <dl class="flex flex-col gap-2.5 text-sm">
        <div class="flex flex-col gap-0.5">
          <dt class="text-xs font-semibold text-ink-3">{{ t('auth.account.name') }}</dt>
          <dd class="font-bold">{{ account.fullName }}</dd>
        </div>
        <div class="flex flex-col gap-0.5">
          <dt class="text-xs font-semibold text-ink-3">{{ t('auth.account.email') }}</dt>
          <dd class="break-all">{{ account.email }}</dd>
        </div>
        <div v-if="account.phone" class="flex flex-col gap-0.5">
          <dt class="text-xs font-semibold text-ink-3">{{ t('auth.account.phone') }}</dt>
          <dd>{{ account.phone }}</dd>
        </div>
      </dl>
      <p class="text-[13px] text-ink-3">{{ t('auth.account.email_help') }}</p>
    </section>

    <form
      class="flex flex-col gap-[18px] rounded-3xl border border-line bg-surface px-5 py-5"
      aria-labelledby="change-password"
      novalidate
      @submit.prevent="submit"
    >
      <div class="flex flex-col gap-1">
        <h2 id="change-password" class="text-base font-extrabold">
          {{ t('auth.change_password.title') }}
        </h2>
        <p class="text-sm text-ink-3">{{ t('auth.change_password.subtitle') }}</p>
      </div>

      <!-- Lets password managers link the new password to the account. -->
      <input
        type="email"
        name="username"
        :value="account.email"
        autocomplete="username"
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        readonly
      />

      <TextInput
        id="currentPassword"
        v-model="form.currentPassword"
        :type="showPassword ? 'text' : 'password'"
        autocomplete="current-password"
        :label="t('auth.change_password.current_password')"
        :error="form.errors.currentPassword"
        required
      />

      <TextInput
        id="password"
        v-model="form.password"
        :type="showPassword ? 'text' : 'password'"
        autocomplete="new-password"
        :label="t('auth.change_password.password')"
        :error="form.errors.password"
        required
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
        :label="t('auth.change_password.password_confirmation')"
        :error="form.errors.password_confirmation"
        required
      />

      <div class="flex flex-col gap-1.5 text-[13px]" aria-live="polite">
        <span class="font-bold text-ink-2">{{ t('auth.set_password.rules_title') }}</span>
        <ul class="flex flex-col gap-1">
          <li
            v-for="rule in rules"
            :key="rule.key"
            class="flex items-center gap-2"
            :class="rule.ok ? 'font-semibold text-brand-strong' : 'text-ink-3'"
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
          form.processing ? t('auth.change_password.submitting') : t('auth.change_password.submit')
        }}
      </AppButton>
    </form>

    <nav
      :aria-label="t('auth.account.title')"
      class="flex flex-col gap-2 rounded-3xl border border-line bg-surface p-2"
    >
      <Link
        href="/notifications#preferences"
        class="flex min-h-12 items-center gap-3 rounded-2xl px-3 font-semibold text-ink no-underline hover:bg-subtle"
      >
        <NavIcon name="bell" />
        {{ t('auth.account.notifications_link') }}
      </Link>
      <Link
        route="session.destroy"
        as="button"
        class="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left font-semibold text-ink hover:bg-subtle"
      >
        <NavIcon name="logout" />
        {{ t('auth.account.logout') }}
      </Link>
    </nav>
  </ParentLayout>
</template>
