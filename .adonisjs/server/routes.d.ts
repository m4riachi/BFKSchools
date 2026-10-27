import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'session.create': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'locale.update': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'parent.home': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'kitchen.dashboard': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'session.create': { paramsTuple?: []; params?: {} }
    'parent.home': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'kitchen.dashboard': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'session.create': { paramsTuple?: []; params?: {} }
    'parent.home': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'kitchen.dashboard': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'session.store': { paramsTuple?: []; params?: {} }
    'locale.update': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}