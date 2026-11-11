import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { errors } from 'teleproto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TokenState, TokenStorage } from '~/refresh.ts'
import { TelegramTokenSource } from '~/telegram/auth.ts'

const telegram = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  invoke: vi.fn<() => Promise<{ url: string }>>(async () => ({
    url: 'https://walletbot.me/#tgWebAppData=init-data-raw&tgWebAppVersion=7.0'
  })),
  disconnect: vi.fn<() => Promise<void>>()
}))

vi.mock('teleproto', () => ({
  TelegramClient: class {
    connected = false
    connect = telegram.connect
    invoke = telegram.invoke
    disconnect = telegram.disconnect
  },
  Api: { messages: { RequestWebView: vi.fn<(params: Record<string, unknown>) => void>() } },
  errors: {
    FloodWaitError: class FloodWaitError extends Error {
      seconds: number

      constructor(args: { request: unknown; capture?: number | null }) {
        super(`FLOOD_WAIT_${args.capture}`)
        this.seconds = args.capture ?? 0
      }
    }
  }
}))

vi.mock('teleproto/sessions/index.js', () => ({ StringSession: vi.fn<(session: string) => void>() }))

const authPayload = (overrides: Record<string, unknown> = {}) => ({
  jwt: 'jwt-one',
  refresh_token: 'refresh-one',
  session_id: 'session-one',
  access_token_expires_at: new Date(Date.now() + 300_000).toISOString(),
  access_token_expires_in: 300,
  ...overrides
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const makeSource = (fetchImpl: typeof fetch, extra: Partial<{ storage: TokenStorage; deviceSerial: string }> = {}) =>
  new TelegramTokenSource({
    session: 'session-string',
    apiId: 1234,
    apiHash: 'hash',
    fetch: fetchImpl,
    storage: false,
    ...extra
  })

const memoryStorage = (initial: TokenState | null = null) => {
  let state = initial
  return {
    load: vi.fn<TokenStorage['load']>(async () => state),
    save: vi.fn<TokenStorage['save']>(async (next) => {
      state = next
    }),
    current: () => state
  }
}

const pathsOf = (fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>) =>
  fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname)

describe('telegramTokenSource', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('authenticates through the web view and returns the jwt', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    const token = await makeSource(fetchImpl).token()

    expect(token).toBe('jwt-one')
    expect(telegram.connect).toHaveBeenCalledTimes(1)
    expect(pathsOf(fetchImpl)).toStrictEqual(['/alectryon/public-api/auth'])
  })

  it('opens the web view of the walt bot by default', async () => {
    expect.assertions(1)

    const { Api } = await import('teleproto')
    await makeSource(vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))).token()

    expect(Api.messages.RequestWebView).toHaveBeenCalledWith(expect.objectContaining({ peer: 'walt', bot: 'walt' }))
  })

  it('forwards the raw init data from the web view url', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    await makeSource(fetchImpl).token()

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>

    expect(body['web_view_init_data_raw']).toBe('init-data-raw')
  })

  it('throws when the web view url carries no tgWebAppData', async () => {
    expect.assertions(1)

    telegram.invoke.mockResolvedValueOnce({ url: 'https://walletbot.me/#tgWebAppVersion=7.0' })
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))

    await expect(makeSource(fetchImpl).token()).rejects.toThrow('no tgWebAppData in web view url')
  })

  it('reuses a cached token while it is still fresh', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    const source = makeSource(fetchImpl)

    expect(await source.token()).toBe(await source.token())
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('refreshes with the stored refresh token once the jwt expires', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    const source = makeSource(fetchImpl)
    await source.token()

    fetchImpl.mockResolvedValueOnce(jsonResponse(authPayload({ jwt: 'jwt-two' })))
    vi.advanceTimersByTime(300_000)

    expect(await source.token()).toBe('jwt-two')
    expect(pathsOf(fetchImpl)).toStrictEqual(['/alectryon/public-api/auth', '/alectryon/public-api/auth-refresh'])

    const body = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)) as Record<string, unknown>

    expect(body).toMatchObject({ session_id: 'session-one', refresh_token: 'refresh-one' })
  })

  it('falls back to a full authentication when the refresh is rejected', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    const source = makeSource(fetchImpl)
    await source.token()

    fetchImpl.mockResolvedValueOnce(jsonResponse({ detail: 'expired' }, 401))
    fetchImpl.mockResolvedValueOnce(jsonResponse(authPayload({ jwt: 'jwt-three' })))
    vi.advanceTimersByTime(300_000)

    expect(await source.token()).toBe('jwt-three')
    expect(pathsOf(fetchImpl)).toStrictEqual([
      '/alectryon/public-api/auth',
      '/alectryon/public-api/auth-refresh',
      '/alectryon/public-api/auth'
    ])
  })

  it('renews a fresh token that the api rejected', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    const source = makeSource(fetchImpl)
    const rejected = await source.token()

    fetchImpl.mockResolvedValueOnce(jsonResponse(authPayload({ jwt: 'jwt-two' })))

    expect(await source.token(rejected)).toBe('jwt-two')
    expect(pathsOf(fetchImpl)).toStrictEqual(['/alectryon/public-api/auth', '/alectryon/public-api/auth-refresh'])
  })

  it('keeps the cached token when a different one was rejected', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    const source = makeSource(fetchImpl)
    await source.token()

    expect(await source.token('jwt-older')).toBe('jwt-one')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a 5xx', () => new Response('down', { status: 503 })],
    ['a 429', () => new Response('slow down', { status: 429 })]
  ])('keeps the refresh token and skips telegram when the refresh fails with %s', async (_label, failure) => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    const source = makeSource(fetchImpl)
    await source.token()

    fetchImpl.mockResolvedValueOnce(failure())
    vi.advanceTimersByTime(300_000)

    await expect(source.token()).rejects.toThrow('/alectryon/public-api/auth-refresh failed')

    fetchImpl.mockResolvedValueOnce(jsonResponse(authPayload({ jwt: 'jwt-two' })))

    expect(await source.token()).toBe('jwt-two')
    expect(pathsOf(fetchImpl)).toStrictEqual([
      '/alectryon/public-api/auth',
      '/alectryon/public-api/auth-refresh',
      '/alectryon/public-api/auth-refresh'
    ])
  })

  it('keeps the refresh token when the refresh never gets a response', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    const source = makeSource(fetchImpl)
    await source.token()

    fetchImpl.mockRejectedValueOnce(new TypeError('fetch failed'))
    vi.advanceTimersByTime(300_000)

    await expect(source.token()).rejects.toThrow('fetch failed')
    expect(telegram.invoke).toHaveBeenCalledTimes(1)
  })

  it('sends the browser headers the web app sends to auth and refresh', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    const source = makeSource(fetchImpl)
    await source.token()
    vi.advanceTimersByTime(300_000)
    await source.token()

    for (const [, options] of fetchImpl.mock.calls) {
      expect(options?.headers).toMatchObject({
        accept: '*/*',
        'content-type': 'application/json',
        origin: 'https://walletbot.me',
        referer: 'https://walletbot.me/',
        'sec-fetch-mode': 'cors',
        'user-agent': expect.stringContaining('Chrome/156.0.0.0'),
        'x-wallet-tz-name': Intl.DateTimeFormat().resolvedOptions().timeZone,
        'x-wallet-tz-offset': String(-new Date().getTimezoneOffset())
      })
    }
  })

  it('surfaces a failed authentication response', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('nope', { status: 403 }))

    await expect(makeSource(fetchImpl).token()).rejects.toThrow('/alectryon/public-api/auth failed (403): nope')
  })

  it('derives expiry from expires_in rather than the server clock', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        authPayload({
          access_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
          access_token_expires_in: 600
        })
      )
    )
    const source = makeSource(fetchImpl)
    await source.token()

    vi.advanceTimersByTime(300_000)
    await source.token()

    expect(fetchImpl).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(300_000)
    await source.token()

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('falls back to the expiry timestamp when expires_in is missing', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        authPayload({
          access_token_expires_at: new Date(Date.now() + 600_000).toISOString(),
          access_token_expires_in: undefined
        })
      )
    )
    const source = makeSource(fetchImpl)
    await source.token()

    vi.advanceTimersByTime(300_000)
    await source.token()

    expect(fetchImpl).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(300_000)
    await source.token()

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('disconnects the underlying telegram client', async () => {
    expect.assertions(1)

    await makeSource(vi.fn<typeof fetch>()).disconnect()

    expect(telegram.disconnect).toHaveBeenCalledTimes(1)
  })

  it('collapses concurrent token requests into one authentication', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    const source = makeSource(fetchImpl)

    const tokens = await Promise.all([source.token(), source.token(), source.token()])

    expect(tokens).toStrictEqual(['jwt-one', 'jwt-one', 'jwt-one'])
    expect(telegram.invoke).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('signs in on the alectryon host as a same-site request', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    await makeSource(fetchImpl).token()
    const [url, options] = fetchImpl.mock.calls[0] ?? []

    expect(String(url)).toBe('https://alectryon.walletbot.me/alectryon/public-api/auth')
    expect(options?.headers).toMatchObject({ 'sec-fetch-site': 'same-site', origin: 'https://walletbot.me' })
  })

  it('sends a same-origin request when authUrl matches baseUrl', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    const source = new TelegramTokenSource({
      session: 'session-string',
      apiId: 1234,
      apiHash: 'hash',
      fetch: fetchImpl,
      storage: false,
      authUrl: 'https://walletbot.me'
    })
    await source.token()
    const [url, options] = fetchImpl.mock.calls[0] ?? []

    expect(String(url)).toBe('https://walletbot.me/alectryon/public-api/auth')
    expect(options?.headers).toMatchObject({ 'sec-fetch-site': 'same-origin' })
  })

  it('offers a new device serial as a fallback on the first sign-in', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    await makeSource(fetchImpl).token()
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>

    expect(body).toMatchObject({ ep: 'menu', device_serial_multi_domain_backup_supported: true })
    expect(body['device_serial_fallback']).toMatch(/^weba:[0-9a-f-]{36}$/)
    expect(body).not.toHaveProperty('device_serial')
  })

  it('sends a known device serial as device_serial', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    await makeSource(fetchImpl, { deviceSerial: 'weba:fixed' }).token()
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>

    expect(body['device_serial']).toBe('weba:fixed')
    expect(body).not.toHaveProperty('device_serial_fallback')
  })

  it('sends the serial as device_serial when signing in again after the first time', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    const source = makeSource(fetchImpl)
    await source.token()
    fetchImpl.mockResolvedValueOnce(jsonResponse({ detail: 'expired' }, 401))
    vi.advanceTimersByTime(300_000)
    await source.token()
    const [first, , third] = fetchImpl.mock.calls.map(
      ([, options]) => JSON.parse(String(options?.body)) as Record<string, unknown>
    )

    expect(third?.['device_serial']).toBe(first?.['device_serial_fallback'])
  })

  it('persists the token state after authenticating', async () => {
    expect.assertions(2)

    const storage = memoryStorage()
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    await makeSource(fetchImpl, { storage, deviceSerial: 'web:fixed' }).token()

    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(storage.current()).toStrictEqual({
      jwt: 'jwt-one',
      refreshToken: 'refresh-one',
      sessionId: 'session-one',
      expiresAt: Date.now() + 300_000,
      deviceSerial: 'web:fixed'
    })
  })

  it('restores a still-valid token from storage without touching telegram', async () => {
    expect.assertions(3)

    const storage = memoryStorage({
      jwt: 'jwt-stored',
      refreshToken: 'refresh-stored',
      sessionId: 'session-stored',
      expiresAt: Date.now() + 300_000,
      deviceSerial: 'web:stored'
    })
    const fetchImpl = vi.fn<typeof fetch>()

    expect(await makeSource(fetchImpl, { storage }).token()).toBe('jwt-stored')
    expect(telegram.invoke).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('caches the token on disk by default and reuses it on the next start', async () => {
    expect.assertions(3)

    const cacheHome = await mkdtemp(join(tmpdir(), 'walt-'))
    vi.stubEnv('XDG_CACHE_HOME', cacheHome)
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    const start = () =>
      new TelegramTokenSource({ session: 'session-string', apiId: 1234, apiHash: 'hash', fetch: fetchImpl }).token()

    try {
      expect(await start()).toBe('jwt-one')
      expect(await start()).toBe('jwt-one')
      expect(telegram.invoke).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllEnvs()
      await rm(cacheHome, { recursive: true, force: true })
    }
  })

  it('refreshes an expired stored token using the persisted device serial', async () => {
    expect.assertions(2)

    const storage = memoryStorage({
      jwt: 'jwt-stale',
      refreshToken: 'refresh-stored',
      sessionId: 'session-stored',
      expiresAt: Date.now() - 1,
      deviceSerial: 'web:stored'
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload({ jwt: 'jwt-renewed' })))

    expect(await makeSource(fetchImpl, { storage }).token()).toBe('jwt-renewed')

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>

    expect(body).toStrictEqual({
      session_id: 'session-stored',
      refresh_token: 'refresh-stored',
      device_serial: 'web:stored'
    })
  })

  it('waits out a short FLOOD_WAIT and retries once', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    telegram.invoke.mockRejectedValueOnce(new errors.FloodWaitError({ request: null, capture: 5 }))

    const pending = makeSource(fetchImpl).token()
    await vi.advanceTimersByTimeAsync(5000)

    expect(await pending).toBe('jwt-one')
    expect(telegram.invoke).toHaveBeenCalledTimes(2)
  })

  it('refuses to wait out a FLOOD_WAIT longer than the budget', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>()
    telegram.invoke.mockRejectedValueOnce(new errors.FloodWaitError({ request: null, capture: 3600 }))

    await expect(makeSource(fetchImpl).token()).rejects.toThrow('telegram rate limited for 3600s')
    expect(telegram.invoke).toHaveBeenCalledTimes(1)
  })
})
