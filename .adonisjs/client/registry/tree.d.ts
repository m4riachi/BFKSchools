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
  media: {
    mealPhoto: typeof routes['media.meal_photo']
  }
  parent: {
    home: typeof routes['parent.home']
    orders: {
      history: typeof routes['parent.orders.history']
      save: typeof routes['parent.orders.save']
      absent: typeof routes['parent.orders.absent']
      applyAll: typeof routes['parent.orders.apply_all']
    }
    statements: typeof routes['parent.statements'] & {
      pdf: typeof routes['parent.statements.pdf']
    }
    notifications: typeof routes['parent.notifications'] & {
      readAll: typeof routes['parent.notifications.read_all']
      preferences: typeof routes['parent.notifications.preferences']
      read: typeof routes['parent.notifications.read']
      open: typeof routes['parent.notifications.open']
    }
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
    meals: {
      index: typeof routes['admin.meals.index']
      create: typeof routes['admin.meals.create']
      store: typeof routes['admin.meals.store']
      edit: typeof routes['admin.meals.edit']
      update: typeof routes['admin.meals.update']
      duplicate: typeof routes['admin.meals.duplicate']
      destroy: typeof routes['admin.meals.destroy']
      photos: {
        store: typeof routes['admin.meals.photos.store']
        reorder: typeof routes['admin.meals.photos.reorder']
        cover: typeof routes['admin.meals.photos.cover']
        destroy: typeof routes['admin.meals.photos.destroy']
      }
    }
    holidays: {
      index: typeof routes['admin.holidays.index']
      store: typeof routes['admin.holidays.store']
      generate: typeof routes['admin.holidays.generate']
      settings: typeof routes['admin.holidays.settings']
      groups: {
        update: typeof routes['admin.holidays.groups.update']
        toggle: typeof routes['admin.holidays.groups.toggle']
        destroy: typeof routes['admin.holidays.groups.destroy']
      }
      update: typeof routes['admin.holidays.update']
      toggle: typeof routes['admin.holidays.toggle']
      destroy: typeof routes['admin.holidays.destroy']
      import: {
        create: typeof routes['admin.holidays.import.create']
        upload: typeof routes['admin.holidays.import.upload']
        url: typeof routes['admin.holidays.import.url']
        show: typeof routes['admin.holidays.import.show']
        confirm: typeof routes['admin.holidays.import.confirm']
      }
    }
    menus: {
      index: typeof routes['admin.menus.index']
      show: typeof routes['admin.menus.show']
      items: {
        store: typeof routes['admin.menus.items.store']
        update: typeof routes['admin.menus.items.update']
        default: typeof routes['admin.menus.items.default']
        destroy: typeof routes['admin.menus.items.destroy']
        remove: typeof routes['admin.menus.items.remove']
      }
      copy: typeof routes['admin.menus.copy']
      templates: {
        apply: typeof routes['admin.menus.templates.apply']
        save: typeof routes['admin.menus.templates.save']
      }
      times: typeof routes['admin.menus.times']
      schedule: typeof routes['admin.menus.schedule']
      unschedule: typeof routes['admin.menus.unschedule']
      publish: typeof routes['admin.menus.publish']
    }
    menuTemplates: {
      destroy: typeof routes['admin.menu_templates.destroy']
    }
    orders: {
      index: typeof routes['admin.orders.index']
      child: typeof routes['admin.orders.child']
      save: typeof routes['admin.orders.save']
      cancel: typeof routes['admin.orders.cancel']
    }
    statements: {
      index: typeof routes['admin.statements.index']
      export: typeof routes['admin.statements.export']
      show: typeof routes['admin.statements.show']
      pdf: typeof routes['admin.statements.pdf']
    }
    settings: {
      show: typeof routes['admin.settings.show']
      update: typeof routes['admin.settings.update']
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
    allergies: typeof routes['kitchen.allergies']
    labels: typeof routes['kitchen.labels'] & {
      pdf: typeof routes['kitchen.labels.pdf']
    }
    exports: typeof routes['kitchen.exports'] & {
      download: typeof routes['kitchen.exports.download']
    }
    meals: {
      index: typeof routes['kitchen.meals.index']
      show: typeof routes['kitchen.meals.show']
    }
  }
}
