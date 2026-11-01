import { Api, errors, TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions/index.js'
import { BROWSER_HEADERS } from '~/browser.ts'
import { defaultTokenPath, fileTokenStorage } from '~/telegram/file-storage.ts'

const BASE_URL = 'https://walletbot.me'
const AUTH_URL = 'https://alectryon.walletbot.me'
const EXPIRY_SKEW_MS = 30_000
const MAX_FLOOD_WAIT_MS = 60_000

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

export type TelegramTokenSourceOptions = {
  session: string
  apiId: number
  apiHash: string
  bot?: string
  deviceSerial?: string
  /** Origin of the web app, sent as `origin` and `referer`. */
  baseUrl?: string
  /** Where the auth and refresh requests go. */
  authUrl?: string
  fetch?: typeof fetch
  /** Defaults to a file in the user cache directory; `false` keeps the token in memory. */
  storage?: TokenStorage | false
  maxFloodWaitMs?: number
}

type AuthResponse = {
  jwt: string
  refresh_token: string
  session_id: string
  access_token_expires_at: string
  access_token_expires_in: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

class AuthEndpointError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export class TelegramTokenSource {
  private readonly client: TelegramClient
  private readonly bot: string
  private readonly baseUrl: string
  private readonly authUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly storage: TokenStorage | undefined
  private readonly maxFloodWaitMs: number

  private deviceSerial: string
  private deviceSerialKnown: boolean
  private jwt: string | null = null
  private refreshToken: string | null = null
  private sessionId: string | null = null
  private expiresAt = 0
  private restored = false
  private pending: Promise<string> | null = null

  constructor(options: TelegramTokenSourceOptions) {
    this.client = new TelegramClient(new StringSession(options.session), options.apiId, options.apiHash, {
      connectionRetries: 3
    })
    this.bot = options.bot ?? 'walt'
    this.deviceSerial = options.deviceSerial ?? `weba:${crypto.randomUUID()}`
    this.deviceSerialKnown = options.deviceSerial !== undefined
    this.baseUrl = options.baseUrl ?? BASE_URL
    this.authUrl = options.authUrl ?? AUTH_URL
    this.fetchImpl = options.fetch ?? fetch
    this.storage =
      options.storage === false ? undefined : (options.storage ?? fileTokenStorage(defaultTokenPath(options.session)))
    this.maxFloodWaitMs = options.maxFloodWaitMs ?? MAX_FLOOD_WAIT_MS
  }

  /**
   * @param rejected - A token the API answered with 401. If it is the cached one, it is renewed even before expiry.
   */
  async token(rejected?: string): Promise<string> {
    if (rejected !== undefined && rejected === this.jwt) this.expiresAt = 0
    if (this.fresh()) return this.jwt as string
    this.pending ??= this.resolve()
    try {
      return await this.pending
    } finally {
      this.pending = null
    }
  }

  private fresh(): boolean {
    return this.jwt !== null && Date.now() < this.expiresAt - EXPIRY_SKEW_MS
  }

  private async resolve(): Promise<string> {
    await this.restore()
    if (this.fresh()) return this.jwt as string
    if (this.refreshToken) {
      try {
        return await this.refresh()
      } catch (error) {
        const rejected =
          error instanceof AuthEndpointError && error.status >= 400 && error.status < 500 && error.status !== 429
        if (!rejected) throw error
        this.refreshToken = null
      }
    }
    return this.authenticate()
  }

  private async restore(): Promise<void> {
    if (this.restored || !this.storage) return
    this.restored = true
    const state = await this.storage.load()
    if (!state) return
    this.jwt = state.jwt
    this.refreshToken = state.refreshToken
    this.sessionId = state.sessionId
    this.expiresAt = state.expiresAt
    this.deviceSerial = state.deviceSerial
    this.deviceSerialKnown = true
  }

  private async authenticate(): Promise<string> {
    const initData = await this.requestInitData()
    const serial = this.deviceSerialKnown
      ? { device_serial: this.deviceSerial }
      : { device_serial_fallback: this.deviceSerial }
    const token = await this.store(
      await this.post('/alectryon/public-api/auth', {
        web_view_init_data_raw: initData,
        ep: 'menu',
        device_serial_multi_domain_backup_supported: true,
        ...serial
      })
    )
    this.deviceSerialKnown = true
    return token
  }

  private async requestInitData(retryAfterFlood = true): Promise<string> {
    if (!this.client.connected) await this.client.connect()

    let result: { url: string }
    try {
      result = (await this.client.invoke(
        new Api.messages.RequestWebView({ peer: this.bot, bot: this.bot, platform: 'web', fromBotMenu: true })
      )) as { url: string }
    } catch (error) {
      if (!retryAfterFlood || !(error instanceof errors.FloodWaitError)) throw error
      const waitMs = error.seconds * 1000
      if (waitMs > this.maxFloodWaitMs) {
        throw new Error(`telegram rate limited for ${error.seconds}s, above maxFloodWaitMs of ${this.maxFloodWaitMs}`)
      }
      await sleep(waitMs)
      return this.requestInitData(false)
    }

    const initData = new URLSearchParams(new URL(result.url).hash.slice(1)).get('tgWebAppData')
    if (!initData) throw new Error('no tgWebAppData in web view url')
    return initData
  }

  private async refresh(): Promise<string> {
    return this.store(
      await this.post('/alectryon/public-api/auth-refresh', {
        session_id: this.sessionId,
        refresh_token: this.refreshToken,
        device_serial: this.deviceSerial
      })
    )
  }

  private async post(path: string, body: Record<string, unknown>): Promise<AuthResponse> {
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

  private async store(data: AuthResponse): Promise<string> {
    this.jwt = data.jwt
    this.refreshToken = data.refresh_token
    this.sessionId = data.session_id
    if (Number.isFinite(data.access_token_expires_in)) {
      this.expiresAt = Date.now() + data.access_token_expires_in * 1000
    } else {
      const parsed = Date.parse(data.access_token_expires_at)
      this.expiresAt = Number.isNaN(parsed) ? Date.now() + 300_000 : parsed
    }

    await this.storage?.save({
      jwt: this.jwt,
      refreshToken: this.refreshToken,
      sessionId: this.sessionId,
      expiresAt: this.expiresAt,
      deviceSerial: this.deviceSerial
    })

    return this.jwt
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect()
  }
}
