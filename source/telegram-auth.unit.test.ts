import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelegramTokenSource } from '~/telegram-auth.ts'

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
  Api: { messages: { RequestWebView: vi.fn<(params: Record<string, unknown>) => void>() } }
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

const makeSource = (fetchImpl: typeof fetch) =>
  new TelegramTokenSource({ session: 'session-string', apiId: 1234, apiHash: 'hash', fetch: fetchImpl })

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

  it('forwards the raw init data from the web view url', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(authPayload()))
    await makeSource(fetchImpl).token()

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>

    expect(body).toStrictEqual({ web_view_init_data_raw: 'init-data-raw' })
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

  it('surfaces a failed authentication response', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('nope', { status: 403 }))

    await expect(makeSource(fetchImpl).token()).rejects.toThrow('/alectryon/public-api/auth failed (403): nope')
  })

  it('derives expiry from expires_in when the timestamp is unparseable', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(authPayload({ access_token_expires_at: 'not-a-date', access_token_expires_in: 600 }))
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
})
