import { computed } from 'vue'
import { usePage } from '@inertiajs/vue3'

/** D33: optional modules of the school, decided by the server (shared Inertia prop). */
export function useFeatures() {
  const page = usePage()
  return computed(
    () => page.props.features ?? { allergens: false, labels: false, grade: false, className: false }
  )
}

/** "Niveau · Classe" of a child, without the fields the school turned off. */
export function usePlacement() {
  const features = useFeatures()
  return (grade?: string | null, className?: string | null) =>
    [features.value.grade ? grade : null, features.value.className ? className : null]
      .filter(Boolean)
      .join(' · ')
}
