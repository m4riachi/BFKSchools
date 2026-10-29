<script setup lang="ts">
/**
 * Parent notification center: newest first, unread ones highlighted,
 * "open" (marks read and goes to the related page), mark one / all as
 * read, and the email preferences (reminders can be turned off,
 * cancellations and order changes can't). Texts are rendered by the
 * server (safe i18n) and shown as plain text.
 */
import { useForm, router, Head } from '@inertiajs/vue3'
import ParentLayout from '~/layouts/parent_layout.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import CheckboxField from '~/components/ui/checkbox_field.vue'
import AppButton from '~/components/ui/app_button.vue'
import PaginationNav, { type PaginationMeta } from '~/components/ui/pagination_nav.vue'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  notifications: {
    id: number
    type: string
    title: string
    body: string
    lines: string[]
    href: string
    createdAt: string
    read: boolean
  }[]
  meta: PaginationMeta
  unread: number
  preferences: { menu_published: boolean; deadline_reminder: boolean }
  schoolEmails: { enabled: boolean; menu_published: boolean; deadline_reminder: boolean }
}>()

const { t, formatDateTime } = useI18n()

const form = useForm({ ...props.preferences })

function open(id: number) {
  router.post(`/notifications/${id}/open`)
}

function markRead(id: number) {
  router.post(`/notifications/${id}/read`, {}, { preserveScroll: true })
}

function markAll() {
  router.post('/notifications/read-all', {}, { preserveScroll: true })
}

function savePreferences() {
  form.put('/notifications/preferences', { preserveScroll: true })
}
</script>

<template>
  <ParentLayout>
    <Head :title="t('notifications.title')" />
    <div class="flex items-end justify-between gap-3">
      <div class="flex flex-col gap-0.5">
        <span class="text-sm text-ink-3">{{ t('notifications.unread', { count: unread }) }}</span>
        <h1 class="text-[26px] font-extrabold tracking-[-0.02em]">
          {{ t('notifications.title') }}
        </h1>
      </div>
      <AppButton v-if="unread" variant="secondary" size="sm" @click="markAll">
        {{ t('notifications.mark_all_read') }}
      </AppButton>
    </div>

    <section v-if="!notifications.length" class="rounded-[18px] border border-line bg-surface">
      <EmptyState
        tone="info"
        :title="t('notifications.empty')"
        :description="t('notifications.empty_body')"
      />
    </section>

    <ul v-else class="flex flex-col gap-2.5">
      <li
        v-for="item in notifications"
        :key="item.id"
        class="flex flex-col gap-2 rounded-[18px] border p-4"
        :class="item.read ? 'border-line bg-surface' : 'border-brand/30 bg-brand-soft/60'"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-0.5">
            <h2 class="flex items-center gap-2 text-[15px] font-extrabold">
              <span
                v-if="!item.read"
                class="size-2 shrink-0 rounded-full bg-accent"
                :title="t('notifications.new')"
              />
              <span v-if="!item.read" class="sr-only">{{ t('notifications.new') }}:</span>
              {{ item.title }}
            </h2>
            <span class="text-xs text-ink-4">{{ formatDateTime(item.createdAt) }}</span>
          </div>
        </div>
        <p v-if="item.body" class="text-sm text-ink-2">{{ item.body }}</p>
        <ul v-if="item.lines.length" class="flex flex-col gap-0.5 text-[13px] text-ink-3">
          <li v-for="(line, index) in item.lines" :key="index">{{ line }}</li>
        </ul>
        <div class="flex flex-wrap gap-2 pt-1">
          <AppButton size="sm" @click="open(item.id)">{{ t('notifications.open') }}</AppButton>
          <AppButton v-if="!item.read" size="sm" variant="ghost" @click="markRead(item.id)">
            {{ t('notifications.mark_read') }}
          </AppButton>
        </div>
      </li>
    </ul>

    <PaginationNav v-if="meta.lastPage > 1" :meta="meta" />

    <section
      id="preferences"
      class="flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-4"
    >
      <h2 class="text-[17px] font-extrabold">{{ t('notifications.preferences.title') }}</h2>
      <p class="text-sm text-ink-3">{{ t('notifications.preferences.intro') }}</p>
      <form class="flex flex-col gap-1" @submit.prevent="savePreferences">
        <CheckboxField
          id="pref-menu-published"
          v-model="form.menu_published"
          :label="t('notifications.preferences.menu_published')"
          :hint="
            schoolEmails.menu_published ? undefined : t('notifications.preferences.school_off')
          "
        />
        <CheckboxField
          id="pref-deadline-reminder"
          v-model="form.deadline_reminder"
          :label="t('notifications.preferences.deadline_reminder')"
          :hint="
            schoolEmails.deadline_reminder ? undefined : t('notifications.preferences.school_off')
          "
        />
        <p class="text-[13px] text-ink-4">{{ t('notifications.preferences.always') }}</p>
        <div class="pt-2">
          <AppButton type="submit" :loading="form.processing">
            {{ t('notifications.preferences.save') }}
          </AppButton>
        </div>
      </form>
    </section>
  </ParentLayout>
</template>
