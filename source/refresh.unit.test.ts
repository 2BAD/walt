import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RefreshTokenSource, type TokenState, type TokenStorage } from '~/refresh.ts'
import { WaltAuthError } from '~/transport.ts'

const NOW = new Date('2026-01-01T00:00:00.000Z').getTime()

const state = (overrides: Partial<TokenState> = {}): TokenState => ({
  jwt: 'jwt-one',
  refreshToken: 'refresh-one',
  sessionId: 'session-one',
  expiresAt: NOW + 300_000,
  deviceSerial: 'weba:00000000-0000-4000-8000-000000000001',
  ...overrides
})

const refreshed = (overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      jwt: 'jwt-two',
      refresh_token: 'refresh-two',
      session_id: 'session-two',
      access_token_expires_at: new Date(NOW + 600_000).toISOString(),
      access_token_expires_in: 600,
      ...overrides
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )

const memoryStorage = (initial: TokenState | null = null) => ({
  load: vi.fn<TokenStorage['load']>(async () => initial),
  save: vi.fn<TokenStorage['save']>(async () => {})
})

describe('refreshTokenSource', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a fresh jwt from the given state without a request', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>()
    const source = new RefreshTokenSource({ state: state(), fetch: fetchImpl })

    expect(await source.token()).toBe('jwt-one')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refreshes an expired state and saves the rotated refresh token', async () => {
    expect.assertions(4)

    const fetchImpl = vi.fn<typeof fetch>(async () => refreshed())
    const storage = memoryStorage()
    const source = new RefreshTokenSource({ state: state({ expiresAt: NOW }), storage, fetch: fetchImpl })

    expect(await source.token()).toBe('jwt-two')

    const [url, init] = fetchImpl.mock.calls[0] ?? []

    expect(String(url)).toBe('https://alectryon.walletbot.me/alectryon/public-api/auth-refresh')
    expect(JSON.parse(String(init?.body))).toStrictEqual({
      session_id: 'session-one',
      refresh_token: 'refresh-one',
      device_serial: 'weba:00000000-0000-4000-8000-000000000001'
    })
    expect(storage.save).toHaveBeenCalledWith({
      jwt: 'jwt-two',
      refreshToken: 'refresh-two',
      sessionId: 'session-two',
      expiresAt: NOW + 600_000,
      deviceSerial: 'weba:00000000-0000-4000-8000-000000000001'
    })
  })

  it('calls fetch without a receiver', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => refreshed())
    await new RefreshTokenSource({ state: state({ expiresAt: NOW }), fetch: fetchImpl }).token()

    expect(fetchImpl.mock.contexts[0]).toBeUndefined()
  })

  it('loads the state from storage when none is given', async () => {
    expect.assertions(2)

    const storage = memoryStorage(state())
    const source = new RefreshTokenSource({ storage, fetch: vi.fn<typeof fetch>() })

    expect(await source.token()).toBe('jwt-one')
    expect(storage.load).toHaveBeenCalledTimes(1)
  })

  it('prefers the given state over storage', async () => {
    expect.assertions(2)

    const storage = memoryStorage(state({ jwt: 'jwt-stored' }))
    const source = new RefreshTokenSource({ state: state(), storage, fetch: vi.fn<typeof fetch>() })

    expect(await source.token()).toBe('jwt-one')
    expect(storage.load).not.toHaveBeenCalled()
  })

  it('renews a fresh jwt that the api rejected', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => refreshed())
    const source = new RefreshTokenSource({ state: state(), fetch: fetchImpl })

    expect(await source.token('jwt-one')).toBe('jwt-two')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('collapses concurrent callers onto one refresh', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => refreshed())
    const source = new RefreshTokenSource({ state: state({ expiresAt: NOW }), fetch: fetchImpl })

    const tokens = await Promise.all([source.token(), source.token(), source.token()])

    expect(tokens).toStrictEqual(['jwt-two', 'jwt-two', 'jwt-two'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([400, 401, 403])('throws WaltAuthError without saving when the refresh token gets a %i', async (status) => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('rejected', { status }))
    const storage = memoryStorage()
    const source = new RefreshTokenSource({ state: state({ expiresAt: NOW }), storage, fetch: fetchImpl })

    await expect(source.token()).rejects.toThrow(WaltAuthError)
    await expect(source.token()).rejects.toThrow('refresh token rejected')
    expect(storage.save).not.toHaveBeenCalled()
  })

  it.each([429, 503])('throws a %i as a transient failure and keeps the refresh token', async (status) => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('busy', { status }))
    const source = new RefreshTokenSource({ state: state({ expiresAt: NOW }), fetch: fetchImpl })

    const failure = source.token()

    await expect(failure).rejects.toThrow(`auth-refresh failed (${status})`)
    await expect(failure).rejects.not.toBeInstanceOf(WaltAuthError)

    fetchImpl.mockResolvedValueOnce(refreshed())

    expect(await source.token()).toBe('jwt-two')
  })

  it('throws WaltAuthError when there is no state to start from', async () => {
    expect.assertions(1)

    const source = new RefreshTokenSource({ storage: memoryStorage(), fetch: vi.fn<typeof fetch>() })

    await expect(source.token()).rejects.toThrow(new WaltAuthError('no token state to refresh'))
  })

  it('falls back to the expiry timestamp when expires_in is missing', async () => {
    expect.assertions(1)

    const storage = memoryStorage()
    const fetchImpl = vi.fn<typeof fetch>(async () => refreshed({ access_token_expires_in: undefined }))
    const source = new RefreshTokenSource({ state: state({ expiresAt: NOW }), storage, fetch: fetchImpl })
    await source.token()

    expect(storage.save.mock.calls[0]?.[0].expiresAt).toBe(NOW + 600_000)
  })
})
