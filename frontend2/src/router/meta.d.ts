import 'vue-router'
import type { RouteFeature } from './contracts'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    requiresAdmin?: boolean
    title?: string
    titleKey?: string
    descriptionKey?: string
    feature?: RouteFeature
    hideInSimpleMode?: boolean
  }
}
