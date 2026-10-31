import { Api, errors, TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions/index.js'
import { defaultTokenPath, fileTokenStorage } from '~/telegram/file-storage.ts'

const BASE_URL = 'https://walletbot.me'
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
  baseUrl?: string
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

export class TelegramTokenSource {
  private readonly client: TelegramClient
  private readonly bot: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly storage: TokenStorage | undefined
  private readonly maxFloodWaitMs: number

  private deviceSerial: string
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
    this.deviceSerial = options.deviceSerial ?? `web:${crypto.randomUUID()}`
    this.baseUrl = options.baseUrl ?? BASE_URL
    this.fetchImpl = options.fetch ?? fetch
    this.storage =
      options.storage === false ? undefined : (options.storage ?? fileTokenStorage(defaultTokenPath(options.session)))
    this.maxFloodWaitMs = options.maxFloodWaitMs ?? MAX_FLOOD_WAIT_MS
  }

  async token(): Promise<string> {
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
      } catch {
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
  }

  private async authenticate(): Promise<string> {
    const initData = await this.requestInitData()
    return this.store(await this.post('/alectryon/public-api/auth', { web_view_init_data_raw: initData }))
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
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body)
    })
    if (!response.ok) throw new Error(`${path} failed (${response.status}): ${(await response.text()).slice(0, 120)}`)
    return (await response.json()) as AuthResponse
  }

  private async store(data: AuthResponse): Promise<string> {
    this.jwt = data.jwt
    this.refreshToken = data.refresh_token
    this.sessionId = data.session_id
    const parsed = Date.parse(data.access_token_expires_at)
    this.expiresAt = Number.isNaN(parsed) ? Date.now() + (data.access_token_expires_in ?? 300) * 1000 : parsed

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
