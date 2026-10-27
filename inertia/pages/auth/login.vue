<script setup lang="ts">
import { computed, ref } from 'vue'
import { Head, useForm, usePage } from '@inertiajs/vue3'
import GuestLayout from '~/layouts/guest_layout.vue'
import TextInput from '~/components/ui/text_input.vue'
import AppButton from '~/components/ui/app_button.vue'
import { useI18n } from '~/composables/use_i18n'

const { t } = useI18n()
const page = usePage()

const form = useForm({ email: '', password: '', remember: false })
const showPassword = ref(false)
const flashError = computed(() => page.flash?.error)

function submit() {
  form.post('/login', { onFinish: () => form.reset('password') })
}
</script>

<template>
  <GuestLayout>
    <Head :title="t('auth.login.page_title')" />

    <form
      class="flex flex-col gap-[18px] rounded-3xl border border-line bg-surface px-5 py-6"
      novalidate
      @submit.prevent="submit"
    >
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-extrabold tracking-[-0.02em]">{{ t('auth.login.title') }}</h1>
        <p class="text-sm leading-normal text-ink-3">{{ t('auth.login.subtitle') }}</p>
      </div>

      <div
        v-if="flashError"
        role="alert"
        class="rounded-xl border border-danger-line bg-danger-soft px-3.5 py-3 text-sm font-semibold text-danger-ink"
      >
        {{ flashError }}
      </div>

      <TextInput
        id="email"
        v-model="form.email"
        type="email"
        autocomplete="username"
        :label="t('auth.login.email')"
        :placeholder="t('auth.login.email_placeholder')"
        :error="form.errors.email"
      />

      <TextInput
        id="password"
        v-model="form.password"
        :type="showPassword ? 'text' : 'password'"
        autocomplete="current-password"
        :label="t('auth.login.password')"
        :error="form.errors.password"
      >
        <template #trailing>
          <button
            type="button"
            class="flex size-11 items-center justify-center rounded-[10px] text-ink-3 hover:bg-subtle"
            :aria-label="
              showPassword ? t('auth.login.hide_password') : t('auth.login.show_password')
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

      <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-2">
        <input v-model="form.remember" type="checkbox" class="m-0 size-[18px] accent-brand" />
        {{ t('auth.login.remember') }}
      </label>

      <AppButton type="submit" size="lg" block :loading="form.processing">
        {{ form.processing ? t('auth.login.submitting') : t('auth.login.submit') }}
      </AppButton>
    </form>

    <div class="flex items-start gap-3 rounded-[14px] bg-[#e9eef0] px-4 py-3.5">
      <svg
        class="mt-px size-5 shrink-0 text-ink-2"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M4 6h16v12H4z" />
        <path d="m4 7 8 6 8-6" />
      </svg>
      <p class="text-[13px] leading-normal text-ink-2">
        <strong class="font-bold">{{ t('auth.login.first_time_title') }}</strong>
        {{ t('auth.login.first_time_body') }}
      </p>
    </div>
  </GuestLayout>
</template>
