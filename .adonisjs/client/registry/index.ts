/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

export type { Route, Path } from './schema.d.ts'

const placeholder: any = {}

const routes = {
  'session.create': {
    methods: ["GET","HEAD"],
    pattern: '/login',
    tokens: [[0,"login"]],
    types: placeholder as Registry['session.create']['types'],
  },
  'session.store': {
    methods: ["POST"],
    pattern: '/login',
    tokens: [[0,"login"]],
    types: placeholder as Registry['session.store']['types'],
  },
  'locale.update': {
    methods: ["POST"],
    pattern: '/locale',
    tokens: [[0,"locale"]],
    types: placeholder as Registry['locale.update']['types'],
  },
  'session.destroy': {
    methods: ["POST"],
    pattern: '/logout',
    tokens: [[0,"logout"]],
    types: placeholder as Registry['session.destroy']['types'],
  },
  'parent.home': {
    methods: ["GET","HEAD"],
    pattern: '/',
    tokens: [[0,"/"]],
    types: placeholder as Registry['parent.home']['types'],
  },
  'admin.dashboard': {
    methods: ["GET","HEAD"],
    pattern: '/admin',
    tokens: [[0,"admin"]],
    types: placeholder as Registry['admin.dashboard']['types'],
  },
  'kitchen.dashboard': {
    methods: ["GET","HEAD"],
    pattern: '/kitchen',
    tokens: [[0,"kitchen"]],
    types: placeholder as Registry['kitchen.dashboard']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
