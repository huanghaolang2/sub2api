export interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
}

export interface AppError {
  status: number
  code: string | number
  message: string
}
