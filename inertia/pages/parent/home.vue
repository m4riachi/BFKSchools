<script setup lang="ts">
import { computed } from 'vue'
import { Head, usePage } from '@inertiajs/vue3'
import ParentLayout from '~/layouts/parent_layout.vue'
import EmptyState from '~/components/ui/empty_state.vue'
import { useI18n } from '~/composables/use_i18n'

const { t } = useI18n()
const page = usePage()
const firstName = computed(() => page.props.user?.fullName.split(' ')[0] ?? '')
</script>

<template>
  <ParentLayout>
    <Head :title="t('pages.parent_home.title')" />
    <div class="flex flex-col gap-0.5">
      <span class="text-sm text-ink-3">{{
        t('pages.parent_home.hello', { name: firstName })
      }}</span>
      <h1 class="text-[26px] font-extrabold tracking-[-0.02em]">
        {{ t('pages.parent_home.title') }}
      </h1>
    </div>
    <section class="rounded-[18px] border border-line bg-surface">
      <EmptyState
        tone="info"
        :title="t('pages.parent_home.empty_title')"
        :description="t('pages.parent_home.empty_body')"
      />
    </section>
  </ParentLayout>
</template>
