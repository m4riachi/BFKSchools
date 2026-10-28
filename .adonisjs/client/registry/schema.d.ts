/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractRawResponse, ExtractResponse, Method, PathWithRegistry, PatternsByMethod, RouteWithRegistry } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'
import type { routes } from './index.ts'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'session.create': {
    methods: ["GET","HEAD"]
    pattern: '/login'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/session_controller').default['create']>>>
    }
  }
  'session.store': {
    methods: ["POST"]
    pattern: '/login'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').loginValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').loginValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'password.forgot': {
    methods: ["GET","HEAD"]
    pattern: '/password/forgot'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth/password_reset_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth/password_reset_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/auth/password_reset_controller').default['create']>>>
    }
  }
  'password.forgot.store': {
    methods: ["POST"]
    pattern: '/password/forgot'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/passwords').forgotPasswordValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/passwords').forgotPasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth/password_reset_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth/password_reset_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/auth/password_reset_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'invitation.show': {
    methods: ["GET","HEAD"]
    pattern: '/invitation/:token'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth/account_links_controller').default['showInvitation']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth/account_links_controller').default['showInvitation']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/auth/account_links_controller').default['showInvitation']>>>
    }
  }
  'invitation.accept': {
    methods: ["POST"]
    pattern: '/invitation/:token'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth/account_links_controller').default['acceptInvitation']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth/account_links_controller').default['acceptInvitation']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/auth/account_links_controller').default['acceptInvitation']>>>
    }
  }
  'password.reset': {
    methods: ["GET","HEAD"]
    pattern: '/password/reset/:token'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth/account_links_controller').default['showReset']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth/account_links_controller').default['showReset']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/auth/account_links_controller').default['showReset']>>>
    }
  }
  'password.reset.store': {
    methods: ["POST"]
    pattern: '/password/reset/:token'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth/account_links_controller').default['submitReset']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth/account_links_controller').default['submitReset']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/auth/account_links_controller').default['submitReset']>>>
    }
  }
  'locale.update': {
    methods: ["POST"]
    pattern: '/locale'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').localeValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').localeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/locale_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/locale_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/locale_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'session.destroy': {
    methods: ["POST"]
    pattern: '/logout'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
    }
  }
  'media.meal_photo': {
    methods: ["GET","HEAD"]
    pattern: '/media/meal-photos/:id/:variant'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; variant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/media_controller').default['mealPhoto']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/media_controller').default['mealPhoto']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/media_controller').default['mealPhoto']>>>
    }
  }
  'parent.home': {
    methods: ["GET","HEAD"]
    pattern: '/'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/orders').orderWeekQueryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['week']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['week']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['week']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'parent.orders.history': {
    methods: ["GET","HEAD"]
    pattern: '/orders/history'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/orders').orderHistoryQueryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['history']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['history']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['history']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'parent.orders.save': {
    methods: ["POST"]
    pattern: '/orders/:childId/days/:date'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/orders').daySelectionValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { childId: ParamValue; date: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/orders').daySelectionValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['saveDay']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['saveDay']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['saveDay']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'parent.orders.absent': {
    methods: ["POST"]
    pattern: '/orders/:childId/days/:date/absent'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { childId: ParamValue; date: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['cancelDay']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['cancelDay']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['cancelDay']>>>
    }
  }
  'parent.orders.apply_all': {
    methods: ["POST"]
    pattern: '/orders/days/:date/all'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/orders').applyAllValidator)>>
      paramsTuple: [ParamValue]
      params: { date: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/orders').applyAllValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['applyAll']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['applyAll']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/parent/orders_controller').default['applyAll']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.dashboard': {
    methods: ["GET","HEAD"]
    pattern: '/admin'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/dashboard_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/dashboard_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/dashboard_controller').default['show']>>>
    }
  }
  'admin.parents.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/parents'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/families').parentListValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.parents.create': {
    methods: ["GET","HEAD"]
    pattern: '/admin/parents/create'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['create']>>>
    }
  }
  'admin.parents.store': {
    methods: ["POST"]
    pattern: '/admin/parents'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/families').parentValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/families').parentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.parents.show': {
    methods: ["GET","HEAD"]
    pattern: '/admin/parents/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['show']>>>
    }
  }
  'admin.parents.edit': {
    methods: ["GET","HEAD"]
    pattern: '/admin/parents/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['edit']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['edit']>>>
    }
  }
  'admin.parents.update': {
    methods: ["PUT"]
    pattern: '/admin/parents/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/families').parentValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/families').parentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.parents.deactivate': {
    methods: ["POST"]
    pattern: '/admin/parents/:id/deactivate'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['deactivate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['deactivate']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['deactivate']>>>
    }
  }
  'admin.parents.activate': {
    methods: ["POST"]
    pattern: '/admin/parents/:id/activate'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['activate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['activate']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['activate']>>>
    }
  }
  'admin.parents.invite': {
    methods: ["POST"]
    pattern: '/admin/parents/:id/invitation'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['invite']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['invite']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/parents_controller').default['invite']>>>
    }
  }
  'admin.children.create': {
    methods: ["GET","HEAD"]
    pattern: '/admin/parents/:parentId/children/create'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { parentId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['create']>>>
    }
  }
  'admin.children.store': {
    methods: ["POST"]
    pattern: '/admin/parents/:parentId/children'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/families').childValidator)>>
      paramsTuple: [ParamValue]
      params: { parentId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/families').childValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.children.edit': {
    methods: ["GET","HEAD"]
    pattern: '/admin/parents/:parentId/children/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { parentId: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['edit']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['edit']>>>
    }
  }
  'admin.children.update': {
    methods: ["PUT"]
    pattern: '/admin/parents/:parentId/children/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/families').childValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { parentId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/families').childValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.children.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/parents/:parentId/children/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { parentId: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/children_controller').default['destroy']>>>
    }
  }
  'admin.children.subscriptions.store': {
    methods: ["POST"]
    pattern: '/admin/parents/:parentId/children/:childId/subscriptions'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/families').subscriptionValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { parentId: ParamValue; childId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/families').subscriptionValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/subscriptions_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/subscriptions_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/subscriptions_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.children.subscriptions.update': {
    methods: ["PUT"]
    pattern: '/admin/parents/:parentId/children/:childId/subscriptions/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/families').subscriptionValidator)>>
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { parentId: ParamValue; childId: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/families').subscriptionValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/subscriptions_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/subscriptions_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/subscriptions_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.children.subscriptions.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/parents/:parentId/children/:childId/subscriptions/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue, ParamValue]
      params: { parentId: ParamValue; childId: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/subscriptions_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/subscriptions_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/subscriptions_controller').default['destroy']>>>
    }
  }
  'admin.meals.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/meals'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['index']>>>
    }
  }
  'admin.meals.create': {
    methods: ["GET","HEAD"]
    pattern: '/admin/meals/create'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['create']>>>
    }
  }
  'admin.meals.store': {
    methods: ["POST"]
    pattern: '/admin/meals'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/meals').mealValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/meals').mealValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.meals.edit': {
    methods: ["GET","HEAD"]
    pattern: '/admin/meals/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['edit']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['edit']>>>
    }
  }
  'admin.meals.update': {
    methods: ["PUT"]
    pattern: '/admin/meals/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/meals').mealValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/meals').mealValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.meals.duplicate': {
    methods: ["POST"]
    pattern: '/admin/meals/:id/duplicate'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['duplicate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['duplicate']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['duplicate']>>>
    }
  }
  'admin.meals.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/meals/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/meals_controller').default['destroy']>>>
    }
  }
  'admin.meals.photos.store': {
    methods: ["POST"]
    pattern: '/admin/meals/:id/photos'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/meal_photos_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/meal_photos_controller').default['store']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/meal_photos_controller').default['store']>>>
    }
  }
  'admin.meals.photos.reorder': {
    methods: ["PUT"]
    pattern: '/admin/meals/:id/photos/order'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/meals').mealPhotoOrderValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/meals').mealPhotoOrderValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/meal_photos_controller').default['reorder']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/meal_photos_controller').default['reorder']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/meal_photos_controller').default['reorder']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.meals.photos.cover': {
    methods: ["POST"]
    pattern: '/admin/meals/:id/photos/:photoId/cover'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; photoId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/meal_photos_controller').default['cover']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/meal_photos_controller').default['cover']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/meal_photos_controller').default['cover']>>>
    }
  }
  'admin.meals.photos.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/meals/:id/photos/:photoId'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; photoId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/meal_photos_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/meal_photos_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/meal_photos_controller').default['destroy']>>>
    }
  }
  'admin.holidays.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/holidays'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/holidays').holidayListValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.holidays.store': {
    methods: ["POST"]
    pattern: '/admin/holidays'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/holidays').holidayCreateValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/holidays').holidayCreateValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.holidays.generate': {
    methods: ["POST"]
    pattern: '/admin/holidays/generate'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/holidays').holidayGenerateValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/holidays').holidayGenerateValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['generate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['generate']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['generate']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.holidays.settings': {
    methods: ["PUT"]
    pattern: '/admin/holidays/settings'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/holidays').holidaySettingsValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/holidays').holidaySettingsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['updateSettings']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['updateSettings']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['updateSettings']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.holidays.groups.update': {
    methods: ["PUT"]
    pattern: '/admin/holidays/groups/:groupId'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/holidays').holidayGroupUpdateValidator)>>
      paramsTuple: [ParamValue]
      params: { groupId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/holidays').holidayGroupUpdateValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['updateGroup']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['updateGroup']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['updateGroup']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.holidays.groups.toggle': {
    methods: ["POST"]
    pattern: '/admin/holidays/groups/:groupId/toggle'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/holidays').holidayToggleValidator)>>
      paramsTuple: [ParamValue]
      params: { groupId: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/holidays').holidayToggleValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['toggleGroup']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['toggleGroup']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['toggleGroup']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.holidays.groups.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/holidays/groups/:groupId'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { groupId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['destroyGroup']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['destroyGroup']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['destroyGroup']>>>
    }
  }
  'admin.holidays.update': {
    methods: ["PUT"]
    pattern: '/admin/holidays/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/holidays').holidayUpdateValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/holidays').holidayUpdateValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.holidays.toggle': {
    methods: ["POST"]
    pattern: '/admin/holidays/:id/toggle'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/holidays').holidayToggleValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/holidays').holidayToggleValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['toggle']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['toggle']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['toggle']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.holidays.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/holidays/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['destroy']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holidays_controller').default['destroy']>>>
    }
  }
  'admin.holidays.import.create': {
    methods: ["GET","HEAD"]
    pattern: '/admin/holidays/import'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['create']>>>
    }
  }
  'admin.holidays.import.upload': {
    methods: ["POST"]
    pattern: '/admin/holidays/import'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/holidays').icsUploadValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/holidays').icsUploadValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['upload']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['upload']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['upload']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.holidays.import.url': {
    methods: ["POST"]
    pattern: '/admin/holidays/import/url'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/holidays').icsUrlValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/holidays').icsUrlValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['fetchUrl']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['fetchUrl']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['fetchUrl']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.holidays.import.show': {
    methods: ["GET","HEAD"]
    pattern: '/admin/holidays/import/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['show']>>>
    }
  }
  'admin.holidays.import.confirm': {
    methods: ["POST"]
    pattern: '/admin/holidays/import/:id/confirm'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/holidays').icsConfirmValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/holidays').icsConfirmValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['confirm']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['confirm']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/holiday_imports_controller').default['confirm']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.menus.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/menus'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/menus').menuWeekQueryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.menus.show': {
    methods: ["GET","HEAD"]
    pattern: '/admin/menus/:week'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { week: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['show']>>>
    }
  }
  'admin.menus.items.store': {
    methods: ["POST"]
    pattern: '/admin/menus/:week/items'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/menus').menuItemCreateValidator)>>
      paramsTuple: [ParamValue]
      params: { week: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/menus').menuItemCreateValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['storeItem']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['storeItem']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['storeItem']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.menus.items.update': {
    methods: ["PUT"]
    pattern: '/admin/menus/:week/items/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/menus').menuItemUpdateValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { week: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/menus').menuItemUpdateValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['updateItem']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['updateItem']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['updateItem']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.menus.items.default': {
    methods: ["POST"]
    pattern: '/admin/menus/:week/items/:id/default'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { week: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['setDefault']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['setDefault']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['setDefault']>>>
    }
  }
  'admin.menus.items.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/menus/:week/items/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/orders').menuItemRemovalValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { week: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/orders').menuItemRemovalValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['destroyItem']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['destroyItem']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['destroyItem']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.menus.items.remove': {
    methods: ["GET","HEAD"]
    pattern: '/admin/menus/:week/items/:id/remove'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { week: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['removeItemImpact']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['removeItemImpact']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['removeItemImpact']>>>
    }
  }
  'admin.menus.copy': {
    methods: ["POST"]
    pattern: '/admin/menus/:week/copy-previous'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { week: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['copyPrevious']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['copyPrevious']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['copyPrevious']>>>
    }
  }
  'admin.menus.templates.apply': {
    methods: ["POST"]
    pattern: '/admin/menus/:week/apply-template'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/menus').menuTemplateApplyValidator)>>
      paramsTuple: [ParamValue]
      params: { week: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/menus').menuTemplateApplyValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['applyTemplate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['applyTemplate']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['applyTemplate']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.menus.templates.save': {
    methods: ["POST"]
    pattern: '/admin/menus/:week/save-template'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/menus').menuTemplateSaveValidator)>>
      paramsTuple: [ParamValue]
      params: { week: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/menus').menuTemplateSaveValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['saveTemplate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['saveTemplate']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['saveTemplate']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.menus.times': {
    methods: ["PUT"]
    pattern: '/admin/menus/:week/times'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/menus').menuTimesValidator)>>
      paramsTuple: [ParamValue]
      params: { week: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/menus').menuTimesValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['updateTimes']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['updateTimes']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['updateTimes']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.menus.schedule': {
    methods: ["POST"]
    pattern: '/admin/menus/:week/schedule'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { week: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['schedule']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['schedule']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['schedule']>>>
    }
  }
  'admin.menus.unschedule': {
    methods: ["POST"]
    pattern: '/admin/menus/:week/unschedule'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { week: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['unschedule']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['unschedule']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['unschedule']>>>
    }
  }
  'admin.menus.publish': {
    methods: ["POST"]
    pattern: '/admin/menus/:week/publish'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { week: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['publish']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['publish']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['publish']>>>
    }
  }
  'admin.menu_templates.destroy': {
    methods: ["DELETE"]
    pattern: '/admin/menu-templates/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['destroyTemplate']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['destroyTemplate']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/weekly_menus_controller').default['destroyTemplate']>>>
    }
  }
  'admin.orders.index': {
    methods: ["GET","HEAD"]
    pattern: '/admin/orders'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/orders').adminOrderListValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/orders_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/orders_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/orders_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.orders.child': {
    methods: ["GET","HEAD"]
    pattern: '/admin/orders/children/:childId'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { childId: ParamValue }
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/orders').orderWeekQueryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/orders_controller').default['childWeek']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/orders_controller').default['childWeek']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/orders_controller').default['childWeek']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.orders.save': {
    methods: ["POST"]
    pattern: '/admin/orders/children/:childId/days/:date'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/orders').staffDaySelectionValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { childId: ParamValue; date: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/orders').staffDaySelectionValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/orders_controller').default['saveDay']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/orders_controller').default['saveDay']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/orders_controller').default['saveDay']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.orders.cancel': {
    methods: ["POST"]
    pattern: '/admin/orders/children/:childId/days/:date/cancel'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/orders').staffCancelValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { childId: ParamValue; date: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/orders').staffCancelValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/orders_controller').default['cancelDay']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/orders_controller').default['cancelDay']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/orders_controller').default['cancelDay']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.settings.show': {
    methods: ["GET","HEAD"]
    pattern: '/admin/settings'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['show']>>>
    }
  }
  'admin.settings.update': {
    methods: ["PUT"]
    pattern: '/admin/settings'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/school_settings').schoolSettingsFormValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/school_settings').schoolSettingsFormValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/settings_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.imports.create': {
    methods: ["GET","HEAD"]
    pattern: '/admin/imports/families'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['create']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['create']>>>
    }
  }
  'admin.imports.template': {
    methods: ["GET","HEAD"]
    pattern: '/admin/imports/families/template'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['template']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['template']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['template']>>>
    }
  }
  'admin.imports.upload': {
    methods: ["POST"]
    pattern: '/admin/imports/families'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/imports').importUploadValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/imports').importUploadValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['upload']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['upload']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['upload']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'admin.imports.show': {
    methods: ["GET","HEAD"]
    pattern: '/admin/imports/families/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['show']>>>
    }
  }
  'admin.imports.confirm': {
    methods: ["POST"]
    pattern: '/admin/imports/families/:id/confirm'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/imports').importConfirmValidator)>>
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#validators/imports').importConfirmValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['confirm']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['confirm']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/admin/family_imports_controller').default['confirm']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'kitchen.dashboard': {
    methods: ["GET","HEAD"]
    pattern: '/kitchen'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/reports').reportDayValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/kitchen/dashboard_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/kitchen/dashboard_controller').default['show']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/kitchen/dashboard_controller').default['show']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'kitchen.allergies': {
    methods: ["GET","HEAD"]
    pattern: '/kitchen/allergies'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/reports').reportDayValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['allergies']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['allergies']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['allergies']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'kitchen.labels': {
    methods: ["GET","HEAD"]
    pattern: '/kitchen/labels'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['labels']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['labels']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['labels']>>>
    }
  }
  'kitchen.labels.pdf': {
    methods: ["GET","HEAD"]
    pattern: '/kitchen/labels/pdf'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/reports').labelsQueryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['labelsPdf']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['labelsPdf']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['labelsPdf']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'kitchen.exports': {
    methods: ["GET","HEAD"]
    pattern: '/kitchen/exports'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['exports']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['exports']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['exports']>>>
    }
  }
  'kitchen.exports.download': {
    methods: ["GET","HEAD"]
    pattern: '/kitchen/exports/download'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: ExtractQueryForGet<InferInput<(typeof import('#validators/reports').exportQueryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['download']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['download']>>> | { status: 422; response: { errors: SimpleError[] } }
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/kitchen/reports_controller').default['download']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'kitchen.meals.index': {
    methods: ["GET","HEAD"]
    pattern: '/kitchen/meals'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/kitchen/meals_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/kitchen/meals_controller').default['index']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/kitchen/meals_controller').default['index']>>>
    }
  }
  'kitchen.meals.show': {
    methods: ["GET","HEAD"]
    pattern: '/kitchen/meals/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/kitchen/meals_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/kitchen/meals_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/kitchen/meals_controller').default['show']>>>
    }
  }
}

export namespace Route {
  export type Request<Name extends keyof typeof routes> = RouteWithRegistry.Request<typeof routes, Name>
  export type Response<Name extends keyof typeof routes> = RouteWithRegistry.Response<typeof routes, Name>
  export type Params<Name extends keyof typeof routes> = RouteWithRegistry.Params<typeof routes, Name>
  export type Body<Name extends keyof typeof routes> = RouteWithRegistry.Body<typeof routes, Name>
  export type Query<Name extends keyof typeof routes> = RouteWithRegistry.Query<typeof routes, Name>
  export type Error<Name extends keyof typeof routes> = RouteWithRegistry.Error<typeof routes, Name>
}

export namespace Path {
  export type Request<M extends Method, P extends PatternsByMethod<typeof routes, M>> =
    PathWithRegistry.Request<typeof routes, M, P>
  export type Response<M extends Method, P extends PatternsByMethod<typeof routes, M>> =
    PathWithRegistry.Response<typeof routes, M, P>
  export type Params<M extends Method, P extends PatternsByMethod<typeof routes, M>> =
    PathWithRegistry.Params<typeof routes, M, P>
  export type Body<M extends Method, P extends PatternsByMethod<typeof routes, M>> =
    PathWithRegistry.Body<typeof routes, M, P>
  export type Query<M extends Method, P extends PatternsByMethod<typeof routes, M>> =
    PathWithRegistry.Query<typeof routes, M, P>
  export type Error<M extends Method, P extends PatternsByMethod<typeof routes, M>> =
    PathWithRegistry.Error<typeof routes, M, P>
}
