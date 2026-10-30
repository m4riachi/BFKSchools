<script setup lang="ts">
/**
 * Custom roles (D42), admins only: a name and the areas it opens. Users,
 * roles and settings are never offered: they stay admin-only.
 */
import { ref } from 'vue'
import { router, useForm } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import AdminLayout from '~/layouts/admin_layout.vue'
import PageHeader from '~/components/ui/page_header.vue'
import AppButton from '~/components/ui/app_button.vue'
import ModalDialog from '~/components/ui/modal_dialog.vue'
import ConfirmDialog from '~/components/ui/confirm_dialog.vue'
import TextInput from '~/components/ui/text_input.vue'
import { useI18n } from '~/composables/use_i18n'

type CustomRole = { id: number; name: string; permissions: string[]; usersCount: number }

defineProps<{ roles: CustomRole[]; permissions: string[] }>()

const { t } = useI18n()

const editing = ref<CustomRole | null>(null)
const formOpen = ref(false)
const form = useForm({ name: '', permissions: [] as string[] })

function open(role: CustomRole | null) {
  editing.value = role
  form.defaults({ name: role?.name ?? '', permissions: [...(role?.permissions ?? [])] })
  form.reset()
  form.clearErrors()
  formOpen.value = true
}
function toggle(permission: string, checked: boolean) {
  form.permissions = checked
    ? [...form.permissions, permission]
    : form.permissions.filter((item) => item !== permission)
}
function submit() {
  const options = { preserveScroll: true, onSuccess: () => (formOpen.value = false) }
  if (editing.value) form.put(`/admin/roles/${editing.value.id}`, options)
  else form.post('/admin/roles', options)
}

const deleting = ref<CustomRole | null>(null)
const deleteOpen = ref(false)
function askDelete(role: CustomRole) {
  deleting.value = role
  deleteOpen.value = true
}
function confirmDelete() {
  router.delete(`/admin/roles/${deleting.value!.id}`, {
    preserveScroll: true,
    onFinish: () => (deleteOpen.value = false),
  })
}
</script>

<template>
  <AdminLayout>
    <PageHeader :title="t('users.roles.title')" :description="t('users.roles.description')">
      <template #actions>
        <Link href="/admin/users">
          <AppButton variant="secondary">{{ t('users.roles.back') }}</AppButton>
        </Link>
        <AppButton @click="open(null)">{{ t('users.roles.add') }}</AppButton>
      </template>
    </PageHeader>

    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <section class="card flex flex-col gap-1 p-4">
        <h2 class="text-[15px] font-bold">{{ t('roles.admin') }}</h2>
        <p class="text-[13px] text-ink-3">{{ t('users.roles.builtin_admin') }}</p>
      </section>
      <section class="card flex flex-col gap-1 p-4">
        <h2 class="text-[15px] font-bold">{{ t('roles.manager') }}</h2>
        <p class="text-[13px] text-ink-3">{{ t('users.roles.builtin_manager') }}</p>
      </section>
      <section class="card flex flex-col gap-1 p-4">
        <h2 class="text-[15px] font-bold">{{ t('roles.kitchen') }}</h2>
        <p class="text-[13px] text-ink-3">{{ t('users.roles.builtin_kitchen') }}</p>
      </section>

      <section v-for="role in roles" :key="role.id" class="card flex flex-col gap-3 p-4">
        <div class="flex flex-col gap-0.5">
          <h2 class="text-[15px] font-bold">{{ role.name }}</h2>
          <span class="text-[13px] text-ink-4">{{
            t('users.roles.users_count', { count: role.usersCount })
          }}</span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="permission in role.permissions"
            :key="permission"
            class="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-strong"
          >
            {{ t(`users.permissions.${permission}`) }}
          </span>
        </div>
        <div class="mt-auto flex gap-2">
          <AppButton size="sm" variant="secondary" @click="open(role)">
            {{ t('users.edit') }}
          </AppButton>
          <AppButton
            size="sm"
            variant="secondary"
            :disabled="role.usersCount > 0"
            :title="role.usersCount > 0 ? t('users.errors.role_in_use') : undefined"
            @click="askDelete(role)"
          >
            {{ t('users.roles.delete') }}
          </AppButton>
        </div>
      </section>
    </div>

    <ModalDialog
      v-model:open="formOpen"
      :title="editing ? t('users.roles.edit_title') : t('users.roles.add_title')"
    >
      <form id="staff-role" class="flex flex-col gap-4" @submit.prevent="submit">
        <TextInput
          id="name"
          v-model="form.name"
          :label="t('users.roles.name')"
          :error="form.errors.name"
          required
        />
        <fieldset class="m-0 flex flex-col gap-1 border-0 p-0">
          <legend class="mb-1 p-0 text-[13px] font-bold">{{ t('users.roles.permissions') }}</legend>
          <label
            v-for="permission in permissions"
            :key="permission"
            class="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-semibold"
          >
            <input
              type="checkbox"
              class="size-[18px] accent-brand"
              :checked="form.permissions.includes(permission)"
              @change="toggle(permission, ($event.target as HTMLInputElement).checked)"
            />
            {{ t(`users.permissions.${permission}`) }}
          </label>
          <p
            v-if="form.errors.permissions"
            class="text-[13px] font-semibold text-danger"
            role="alert"
          >
            {{ form.errors.permissions }}
          </p>
          <p class="mt-1 text-[13px] text-ink-4">{{ t('users.roles.admin_only_hint') }}</p>
        </fieldset>
      </form>
      <template #footer>
        <AppButton variant="secondary" @click="formOpen = false">{{ t('users.cancel') }}</AppButton>
        <AppButton type="submit" form="staff-role" :loading="form.processing">
          {{ t('users.save') }}
        </AppButton>
      </template>
    </ModalDialog>

    <ConfirmDialog
      v-model:open="deleteOpen"
      :title="t('users.roles.delete_title')"
      :message="t('users.roles.delete_body', { name: deleting?.name ?? '' })"
      danger
      @confirm="confirmDelete"
    />
  </AdminLayout>
</template>
