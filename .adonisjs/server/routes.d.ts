import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'session.create': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'password.forgot': { paramsTuple?: []; params?: {} }
    'password.forgot.store': { paramsTuple?: []; params?: {} }
    'invitation.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'invitation.accept': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password.reset': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password.reset.store': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'locale.update': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'media.meal_photo': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'variant': ParamValue} }
    'parent.home': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.parents.index': { paramsTuple?: []; params?: {} }
    'admin.parents.create': { paramsTuple?: []; params?: {} }
    'admin.parents.store': { paramsTuple?: []; params?: {} }
    'admin.parents.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.parents.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.parents.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.parents.deactivate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.parents.activate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.parents.invite': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.children.create': { paramsTuple: [ParamValue]; params: {'parentId': ParamValue} }
    'admin.children.store': { paramsTuple: [ParamValue]; params: {'parentId': ParamValue} }
    'admin.children.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'parentId': ParamValue,'id': ParamValue} }
    'admin.children.update': { paramsTuple: [ParamValue,ParamValue]; params: {'parentId': ParamValue,'id': ParamValue} }
    'admin.children.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'parentId': ParamValue,'id': ParamValue} }
    'admin.children.subscriptions.store': { paramsTuple: [ParamValue,ParamValue]; params: {'parentId': ParamValue,'childId': ParamValue} }
    'admin.children.subscriptions.update': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'parentId': ParamValue,'childId': ParamValue,'id': ParamValue} }
    'admin.children.subscriptions.destroy': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'parentId': ParamValue,'childId': ParamValue,'id': ParamValue} }
    'admin.meals.index': { paramsTuple?: []; params?: {} }
    'admin.meals.create': { paramsTuple?: []; params?: {} }
    'admin.meals.store': { paramsTuple?: []; params?: {} }
    'admin.meals.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.meals.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.meals.duplicate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.meals.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.meals.photos.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.meals.photos.reorder': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.meals.photos.cover': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'photoId': ParamValue} }
    'admin.meals.photos.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'photoId': ParamValue} }
    'admin.holidays.index': { paramsTuple?: []; params?: {} }
    'admin.holidays.store': { paramsTuple?: []; params?: {} }
    'admin.holidays.generate': { paramsTuple?: []; params?: {} }
    'admin.holidays.settings': { paramsTuple?: []; params?: {} }
    'admin.holidays.groups.update': { paramsTuple: [ParamValue]; params: {'groupId': ParamValue} }
    'admin.holidays.groups.toggle': { paramsTuple: [ParamValue]; params: {'groupId': ParamValue} }
    'admin.holidays.groups.destroy': { paramsTuple: [ParamValue]; params: {'groupId': ParamValue} }
    'admin.holidays.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.holidays.toggle': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.holidays.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.holidays.import.create': { paramsTuple?: []; params?: {} }
    'admin.holidays.import.upload': { paramsTuple?: []; params?: {} }
    'admin.holidays.import.url': { paramsTuple?: []; params?: {} }
    'admin.holidays.import.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.holidays.import.confirm': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.menus.index': { paramsTuple?: []; params?: {} }
    'admin.menus.show': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menus.items.store': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menus.items.update': { paramsTuple: [ParamValue,ParamValue]; params: {'week': ParamValue,'id': ParamValue} }
    'admin.menus.items.default': { paramsTuple: [ParamValue,ParamValue]; params: {'week': ParamValue,'id': ParamValue} }
    'admin.menus.items.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'week': ParamValue,'id': ParamValue} }
    'admin.menus.copy': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menus.templates.apply': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menus.templates.save': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menus.times': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menus.schedule': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menus.unschedule': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menus.publish': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menu_templates.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.settings.show': { paramsTuple?: []; params?: {} }
    'admin.settings.update': { paramsTuple?: []; params?: {} }
    'admin.imports.create': { paramsTuple?: []; params?: {} }
    'admin.imports.template': { paramsTuple?: []; params?: {} }
    'admin.imports.upload': { paramsTuple?: []; params?: {} }
    'admin.imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.imports.confirm': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'kitchen.dashboard': { paramsTuple?: []; params?: {} }
    'kitchen.meals.index': { paramsTuple?: []; params?: {} }
    'kitchen.meals.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  GET: {
    'session.create': { paramsTuple?: []; params?: {} }
    'password.forgot': { paramsTuple?: []; params?: {} }
    'invitation.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password.reset': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'media.meal_photo': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'variant': ParamValue} }
    'parent.home': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.parents.index': { paramsTuple?: []; params?: {} }
    'admin.parents.create': { paramsTuple?: []; params?: {} }
    'admin.parents.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.parents.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.children.create': { paramsTuple: [ParamValue]; params: {'parentId': ParamValue} }
    'admin.children.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'parentId': ParamValue,'id': ParamValue} }
    'admin.meals.index': { paramsTuple?: []; params?: {} }
    'admin.meals.create': { paramsTuple?: []; params?: {} }
    'admin.meals.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.holidays.index': { paramsTuple?: []; params?: {} }
    'admin.holidays.import.create': { paramsTuple?: []; params?: {} }
    'admin.holidays.import.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.menus.index': { paramsTuple?: []; params?: {} }
    'admin.menus.show': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.settings.show': { paramsTuple?: []; params?: {} }
    'admin.imports.create': { paramsTuple?: []; params?: {} }
    'admin.imports.template': { paramsTuple?: []; params?: {} }
    'admin.imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'kitchen.dashboard': { paramsTuple?: []; params?: {} }
    'kitchen.meals.index': { paramsTuple?: []; params?: {} }
    'kitchen.meals.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  HEAD: {
    'session.create': { paramsTuple?: []; params?: {} }
    'password.forgot': { paramsTuple?: []; params?: {} }
    'invitation.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password.reset': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'media.meal_photo': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'variant': ParamValue} }
    'parent.home': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.parents.index': { paramsTuple?: []; params?: {} }
    'admin.parents.create': { paramsTuple?: []; params?: {} }
    'admin.parents.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.parents.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.children.create': { paramsTuple: [ParamValue]; params: {'parentId': ParamValue} }
    'admin.children.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'parentId': ParamValue,'id': ParamValue} }
    'admin.meals.index': { paramsTuple?: []; params?: {} }
    'admin.meals.create': { paramsTuple?: []; params?: {} }
    'admin.meals.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.holidays.index': { paramsTuple?: []; params?: {} }
    'admin.holidays.import.create': { paramsTuple?: []; params?: {} }
    'admin.holidays.import.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.menus.index': { paramsTuple?: []; params?: {} }
    'admin.menus.show': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.settings.show': { paramsTuple?: []; params?: {} }
    'admin.imports.create': { paramsTuple?: []; params?: {} }
    'admin.imports.template': { paramsTuple?: []; params?: {} }
    'admin.imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'kitchen.dashboard': { paramsTuple?: []; params?: {} }
    'kitchen.meals.index': { paramsTuple?: []; params?: {} }
    'kitchen.meals.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  POST: {
    'session.store': { paramsTuple?: []; params?: {} }
    'password.forgot.store': { paramsTuple?: []; params?: {} }
    'invitation.accept': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password.reset.store': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'locale.update': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'admin.parents.store': { paramsTuple?: []; params?: {} }
    'admin.parents.deactivate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.parents.activate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.parents.invite': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.children.store': { paramsTuple: [ParamValue]; params: {'parentId': ParamValue} }
    'admin.children.subscriptions.store': { paramsTuple: [ParamValue,ParamValue]; params: {'parentId': ParamValue,'childId': ParamValue} }
    'admin.meals.store': { paramsTuple?: []; params?: {} }
    'admin.meals.duplicate': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.meals.photos.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.meals.photos.cover': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'photoId': ParamValue} }
    'admin.holidays.store': { paramsTuple?: []; params?: {} }
    'admin.holidays.generate': { paramsTuple?: []; params?: {} }
    'admin.holidays.groups.toggle': { paramsTuple: [ParamValue]; params: {'groupId': ParamValue} }
    'admin.holidays.toggle': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.holidays.import.upload': { paramsTuple?: []; params?: {} }
    'admin.holidays.import.url': { paramsTuple?: []; params?: {} }
    'admin.holidays.import.confirm': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.menus.items.store': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menus.items.default': { paramsTuple: [ParamValue,ParamValue]; params: {'week': ParamValue,'id': ParamValue} }
    'admin.menus.copy': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menus.templates.apply': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menus.templates.save': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menus.schedule': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menus.unschedule': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.menus.publish': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.imports.upload': { paramsTuple?: []; params?: {} }
    'admin.imports.confirm': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PUT: {
    'admin.parents.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.children.update': { paramsTuple: [ParamValue,ParamValue]; params: {'parentId': ParamValue,'id': ParamValue} }
    'admin.children.subscriptions.update': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'parentId': ParamValue,'childId': ParamValue,'id': ParamValue} }
    'admin.meals.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.meals.photos.reorder': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.holidays.settings': { paramsTuple?: []; params?: {} }
    'admin.holidays.groups.update': { paramsTuple: [ParamValue]; params: {'groupId': ParamValue} }
    'admin.holidays.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.menus.items.update': { paramsTuple: [ParamValue,ParamValue]; params: {'week': ParamValue,'id': ParamValue} }
    'admin.menus.times': { paramsTuple: [ParamValue]; params: {'week': ParamValue} }
    'admin.settings.update': { paramsTuple?: []; params?: {} }
  }
  DELETE: {
    'admin.children.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'parentId': ParamValue,'id': ParamValue} }
    'admin.children.subscriptions.destroy': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'parentId': ParamValue,'childId': ParamValue,'id': ParamValue} }
    'admin.meals.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.meals.photos.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'id': ParamValue,'photoId': ParamValue} }
    'admin.holidays.groups.destroy': { paramsTuple: [ParamValue]; params: {'groupId': ParamValue} }
    'admin.holidays.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.menus.items.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'week': ParamValue,'id': ParamValue} }
    'admin.menu_templates.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}