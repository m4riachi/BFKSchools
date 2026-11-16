<script setup lang="ts">
/**
 * D59: the link of the sign-up confirmation email. The GET only shows the
 * page (what was submitted, phone masked); a button consumes the single-use
 * link — "Confirmer", or "Ce n'est pas moi", which refuses the sign-up —
 * so mail scanners that open links do nothing on their own.
 */
import { computed } from 'vue'
import { Head, useForm, usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import GuestLayout from '~/layouts/guest_layout.vue'
import AppButton from '~/components/ui/app_button.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  action: string
  state: 'valid' | 'confirmed' | 'declined' | 'invalid'
  /** What was submitted (phone masked, first names only), so the owner can tell it is theirs. */
  summary: { fullName: string; phone: string | null; children: string[] } | null
}>()

const { t } = useI18n()
const page = usePage()
const flashError = computed(() => page.flash?.error)
const form = useForm({ decision: 'confirm' })

function submit(decision: 'confirm' | 'decline') {
  form.decision = decision
  form.post(props.action)
}
</script>

<template>
  <GuestLayout>
    <Head :title="t('families.registration.confirm.page_title')" />

    <section class="flex flex-col gap-4 rounded-3xl border border-line bg-surface px-5 py-6">
      <div
        v-if="flashError"
        role="alert"
        class="rounded-xl border border-danger-line bg-danger-soft px-3.5 py-3 text-sm font-semibold text-danger-ink"
      >
        {{ flashError }}
      </div>

      <EmptyState
        v-if="state === 'confirmed'"
        tone="info"
        :title="t('families.registration.confirm.done_title')"
        :description="t('families.registration.confirm.done_body')"
      >
        <Link href="/login" class="text-sm font-semibold">
          {{ t('families.registration.back_to_login') }}
        </Link>
      </EmptyState>

      <EmptyState
        v-else-if="state === 'declined'"
        tone="info"
        :title="t('families.registration.confirm.declined_title')"
        :description="t('families.registration.confirm.declined_body')"
      />

      <EmptyState
        v-else-if="state === 'invalid'"
        tone="info"
        :title="t('families.registration.confirm.invalid_title')"
        :description="t('families.registration.confirm.invalid_body')"
      >
        <Link href="/login" class="text-sm font-semibold">
          {{ t('families.registration.back_to_login') }}
        </Link>
      </EmptyState>

      <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="submit('confirm')">
        <h1 class="text-2xl font-extrabold tracking-[-0.02em]">
          {{ t('families.registration.confirm.title') }}
        </h1>
        <p class="text-sm leading-normal text-ink-3">
          {{ t('families.registration.confirm.body') }}
        </p>
        <dl
          v-if="summary"
          class="grid grid-cols-[minmax(0,120px)_1fr] gap-x-3 gap-y-2 rounded-xl bg-subtle px-3.5 py-3 text-sm"
        >
          <dt class="text-ink-4">{{ t('families.registration.confirm.name') }}</dt>
          <dd class="font-bold">{{ summary.fullName }}</dd>
          <dt class="text-ink-4">{{ t('families.registration.confirm.phone') }}</dt>
          <dd class="font-semibold">{{ summary.phone ?? '—' }}</dd>
          <dt class="text-ink-4">{{ t('families.registration.confirm.children') }}</dt>
          <dd class="font-semibold">{{ summary.children.join(', ') }}</dd>
        </dl>
        <AppButton
          type="submit"
          size="lg"
          block
          :loading="form.processing && form.decision === 'confirm'"
        >
          {{ t('families.registration.confirm.submit') }}
        </AppButton>
        <AppButton variant="secondary" block :disabled="form.processing" @click="submit('decline')">
          {{ t('families.registration.confirm.not_me') }}
        </AppButton>
        <p class="m-0 text-[13px] text-ink-4">
          {{ t('families.registration.confirm.not_me_hint') }}
        </p>
      </form>
    </section>
  </GuestLayout>
</template>
