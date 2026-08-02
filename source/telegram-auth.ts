import { Api, TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions/index.js'

const BASE_URL = 'https://walletbot.me'
const EXPIRY_SKEW_MS = 30_000

export type TelegramTokenSourceOptions = {
  session: string
  apiId: number
  apiHash: string
  bot?: string
  deviceSerial?: string
  baseUrl?: string
  fetch?: typeof fetch
}

type AuthResponse = {
  jwt: string
  refresh_token: string
  session_id: string
  access_token_expires_at: string
  access_token_expires_in: number
}

export class TelegramTokenSource {
  private readonly client: TelegramClient
  private readonly bot: string
  private readonly deviceSerial: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  private jwt: string | null = null
  private refreshToken: string | null = null
  private sessionId: string | null = null
  private expiresAt = 0

  constructor(options: TelegramTokenSourceOptions) {
    this.client = new TelegramClient(new StringSession(options.session), options.apiId, options.apiHash, {
      connectionRetries: 3
    })
    this.bot = options.bot ?? 'wallet'
    this.deviceSerial = options.deviceSerial ?? `web:${crypto.randomUUID()}`
    this.baseUrl = options.baseUrl ?? BASE_URL
    this.fetchImpl = options.fetch ?? fetch
  }

  async token(): Promise<string> {
    if (this.jwt && Date.now() < this.expiresAt - EXPIRY_SKEW_MS) return this.jwt
    if (this.refreshToken) {
      try {
        return await this.refresh()
      } catch {
        this.refreshToken = null
      }
    }
    return this.authenticate()
  }

  private async authenticate(): Promise<string> {
    if (!this.client.connected) await this.client.connect()
    const result = (await this.client.invoke(
      new Api.messages.RequestWebView({ peer: this.bot, bot: this.bot, platform: 'web', fromBotMenu: true })
    )) as { url: string }
    const initData = new URLSearchParams(new URL(result.url).hash.slice(1)).get('tgWebAppData')
    if (!initData) throw new Error('no tgWebAppData in web view url')
    return this.store(await this.post('/alectryon/public-api/auth', { web_view_init_data_raw: initData }))
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

  private store(data: AuthResponse): string {
    this.jwt = data.jwt
    this.refreshToken = data.refresh_token
    this.sessionId = data.session_id
    const parsed = Date.parse(data.access_token_expires_at)
    this.expiresAt = Number.isNaN(parsed) ? Date.now() + (data.access_token_expires_in ?? 300) * 1000 : parsed
    return this.jwt
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect()
  }
}
