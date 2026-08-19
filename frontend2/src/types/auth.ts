export enum Role {
  USER = 'user',
  ADMIN = 'admin'
}

export enum AccountStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled'
}

export interface User {
  id: number
  username: string
  email: string
  avatar_url?: string | null
  role: Role
  balance: number
  concurrency: number
  status: AccountStatus
  allowed_groups: number[] | null
  created_at: string
  updated_at: string
}

export interface AuthResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type: string
  user: User
}

export interface LoginRequest {
  email: string
  password: string
}
