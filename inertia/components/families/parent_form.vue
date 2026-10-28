<script setup lang="ts">
/**
 * Create / edit form of a parent account.
 */
import { computed } from 'vue'
import { useForm } from '@inertiajs/vue3'
import TextInput from '~/components/ui/text_input.vue'
import SelectInput from '~/components/ui/select_input.vue'
import CheckboxField from '~/components/ui/checkbox_field.vue'
import AppButton from '~/components/ui/app_button.vue'
import { useI18n } from '~/composables/use_i18n'

const props = defineProps<{
  parent?: { id: number; fullName: string; email: string; phone: string | null; locale: string }
  cancelHref: string
}>()

const { t } = useI18n()
const isEdit = computed(() => Boolean(props.parent))

const form = useForm({
  fullName: props.parent?.fullName ?? '',
  email: props.parent?.email ?? '',
  phone: props.parent?.phone ?? '',
  locale: props.parent?.locale ?? 'fr',
  sendInvitation: true,
})

const emailChanged = computed(
  () => isEdit.value && form.email.trim().toLowerCase() !== props.parent?.email
)

function submit() {
  if (props.parent) form.put(`/admin/parents/${props.parent.id}`)
  else form.post('/admin/parents')
}
</script>

<template>
  <form class="card flex max-w-2xl flex-col gap-5 p-5 sm:p-6" novalidate @submit.prevent="submit">
    <TextInput
      id="fullName"
      v-model="form.fullName"
      autocomplete="off"
      required
      :label="t('families.parent_form.full_name')"
      :error="form.errors.fullName"
    />
    <TextInput
      id="email"
      v-model="form.email"
      type="email"
      autocomplete="off"
      required
      :label="t('families.parent_form.email')"
      :hint="
        emailChanged
          ? t('families.parent_form.email_change_warning')
          : t('families.parent_form.email_hint')
      "
      :error="form.errors.email"
    />
    <div class="grid gap-5 sm:grid-cols-2">
      <TextInput
        id="phone"
        v-model="form.phone"
        type="tel"
        autocomplete="off"
        :label="t('families.parent_form.phone')"
        :hint="t('families.parent_form.phone_hint')"
        :error="form.errors.phone"
      />
      <SelectInput
        id="locale"
        v-model="form.locale"
        required
        :label="t('families.parent_form.locale')"
        :options="[
          { value: 'fr', label: t('families.parent_form.locale_fr') },
          { value: 'en', label: t('families.parent_form.locale_en') },
        ]"
        :error="form.errors.locale"
      />
    </div>
    <CheckboxField
      v-if="!isEdit"
      id="sendInvitation"
      v-model="form.sendInvitation"
      :label="t('families.parent_form.send_invitation')"
      :hint="t('families.parent_form.send_invitation_hint')"
    />
    <div class="flex flex-wrap gap-2.5 pt-1">
      <AppButton type="submit" :loading="form.processing">
        {{
          isEdit ? t('families.parent_form.submit_edit') : t('families.parent_form.submit_create')
        }}
      </AppButton>
      <AppButton variant="secondary" :href="cancelHref">
        {{ t('families.parent_form.cancel') }}
      </AppButton>
    </div>
  </form>
</template>
