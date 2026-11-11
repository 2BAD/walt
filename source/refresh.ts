import { BROWSER_HEADERS } from '~/browser.ts'
import { WaltAuthError } from '~/transport.ts'

const BASE_URL = 'https://walletbot.me'
const AUTH_URL = 'https://alectryon.walletbot.me'
const EXPIRY_SKEW_MS = 30_000

export type TokenState = {
  jwt: string
  refreshToken: string
  sessionId: string
  expiresAt: number
  deviceSerial: string
}

export type TokenStorage = {
  load: () => Promise<TokenState | null>
  save: (state: TokenState) => Promise<void>
}

export type RefreshTokenSourceOptions = {
  /** Where to start. Without it the state comes from `storage.load()`. */
  state?: TokenState
  /** `save` receives the new state after every renewal, rotated refresh token included. */
  storage?: TokenStorage | undefined
  /** Origin of the web app, sent as `origin` and `referer`. */
  baseUrl?: string | undefined
  /** Where the refresh requests go. */
  authUrl?: string | undefined
  fetch?: typeof fetch | undefined
}

export type AuthResponse = {
  jwt: string
  refresh_token: string
  session_id: string
  access_token_expires_at: string
  access_token_expires_in: number
}

class AuthEndpointError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const isRejection = (error: unknown): boolean =>
  error instanceof AuthEndpointError && error.status >= 400 && error.status < 500 && error.status !== 429

/**
 * Renews the access token from a stored refresh token over HTTPS, without Telegram.
 * Throws `WaltAuthError` once the refresh token is rejected; a new token state is then needed.
 */
export class RefreshTokenSource {
  protected readonly baseUrl: string
  protected readonly storage: TokenStorage | undefined
  protected state: TokenState | null
  private readonly authUrl: string
  private readonly fetchImpl: typeof fetch
  private restored: boolean
  private pending: Promise<string> | null = null

  constructor(options: RefreshTokenSourceOptions) {
    this.state = options.state ?? null
    this.storage = options.storage
    this.restored = options.state !== undefined
    this.baseUrl = options.baseUrl ?? BASE_URL
    this.authUrl = options.authUrl ?? AUTH_URL
    this.fetchImpl = options.fetch ?? fetch
  }

  /**
   * @param rejected - A token the API answered with 401. If it is the cached one, it is renewed even before expiry.
   */
  async token(rejected?: string): Promise<string> {
    if (this.state && rejected !== undefined && rejected === this.state.jwt) {
      this.state = { ...this.state, expiresAt: 0 }
    }
    if (this.state && this.fresh(this.state)) return this.state.jwt
    this.pending ??= this.resolve()
    try {
      return await this.pending
    } finally {
      this.pending = null
    }
  }

  private fresh(state: TokenState): boolean {
    return Date.now() < state.expiresAt - EXPIRY_SKEW_MS
  }

  private async resolve(): Promise<string> {
    await this.restore()
    const state = this.state
    if (state && this.fresh(state)) return state.jwt
    if (state?.refreshToken) {
      try {
        return await this.refresh(state)
      } catch (error) {
        if (!isRejection(error)) throw error
        this.state = { ...state, refreshToken: '' }
        return this.signIn(error)
      }
    }
    return this.signIn()
  }

  private async restore(): Promise<void> {
    if (this.restored || !this.storage) return
    this.restored = true
    this.state = await this.storage.load()
  }

  /**
   * Called when there is no refresh token to use, or the server rejected it.
   *
   * @param cause - The rejection, if there was one.
   * @returns The new jwt.
   */
  protected signIn(cause?: unknown): Promise<string> {
    const message = this.state ? 'refresh token rejected, a new token state is needed' : 'no token state to refresh'
    return Promise.reject(new WaltAuthError(message, { cause }))
  }

  private async refresh(state: TokenState): Promise<string> {
    const data = await this.post('/alectryon/public-api/auth-refresh', {
      session_id: state.sessionId,
      refresh_token: state.refreshToken,
      device_serial: state.deviceSerial
    })
    return this.store(data, state.deviceSerial)
  }

  protected async post(path: string, body: Record<string, unknown>): Promise<AuthResponse> {
    const response = await this.fetchImpl(`${this.authUrl}${path}`, {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        accept: '*/*',
        'sec-fetch-site': new URL(this.authUrl).origin === new URL(this.baseUrl).origin ? 'same-origin' : 'same-site',
        'content-type': 'application/json',
        origin: this.baseUrl,
        referer: `${this.baseUrl}/`,
        'x-wallet-tz-name': Intl.DateTimeFormat().resolvedOptions().timeZone,
        'x-wallet-tz-offset': String(-new Date().getTimezoneOffset())
      },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      throw new AuthEndpointError(`${path} failed (${response.status}): ${await response.text()}`, response.status)
    }
    return (await response.json()) as AuthResponse
  }

  protected async store(data: AuthResponse, deviceSerial: string): Promise<string> {
    let expiresAt: number
    if (Number.isFinite(data.access_token_expires_in)) {
      expiresAt = Date.now() + data.access_token_expires_in * 1000
    } else {
      const parsed = Date.parse(data.access_token_expires_at)
      expiresAt = Number.isNaN(parsed) ? Date.now() + 300_000 : parsed
    }
    const state = {
      jwt: data.jwt,
      refreshToken: data.refresh_token,
      sessionId: data.session_id,
      expiresAt,
      deviceSerial
    }
    this.state = state
    await this.storage?.save(state)
    return state.jwt
  }
}
