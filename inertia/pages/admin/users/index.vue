<script setup lang="ts">
/**
 * Staff users (D42), admins only: create (by invitation), edit, change the
 * role, deactivate. The server checks every rule.
 */
import { computed, ref } from 'vue'
import { router, useForm } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import ModalDialog from '~/components/ui/modal_dialog.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import StatusBadge from '~/components/ui/status_badge.vue'
import TextInput from '~/components/ui/text_input.vue'
import SelectInput from '~/components/ui/select_input.vue'
import { useI18n } from '~/composables/use_i18n'

type StaffUser = {
  id: number
  fullName: string
  email: string
  phone: string | null
  locale: string
  role: string
  access: string
  roleName: string | null
  isActive: boolean
  hasPassword: boolean
  isSelf: boolean
}

const props = defineProps<{ users: StaffUser[]; roles: { id: number; name: string }[] }>()

const { t } = useI18n()

const accessOptions = computed(() => [
  { value: 'admin', label: t('roles.admin') },
  { value: 'manager', label: t('roles.manager') },
  { value: 'kitchen', label: t('roles.kitchen') },
  ...props.roles.map((role) => ({ value: `role:${role.id}`, label: role.name })),
])

const editing = ref<StaffUser | null>(null)
const formOpen = ref(false)
const form = useForm({ fullName: '', email: '', phone: '', locale: 'fr', access: 'manager' })

function openCreate() {
  editing.value = null
  form.defaults({ fullName: '', email: '', phone: '', locale: 'fr', access: 'manager' })
  form.reset()
  form.clearErrors()
  formOpen.value = true
}
function openEdit(user: StaffUser) {
  editing.value = user
  form.defaults({
    fullName: user.fullName,
    email: user.email,
    phone: user.phone ?? '',
    locale: user.locale,
    access: user.access,
  })
  form.reset()
  form.clearErrors()
  formOpen.value = true
}
function submit() {
  const options = { preserveScroll: true, onSuccess: () => (formOpen.value = false) }
  if (editing.value) form.put(`/admin/users/${editing.value.id}`, options)
  else form.post('/admin/users', options)
}

const invite = (user: StaffUser) =>
  router.post(`/admin/users/${user.id}/invite`, {}, { preserveScroll: true })

const toggling = ref<StaffUser | null>(null)
const toggleOpen = ref(false)
function askToggle(user: StaffUser) {
  toggling.value = user
  toggleOpen.value = true
}
function confirmToggle() {
  const user = toggling.value!
  router.put(
    `/admin/users/${user.id}/active`,
    { isActive: !user.isActive },
    { preserveScroll: true, onFinish: () => (toggleOpen.value = false) }
  )
}
</script>

<template>
  <AdminLayout>
    <PageHeader :title="t('users.title')" :description="t('users.description')">
      <template #actions>
        <Link href="/admin/roles">
          <AppButton variant="secondary">{{ t('users.manage_roles') }}</AppButton>
        </Link>
        <AppButton @click="openCreate">{{ t('users.add') }}</AppButton>
      </template>
    </PageHeader>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-line text-left text-[13px] text-ink-4">
            <th class="px-4 py-3 font-bold">{{ t('users.columns.name') }}</th>
            <th class="px-4 py-3 font-bold">{{ t('users.columns.role') }}</th>
            <th class="px-4 py-3 font-bold">{{ t('users.columns.status') }}</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id" class="border-b border-line-soft">
            <td class="px-4 py-3">
              <span class="block font-semibold">
                {{ user.fullName }}
                <span v-if="user.isSelf" class="font-normal text-ink-4">{{ t('users.you') }}</span>
              </span>
              <span class="text-[13px] text-ink-3">{{ user.email }}</span>
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
              {{ user.roleName ?? t(`roles.${user.role}`) }}
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
              <StatusBadge v-if="!user.isActive" tone="neutral">{{
                t('users.status.inactive')
              }}</StatusBadge>
              <StatusBadge v-else-if="!user.hasPassword" tone="warning">{{
                t('users.status.invited')
              }}</StatusBadge>
              <StatusBadge v-else tone="brand">{{ t('users.status.active') }}</StatusBadge>
            </td>
            <td class="px-4 py-3">
              <div class="flex flex-wrap justify-end gap-2">
                <AppButton
                  v-if="user.isActive && !user.hasPassword"
                  size="sm"
                  variant="secondary"
                  @click="invite(user)"
                >
                  {{ t('users.resend') }}
                </AppButton>
                <AppButton size="sm" variant="secondary" @click="openEdit(user)">
                  {{ t('users.edit') }}
                </AppButton>
                <AppButton
                  v-if="!user.isSelf"
                  size="sm"
                  variant="secondary"
                  @click="askToggle(user)"
                >
                  {{ user.isActive ? t('users.deactivate') : t('users.activate') }}
                </AppButton>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ModalDialog
      v-model:open="formOpen"
      :title="editing ? t('users.edit_title') : t('users.add_title')"
    >
      <form id="staff-user" class="flex flex-col gap-4" @submit.prevent="submit">
        <p v-if="!editing" class="text-sm text-ink-3">{{ t('users.invite_hint') }}</p>
        <TextInput
          id="fullName"
          v-model="form.fullName"
          :label="t('users.fields.name')"
          :error="form.errors.fullName"
          required
        />
        <TextInput
          id="email"
          v-model="form.email"
          type="email"
          :label="t('users.fields.email')"
          :error="form.errors.email"
          required
        />
        <TextInput
          id="phone"
          v-model="form.phone"
          type="tel"
          :label="t('users.fields.phone')"
          :error="form.errors.phone"
        />
        <SelectInput
          id="access"
          v-model="form.access"
          :options="accessOptions"
          :label="t('users.fields.role')"
          :error="form.errors.access"
          :disabled="editing?.isSelf"
          required
        />
        <SelectInput
          id="locale"
          v-model="form.locale"
          :options="[
            { value: 'fr', label: 'Français' },
            { value: 'en', label: 'English' },
          ]"
          :label="t('users.fields.locale')"
          :error="form.errors.locale"
          required
        />
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="formOpen = false">{{ t('users.cancel') }}</AppButton>
        <AppButton type="submit" form="staff-user" :loading="form.processing">
          {{ editing ? t('users.save') : t('users.create') }}
        </AppButton>
      </template>
    </ModalDialog>

    <ConfirmDialog
      v-model:open="toggleOpen"
      :title="toggling?.isActive ? t('users.deactivate_title') : t('users.activate_title')"
      :message="toggling?.isActive ? t('users.deactivate_body') : t('users.activate_body')"
      :danger="toggling?.isActive"
      @confirm="confirmToggle"
    />
  </AdminLayout>
</template>
