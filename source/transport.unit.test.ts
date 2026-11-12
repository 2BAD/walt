import { describe, expect, it, vi } from 'vitest'
import { Transport, WaltAuthError, WaltRequestError } from '~/transport.ts'

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>

const ACCOUNTS = '/api/v1/accounts/'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const makeTransport = (fetchImpl: FetchMock, options: Partial<ConstructorParameters<typeof Transport>[0]> = {}) =>
  new Transport({
    tokenProvider: async () => 'jwt.token.value',
    baseUrl: 'https://walletbot.me',
    fetch: fetchImpl,
    retries: 3,
    retryDelayMs: 0,
    maxConcurrent: 4,
    ...options
  })

const headersOf = (fetchImpl: FetchMock, call = 0) => {
  const [, options] = fetchImpl.mock.calls[call] ?? []
  return (options?.headers ?? {}) as Record<string, string>
}

const authHeaderOf = (fetchImpl: FetchMock, call = 0) => headersOf(fetchImpl, call)['authorization']

const acceptingOnly = (token: string, body: unknown) =>
  vi.fn<typeof fetch>(async (_url, options) => {
    const auth = (options?.headers as Record<string, string> | undefined)?.['authorization']
    return auth === token ? jsonResponse(body) : jsonResponse({ code: 'token_corrupted' }, 401)
  })

describe('transport headers', () => {
  it('sends the raw token in the Authorization header (no Bearer prefix)', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    await makeTransport(fetchImpl).get(ACCOUNTS)

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/accounts/')
    expect(authHeaderOf(fetchImpl)).toBe('jwt.token.value')
  })

  it('strips a leading Bearer prefix from the provided token', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    await makeTransport(fetchImpl, { tokenProvider: async () => 'Bearer jwt.token.value' }).get(ACCOUNTS)

    expect(authHeaderOf(fetchImpl)).toBe('jwt.token.value')
  })

  it('sends a bearer token to the order, balance and candle services and a raw one elsewhere', async () => {
    expect.assertions(5)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}))
    const transport = makeTransport(fetchImpl, { tokenProvider: async () => 'Bearer jwt.token.value' })
    await transport.get('/emporos/public-api/orders/limit')
    await transport.get('/portmone/public-api/v1/user/accounts')
    await transport.post('/kandelabr/public-api/v1/candles/batch', {})
    await transport.get(ACCOUNTS)
    await transport.get('/perps/public-api/v1/contracts/')

    expect(authHeaderOf(fetchImpl, 0)).toBe('Bearer jwt.token.value')
    expect(authHeaderOf(fetchImpl, 1)).toBe('Bearer jwt.token.value')
    expect(authHeaderOf(fetchImpl, 2)).toBe('Bearer jwt.token.value')
    expect(authHeaderOf(fetchImpl, 3)).toBe('jwt.token.value')
    expect(authHeaderOf(fetchImpl, 4)).toBe('jwt.token.value')
  })

  it('sends the browser headers the web app sends', async () => {
    expect.assertions(6)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    await makeTransport(fetchImpl).get(ACCOUNTS)
    const headers = headersOf(fetchImpl)

    expect(headers['user-agent']).toContain('Chrome/156.0.0.0')
    expect(headers['sec-ch-ua']).toContain('"Google Chrome";v="156"')
    expect(headers['accept']).toBe('application/json')
    expect(headers['sec-fetch-site']).toBe('same-origin')
    expect(headers['baggage']).toContain('sentry-release=10.0.84666')
    expect(headers).not.toHaveProperty('sec-fetch-storage-access')
  })

  it('names the telegram user from the token in the referer', async () => {
    expect.assertions(1)

    const claims = Buffer.from(JSON.stringify({ web_view_init_data: { user: { id: 10000000001 } } })).toString(
      'base64url'
    )
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    await makeTransport(fetchImpl, { tokenProvider: async () => `Bearer header.${claims}.signature` }).get(ACCOUNTS)

    expect(headersOf(fetchImpl)['referer']).toBe('https://walletbot.me/main?ep=menu&tgWebAppUserId=10000000001')
  })

  it('points the referer at the configured origin', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    await makeTransport(fetchImpl, { baseUrl: 'https://staging.example' }).get(ACCOUNTS)

    expect(headersOf(fetchImpl)['referer']).toBe('https://staging.example/main?ep=menu')
  })

  it('keeps one trace id per transport but a fresh span per request', async () => {
    expect.assertions(4)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    const transport = makeTransport(fetchImpl)
    await transport.get(ACCOUNTS)
    await transport.get(ACCOUNTS)

    const [first, second] = [headersOf(fetchImpl, 0), headersOf(fetchImpl, 1)]
    const traceOf = (headers: Record<string, string>) => headers['sentry-trace']?.split('-') ?? []

    expect(first['sentry-trace']).toMatch(/^[0-9a-f]{32}-[0-9a-f]{16}-0$/)
    expect(traceOf(first)[0]).toBe(traceOf(second)[0])
    expect(traceOf(first)[1]).not.toBe(traceOf(second)[1])
    expect(first['traceparent']).not.toBe(second['traceparent'])
  })

  it('posts json with the origin the web app sends', async () => {
    expect.assertions(4)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}))
    await makeTransport(fetchImpl).post('/api/v1/exchange/convert/', { from_amount: 1 })
    const [, options] = fetchImpl.mock.calls[0] ?? []

    expect(options?.method).toBe('POST')
    expect(headersOf(fetchImpl)['content-type']).toBe('application/json')
    expect(headersOf(fetchImpl)['origin']).toBe('https://walletbot.me')
    expect(JSON.parse(String(options?.body))).toStrictEqual({ from_amount: 1 })
  })

  it('does not send a body or an origin on a GET', async () => {
    expect.assertions(4)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    await makeTransport(fetchImpl).get(ACCOUNTS)
    const [, options] = fetchImpl.mock.calls[0] ?? []

    expect(options?.method).toBe('GET')
    expect(options?.body).toBeNull()
    expect(headersOf(fetchImpl)['origin']).toBeUndefined()
    expect(headersOf(fetchImpl)['content-type']).toBeUndefined()
  })

  it('calls fetch without a receiver', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    await makeTransport(fetchImpl).get(ACCOUNTS)

    expect(fetchImpl.mock.contexts[0]).toBeUndefined()
  })
})

describe('transport errors', () => {
  it('keeps a json error body on the error', async () => {
    expect.assertions(2)

    const body = { code: 'market_order_max_limit_error', detail: 'too much' }
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(body, 400))
    const request = makeTransport(fetchImpl).post('/api/v1/exchange/convert/', {})

    await expect(request).rejects.toBeInstanceOf(WaltRequestError)
    await expect(request).rejects.toMatchObject({ status: 400, body })
  })

  it('keeps a non-json error body as text', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('<html>forbidden</html>', { status: 403 }))

    await expect(makeTransport(fetchImpl).get(ACCOUNTS)).rejects.toMatchObject({
      status: 403,
      body: '<html>forbidden</html>'
    })
  })

  it('turns a successful response that is not json into a request error', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('<html>challenge</html>', { status: 200 }))
    const request = makeTransport(fetchImpl).get(ACCOUNTS)

    await expect(request).rejects.toBeInstanceOf(WaltRequestError)
    await expect(request).rejects.toMatchObject({ status: 200, body: '<html>challenge</html>' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('names the method and path in the error', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ detail: 'bad' }, 422))

    await expect(makeTransport(fetchImpl).post('/api/v1/exchange/convert/', {})).rejects.toThrow(
      'POST /api/v1/exchange/convert/ failed (422)'
    )
  })
})

describe('transport tokens', () => {
  it('asks the provider only once while the token keeps working', async () => {
    expect.assertions(1)

    const tokenProvider = vi.fn<() => Promise<string>>(async () => 'jwt.token.value')
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    const transport = makeTransport(fetchImpl, { tokenProvider })

    await transport.get(ACCOUNTS)
    await transport.get(ACCOUNTS)

    expect(tokenProvider).toHaveBeenCalledTimes(1)
  })

  it('refreshes on 401 and retries once', async () => {
    expect.assertions(2)

    const tokens = ['stale', 'fresh']
    const tokenProvider = vi.fn<() => Promise<string>>(async () => tokens.shift() ?? 'fresh')
    const fetchImpl = acceptingOnly('fresh', { accounts: [] })

    await makeTransport(fetchImpl, { tokenProvider }).get(ACCOUNTS)

    expect(tokenProvider).toHaveBeenCalledTimes(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('hands the rejected token back to the provider on 401', async () => {
    expect.assertions(1)

    const tokens = ['Bearer stale', 'fresh']
    const tokenProvider = vi.fn<(rejected?: string) => Promise<string>>(async () => tokens.shift() ?? 'fresh')
    const fetchImpl = acceptingOnly('fresh', { accounts: [] })

    await makeTransport(fetchImpl, { tokenProvider }).get(ACCOUNTS)

    expect(tokenProvider.mock.calls).toStrictEqual([[undefined], ['Bearer stale']])
  })

  it('replays the body when the token is refreshed on a 401', async () => {
    expect.assertions(3)

    const tokens = ['stale', 'fresh']
    const tokenProvider = vi.fn<() => Promise<string>>(async () => tokens.shift() ?? 'fresh')
    const fetchImpl = acceptingOnly('fresh', {})

    await makeTransport(fetchImpl, { tokenProvider }).post('/api/v1/exchange/convert/', { from_amount: 1 })
    const bodies = fetchImpl.mock.calls.map(([, options]) => String(options?.body))

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(bodies[0]).toBe(bodies[1])
    expect(headersOf(fetchImpl, 1)['authorization']).toBe('fresh')
  })

  it('asks the provider once when concurrent requests hit a 401 together', async () => {
    expect.assertions(2)

    const tokens = ['stale', 'fresh']
    const tokenProvider = vi.fn<(rejected?: string) => Promise<string>>(async () => tokens.shift() ?? 'fresh')
    const fetchImpl = acceptingOnly('fresh', { accounts: [] })
    const transport = makeTransport(fetchImpl, { tokenProvider })

    await Promise.all([transport.get(ACCOUNTS), transport.get(ACCOUNTS), transport.get(ACCOUNTS)])

    expect(tokenProvider).toHaveBeenCalledTimes(2)
    expect(fetchImpl).toHaveBeenCalledTimes(6)
  })

  it('asks the provider once for concurrent requests with no cached token', async () => {
    expect.assertions(2)

    const tokenProvider = vi.fn<() => Promise<string>>(async () => 'jwt.token.value')
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    const transport = makeTransport(fetchImpl, { tokenProvider })

    await Promise.all([transport.get(ACCOUNTS), transport.get(ACCOUNTS), transport.get(ACCOUNTS)])

    expect(tokenProvider).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('gives up after a single refresh attempt', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ code: 'token_corrupted' }, 401))

    await expect(makeTransport(fetchImpl).get(ACCOUNTS)).rejects.toBeInstanceOf(WaltAuthError)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('transport retries', () => {
  it('retries a 503 until it succeeds', async () => {
    expect.assertions(2)

    let calls = 0
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      calls++
      return calls < 3 ? jsonResponse({}, 503) : jsonResponse({ accounts: [] })
    })

    await expect(makeTransport(fetchImpl).get(ACCOUNTS)).resolves.toStrictEqual({ accounts: [] })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('gives up after the configured number of extra attempts', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 503))

    await expect(makeTransport(fetchImpl, { retries: 2 }).get(ACCOUNTS)).rejects.toBeInstanceOf(WaltRequestError)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('lets a post override the retry count', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 503))

    await expect(makeTransport(fetchImpl).post('/api/v1/exchange/create_exchange/', {}, 0)).rejects.toBeInstanceOf(
      WaltRequestError
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not retry a 500, which this api returns for bad input', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 500))

    await expect(makeTransport(fetchImpl).get(ACCOUNTS)).rejects.toThrow('failed (500)')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retries when fetch never returns a response', async () => {
    expect.assertions(2)

    let calls = 0
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      calls++
      if (calls === 1) throw new TypeError('network down')
      return jsonResponse({ accounts: [] })
    })

    await expect(makeTransport(fetchImpl).get(ACCOUNTS)).resolves.toStrictEqual({ accounts: [] })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('prefers retry-after over its own backoff', async () => {
    expect.assertions(1)

    let calls = 0
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      calls++
      return calls === 1
        ? new Response('{}', { status: 503, headers: { 'retry-after': '0' } })
        : jsonResponse({ accounts: [] })
    })

    // A ten minute base delay would stall this test if retry-after were ignored.
    await expect(makeTransport(fetchImpl, { retryDelayMs: 600_000 }).get(ACCOUNTS)).resolves.toStrictEqual({
      accounts: []
    })
  })

  it('carries the status on the error it throws', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 429))

    await expect(makeTransport(fetchImpl, { retries: 0 }).get(ACCOUNTS)).rejects.toMatchObject({ status: 429 })
  })

  it('keeps no more than maxConcurrent requests in flight', async () => {
    expect.assertions(2)

    let inFlight = 0
    let peak = 0
    const holds: (() => void)[] = []
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise<void>((resolve) => holds.push(resolve))
      inFlight--
      return jsonResponse({ accounts: [] })
    })

    const transport = makeTransport(fetchImpl, { maxConcurrent: 2 })
    const all = Promise.all(Array.from({ length: 6 }, () => transport.get(ACCOUNTS)))
    // Six requests two at a time is three waves; the extra rounds are slack.
    for (let round = 0; round < 12; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      holds.splice(0).forEach((release) => release())
    }

    await all
    expect(fetchImpl).toHaveBeenCalledTimes(6)
    expect(peak).toBe(2)
  })
})
