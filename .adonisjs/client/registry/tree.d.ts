/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  session: {
    create: typeof routes['session.create']
    store: typeof routes['session.store']
    destroy: typeof routes['session.destroy']
  }
  locale: {
    update: typeof routes['locale.update']
  }
  parent: {
    home: typeof routes['parent.home']
  }
  admin: {
    dashboard: typeof routes['admin.dashboard']
  }
  kitchen: {
    dashboard: typeof routes['kitchen.dashboard']
  }
}
