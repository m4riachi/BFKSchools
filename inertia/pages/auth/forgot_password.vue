<script setup lang="ts">
import { computed } from 'vue'
import { Head, useForm, usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import GuestLayout from '~/layouts/guest_layout.vue'
import TextInput from '~/components/ui/text_input.vue'
import AppButton from '~/components/ui/app_button.vue'
import { useI18n } from '~/composables/use_i18n'

const { t } = useI18n()
const page = usePage()

const form = useForm({ email: '' })
const flashError = computed(() => page.flash?.error)
const flashSuccess = computed(() => page.flash?.success)

function submit() {
  form.post('/password/forgot', { onSuccess: () => form.reset('email') })
}
</script>

<template>
  <GuestLayout>
    <Head :title="t('auth.forgot.page_title')" />

    <form
      class="flex flex-col gap-[18px] rounded-3xl border border-line bg-surface px-5 py-6"
      novalidate
      @submit.prevent="submit"
    >
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-extrabold tracking-[-0.02em]">{{ t('auth.forgot.title') }}</h1>
        <p class="text-sm leading-normal text-ink-3">{{ t('auth.forgot.subtitle') }}</p>
      </div>

      <div
        v-if="flashSuccess"
        role="status"
        class="rounded-xl border border-brand-soft bg-brand-soft px-3.5 py-3 text-sm font-semibold text-brand-strong"
      >
        {{ flashSuccess }}
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
        :label="t('auth.forgot.email')"
        :placeholder="t('auth.login.email_placeholder')"
        :error="form.errors.email"
      />

      <AppButton type="submit" size="lg" block :loading="form.processing">
        {{ form.processing ? t('auth.forgot.submitting') : t('auth.forgot.submit') }}
      </AppButton>

      <Link href="/login" class="self-center text-sm font-semibold">
        {{ t('auth.forgot.back_to_login') }}
      </Link>
    </form>
  </GuestLayout>
</template>
