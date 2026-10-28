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
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/parent/home_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/parent/home_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/parent/home_controller').default['show']>>>
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
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/kitchen/dashboard_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/kitchen/dashboard_controller').default['show']>>>
      rawResponse: ExtractRawResponse<Awaited<ReturnType<import('#controllers/kitchen/dashboard_controller').default['show']>>>
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
