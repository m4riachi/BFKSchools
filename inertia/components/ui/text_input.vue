<script setup lang="ts">
import FormField from '~/components/ui/form_field.vue'

/**
 * Text input with label and error. Works with v-model or as an uncontrolled
 * field inside an Inertia <Form> (pass `name`).
 */
const model = defineModel<string | number | null>()

withDefaults(
  defineProps<{
    id: string
    name?: string
    label?: string
    type?: string
    error?: string
    hint?: string
    placeholder?: string
    autocomplete?: string
    required?: boolean
    disabled?: boolean
  }>(),
  {
    name: undefined,
    label: undefined,
    type: 'text',
    error: undefined,
    hint: undefined,
    placeholder: undefined,
    autocomplete: undefined,
    required: false,
    disabled: false,
  }
)
</script>

<template>
  <FormField :id="id" :label="label" :error="error" :hint="hint" :required="required">
    <div class="relative flex">
      <input
        :id="id"
        v-model="model"
        :name="name ?? id"
        :type="type"
        :placeholder="placeholder"
        :autocomplete="autocomplete"
        :required="required"
        :disabled="disabled"
        :aria-invalid="error ? 'true' : 'false'"
        :aria-describedby="error ? `${id}-error` : hint ? `${id}-hint` : undefined"
        class="h-[50px] w-full flex-1 rounded-xl border bg-surface px-3.5 text-base text-ink placeholder:text-ink-4/70 disabled:bg-subtle"
        :class="[error ? 'border-danger' : 'border-line-input', $slots.trailing ? 'pr-14' : '']"
      />
      <div v-if="$slots.trailing" class="absolute top-[3px] right-[3px]">
        <slot name="trailing" />
      </div>
    </div>
  </FormField>
</template>
