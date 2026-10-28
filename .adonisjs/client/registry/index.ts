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
  'password.forgot': {
    methods: ["GET","HEAD"],
    pattern: '/password/forgot',
    tokens: [[0,"password"],[0,"forgot"]],
    types: placeholder as Registry['password.forgot']['types'],
  },
  'password.forgot.store': {
    methods: ["POST"],
    pattern: '/password/forgot',
    tokens: [[0,"password"],[0,"forgot"]],
    types: placeholder as Registry['password.forgot.store']['types'],
  },
  'invitation.show': {
    methods: ["GET","HEAD"],
    pattern: '/invitation/:token',
    tokens: [[0,"invitation"],[1,"token"]],
    types: placeholder as Registry['invitation.show']['types'],
  },
  'invitation.accept': {
    methods: ["POST"],
    pattern: '/invitation/:token',
    tokens: [[0,"invitation"],[1,"token"]],
    types: placeholder as Registry['invitation.accept']['types'],
  },
  'password.reset': {
    methods: ["GET","HEAD"],
    pattern: '/password/reset/:token',
    tokens: [[0,"password"],[0,"reset"],[1,"token"]],
    types: placeholder as Registry['password.reset']['types'],
  },
  'password.reset.store': {
    methods: ["POST"],
    pattern: '/password/reset/:token',
    tokens: [[0,"password"],[0,"reset"],[1,"token"]],
    types: placeholder as Registry['password.reset.store']['types'],
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
  'admin.parents.index': {
    methods: ["GET","HEAD"],
    pattern: '/admin/parents',
    tokens: [[0,"admin"],[0,"parents"]],
    types: placeholder as Registry['admin.parents.index']['types'],
  },
  'admin.parents.create': {
    methods: ["GET","HEAD"],
    pattern: '/admin/parents/create',
    tokens: [[0,"admin"],[0,"parents"],[0,"create"]],
    types: placeholder as Registry['admin.parents.create']['types'],
  },
  'admin.parents.store': {
    methods: ["POST"],
    pattern: '/admin/parents',
    tokens: [[0,"admin"],[0,"parents"]],
    types: placeholder as Registry['admin.parents.store']['types'],
  },
  'admin.parents.show': {
    methods: ["GET","HEAD"],
    pattern: '/admin/parents/:id',
    tokens: [[0,"admin"],[0,"parents"],[1,"id"]],
    types: placeholder as Registry['admin.parents.show']['types'],
  },
  'admin.parents.edit': {
    methods: ["GET","HEAD"],
    pattern: '/admin/parents/:id/edit',
    tokens: [[0,"admin"],[0,"parents"],[1,"id"],[0,"edit"]],
    types: placeholder as Registry['admin.parents.edit']['types'],
  },
  'admin.parents.update': {
    methods: ["PUT"],
    pattern: '/admin/parents/:id',
    tokens: [[0,"admin"],[0,"parents"],[1,"id"]],
    types: placeholder as Registry['admin.parents.update']['types'],
  },
  'admin.parents.deactivate': {
    methods: ["POST"],
    pattern: '/admin/parents/:id/deactivate',
    tokens: [[0,"admin"],[0,"parents"],[1,"id"],[0,"deactivate"]],
    types: placeholder as Registry['admin.parents.deactivate']['types'],
  },
  'admin.parents.activate': {
    methods: ["POST"],
    pattern: '/admin/parents/:id/activate',
    tokens: [[0,"admin"],[0,"parents"],[1,"id"],[0,"activate"]],
    types: placeholder as Registry['admin.parents.activate']['types'],
  },
  'admin.parents.invite': {
    methods: ["POST"],
    pattern: '/admin/parents/:id/invitation',
    tokens: [[0,"admin"],[0,"parents"],[1,"id"],[0,"invitation"]],
    types: placeholder as Registry['admin.parents.invite']['types'],
  },
  'admin.children.create': {
    methods: ["GET","HEAD"],
    pattern: '/admin/parents/:parentId/children/create',
    tokens: [[0,"admin"],[0,"parents"],[1,"parentId"],[0,"children"],[0,"create"]],
    types: placeholder as Registry['admin.children.create']['types'],
  },
  'admin.children.store': {
    methods: ["POST"],
    pattern: '/admin/parents/:parentId/children',
    tokens: [[0,"admin"],[0,"parents"],[1,"parentId"],[0,"children"]],
    types: placeholder as Registry['admin.children.store']['types'],
  },
  'admin.children.edit': {
    methods: ["GET","HEAD"],
    pattern: '/admin/parents/:parentId/children/:id/edit',
    tokens: [[0,"admin"],[0,"parents"],[1,"parentId"],[0,"children"],[1,"id"],[0,"edit"]],
    types: placeholder as Registry['admin.children.edit']['types'],
  },
  'admin.children.update': {
    methods: ["PUT"],
    pattern: '/admin/parents/:parentId/children/:id',
    tokens: [[0,"admin"],[0,"parents"],[1,"parentId"],[0,"children"],[1,"id"]],
    types: placeholder as Registry['admin.children.update']['types'],
  },
  'admin.children.destroy': {
    methods: ["DELETE"],
    pattern: '/admin/parents/:parentId/children/:id',
    tokens: [[0,"admin"],[0,"parents"],[1,"parentId"],[0,"children"],[1,"id"]],
    types: placeholder as Registry['admin.children.destroy']['types'],
  },
  'admin.children.subscriptions.store': {
    methods: ["POST"],
    pattern: '/admin/parents/:parentId/children/:childId/subscriptions',
    tokens: [[0,"admin"],[0,"parents"],[1,"parentId"],[0,"children"],[1,"childId"],[0,"subscriptions"]],
    types: placeholder as Registry['admin.children.subscriptions.store']['types'],
  },
  'admin.children.subscriptions.update': {
    methods: ["PUT"],
    pattern: '/admin/parents/:parentId/children/:childId/subscriptions/:id',
    tokens: [[0,"admin"],[0,"parents"],[1,"parentId"],[0,"children"],[1,"childId"],[0,"subscriptions"],[1,"id"]],
    types: placeholder as Registry['admin.children.subscriptions.update']['types'],
  },
  'admin.children.subscriptions.destroy': {
    methods: ["DELETE"],
    pattern: '/admin/parents/:parentId/children/:childId/subscriptions/:id',
    tokens: [[0,"admin"],[0,"parents"],[1,"parentId"],[0,"children"],[1,"childId"],[0,"subscriptions"],[1,"id"]],
    types: placeholder as Registry['admin.children.subscriptions.destroy']['types'],
  },
  'admin.imports.create': {
    methods: ["GET","HEAD"],
    pattern: '/admin/imports/families',
    tokens: [[0,"admin"],[0,"imports"],[0,"families"]],
    types: placeholder as Registry['admin.imports.create']['types'],
  },
  'admin.imports.template': {
    methods: ["GET","HEAD"],
    pattern: '/admin/imports/families/template',
    tokens: [[0,"admin"],[0,"imports"],[0,"families"],[0,"template"]],
    types: placeholder as Registry['admin.imports.template']['types'],
  },
  'admin.imports.upload': {
    methods: ["POST"],
    pattern: '/admin/imports/families',
    tokens: [[0,"admin"],[0,"imports"],[0,"families"]],
    types: placeholder as Registry['admin.imports.upload']['types'],
  },
  'admin.imports.show': {
    methods: ["GET","HEAD"],
    pattern: '/admin/imports/families/:id',
    tokens: [[0,"admin"],[0,"imports"],[0,"families"],[1,"id"]],
    types: placeholder as Registry['admin.imports.show']['types'],
  },
  'admin.imports.confirm': {
    methods: ["POST"],
    pattern: '/admin/imports/families/:id/confirm',
    tokens: [[0,"admin"],[0,"imports"],[0,"families"],[1,"id"],[0,"confirm"]],
    types: placeholder as Registry['admin.imports.confirm']['types'],
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
