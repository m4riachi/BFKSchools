/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  session: {
    create: typeof routes['session.create']
    store: typeof routes['session.store']
    destroy: typeof routes['session.destroy']
  }
  password: {
    forgot: typeof routes['password.forgot'] & {
      store: typeof routes['password.forgot.store']
    }
    reset: typeof routes['password.reset'] & {
      store: typeof routes['password.reset.store']
    }
  }
  invitation: {
    show: typeof routes['invitation.show']
    accept: typeof routes['invitation.accept']
  }
  locale: {
    update: typeof routes['locale.update']
  }
  parent: {
    home: typeof routes['parent.home']
  }
  admin: {
    dashboard: typeof routes['admin.dashboard']
    parents: {
      index: typeof routes['admin.parents.index']
      create: typeof routes['admin.parents.create']
      store: typeof routes['admin.parents.store']
      show: typeof routes['admin.parents.show']
      edit: typeof routes['admin.parents.edit']
      update: typeof routes['admin.parents.update']
      deactivate: typeof routes['admin.parents.deactivate']
      activate: typeof routes['admin.parents.activate']
      invite: typeof routes['admin.parents.invite']
    }
    children: {
      create: typeof routes['admin.children.create']
      store: typeof routes['admin.children.store']
      edit: typeof routes['admin.children.edit']
      update: typeof routes['admin.children.update']
      destroy: typeof routes['admin.children.destroy']
      subscriptions: {
        store: typeof routes['admin.children.subscriptions.store']
        update: typeof routes['admin.children.subscriptions.update']
        destroy: typeof routes['admin.children.subscriptions.destroy']
      }
    }
    imports: {
      create: typeof routes['admin.imports.create']
      template: typeof routes['admin.imports.template']
      upload: typeof routes['admin.imports.upload']
      show: typeof routes['admin.imports.show']
      confirm: typeof routes['admin.imports.confirm']
    }
  }
  kitchen: {
    dashboard: typeof routes['kitchen.dashboard']
  }
}
