import { usePage } from '@inertiajs/vue3'
import type { NavIconName } from '~/components/ui/nav_icon.vue'

/**
 * A navigation entry. `href: null` = area not built yet (rendered disabled);
 * later phases set the href when they add the area.
 */
export type NavItem = {
  labelKey: string
  href: string | null
  icon?: NavIconName
  /** Only match the exact path (e.g. a dashboard at the root of an area). */
  exact?: boolean
  roles?: string[]
}

export function useActiveNav() {
  const page = usePage()

  function isActive(item: NavItem) {
    if (!item.href) return false
    const path = page.url.split('?')[0]
    return item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`)
  }

  return { isActive }
}
