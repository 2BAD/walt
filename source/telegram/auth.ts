import { Api, errors, TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions/index.js'
import { RefreshTokenSource, type TokenStorage } from '~/refresh.ts'
import { defaultTokenPath, fileTokenStorage } from '~/telegram/file-storage.ts'

const MAX_FLOOD_WAIT_MS = 60_000

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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Signs in over Telegram, then renews like `RefreshTokenSource`, signing in again when the refresh token is rejected. */
export class TelegramTokenSource extends RefreshTokenSource {
  private readonly client: TelegramClient
  private readonly bot: string
  private readonly maxFloodWaitMs: number
  private readonly knownDeviceSerial: string | undefined
  private readonly newDeviceSerial = `weba:${crypto.randomUUID()}`

  constructor(options: TelegramTokenSourceOptions) {
    super({
      storage:
        options.storage === false
          ? undefined
          : (options.storage ?? fileTokenStorage(defaultTokenPath(options.session))),
      baseUrl: options.baseUrl,
      authUrl: options.authUrl,
      fetch: options.fetch
    })
    this.client = new TelegramClient(new StringSession(options.session), options.apiId, options.apiHash, {
      connectionRetries: 3
    })
    this.bot = options.bot ?? 'walt'
    this.knownDeviceSerial = options.deviceSerial
    this.maxFloodWaitMs = options.maxFloodWaitMs ?? MAX_FLOOD_WAIT_MS
  }

  protected override async signIn(): Promise<string> {
    const initData = await this.requestInitData()
    const known = this.state?.deviceSerial ?? this.knownDeviceSerial
    const serial = known === undefined ? { device_serial_fallback: this.newDeviceSerial } : { device_serial: known }
    const data = await this.post('/alectryon/public-api/auth', {
      web_view_init_data_raw: initData,
      ep: 'menu',
      device_serial_multi_domain_backup_supported: true,
      ...serial
    })
    return this.store(data, known ?? this.newDeviceSerial)
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

  async disconnect(): Promise<void> {
    await this.client.disconnect()
  }
}
