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
    'admin.imports.create': { paramsTuple?: []; params?: {} }
    'admin.imports.template': { paramsTuple?: []; params?: {} }
    'admin.imports.upload': { paramsTuple?: []; params?: {} }
    'admin.imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.imports.confirm': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'kitchen.dashboard': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'session.create': { paramsTuple?: []; params?: {} }
    'password.forgot': { paramsTuple?: []; params?: {} }
    'invitation.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password.reset': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'parent.home': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.parents.index': { paramsTuple?: []; params?: {} }
    'admin.parents.create': { paramsTuple?: []; params?: {} }
    'admin.parents.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.parents.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.children.create': { paramsTuple: [ParamValue]; params: {'parentId': ParamValue} }
    'admin.children.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'parentId': ParamValue,'id': ParamValue} }
    'admin.imports.create': { paramsTuple?: []; params?: {} }
    'admin.imports.template': { paramsTuple?: []; params?: {} }
    'admin.imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'kitchen.dashboard': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'session.create': { paramsTuple?: []; params?: {} }
    'password.forgot': { paramsTuple?: []; params?: {} }
    'invitation.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'password.reset': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'parent.home': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.parents.index': { paramsTuple?: []; params?: {} }
    'admin.parents.create': { paramsTuple?: []; params?: {} }
    'admin.parents.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.parents.edit': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.children.create': { paramsTuple: [ParamValue]; params: {'parentId': ParamValue} }
    'admin.children.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'parentId': ParamValue,'id': ParamValue} }
    'admin.imports.create': { paramsTuple?: []; params?: {} }
    'admin.imports.template': { paramsTuple?: []; params?: {} }
    'admin.imports.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'kitchen.dashboard': { paramsTuple?: []; params?: {} }
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
    'admin.imports.upload': { paramsTuple?: []; params?: {} }
    'admin.imports.confirm': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  PUT: {
    'admin.parents.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.children.update': { paramsTuple: [ParamValue,ParamValue]; params: {'parentId': ParamValue,'id': ParamValue} }
    'admin.children.subscriptions.update': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'parentId': ParamValue,'childId': ParamValue,'id': ParamValue} }
  }
  DELETE: {
    'admin.children.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'parentId': ParamValue,'id': ParamValue} }
    'admin.children.subscriptions.destroy': { paramsTuple: [ParamValue,ParamValue,ParamValue]; params: {'parentId': ParamValue,'childId': ParamValue,'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}