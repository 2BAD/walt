import { describe, expect, it, vi } from 'vitest'
import { WalletAuthError, WalletClient } from '~/client.ts'

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const makeClient = (fetchImpl: FetchMock, token = 'jwt.token.value') =>
  new WalletClient({ tokenProvider: async () => token, fetch: fetchImpl })

const headersOf = (fetchImpl: FetchMock, call = 0) => {
  const [, options] = fetchImpl.mock.calls[call] ?? []
  return (options?.headers ?? {}) as Record<string, string>
}

const authHeaderOf = (fetchImpl: FetchMock, call = 0) => headersOf(fetchImpl, call)['authorization']

describe('walletClient', () => {
  it('requires a tokenProvider', () => {
    expect.assertions(1)

    expect(() => new WalletClient({} as unknown as { tokenProvider: () => Promise<string> })).toThrow(WalletAuthError)
  })

  it('sends the raw token in the Authorization header (no Bearer prefix)', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    await makeClient(fetchImpl).accounts()

    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/api/v1/accounts/')
    expect(authHeaderOf(fetchImpl)).toBe('jwt.token.value')
  })

  it('strips a leading Bearer prefix from the provided token', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    await makeClient(fetchImpl, 'Bearer jwt.token.value').accounts()

    expect(authHeaderOf(fetchImpl)).toBe('jwt.token.value')
  })

  it('sends the browser headers the web app sends', async () => {
    expect.assertions(4)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    await makeClient(fetchImpl).accounts()
    const headers = headersOf(fetchImpl)

    expect(headers['user-agent']).toContain('Chrome/150.0.0.0')
    expect(headers['sec-fetch-site']).toBe('same-origin')
    expect(headers['referer']).toBe('https://walletbot.me/main')
    expect(headers['baggage']).toContain('sentry-release=10.0.74110')
  })

  it('points the referer at the configured origin', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    const client = new WalletClient({
      tokenProvider: async () => 'jwt.token.value',
      baseUrl: 'https://staging.example',
      fetch: fetchImpl
    })
    await client.accounts()

    expect(headersOf(fetchImpl)['referer']).toBe('https://staging.example/main')
  })

  it('keeps one trace id per client but a fresh span per request', async () => {
    expect.assertions(4)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    const client = makeClient(fetchImpl)
    await client.accounts()
    await client.accounts()

    const [first, second] = [headersOf(fetchImpl, 0), headersOf(fetchImpl, 1)]
    const traceOf = (headers: Record<string, string>) => headers['sentry-trace']?.split('-') ?? []

    expect(first['sentry-trace']).toMatch(/^[0-9a-f]{32}-[0-9a-f]{16}-0$/)
    expect(traceOf(first)[0]).toBe(traceOf(second)[0])
    expect(traceOf(first)[1]).not.toBe(traceOf(second)[1])
    expect(first['traceparent']).not.toBe(second['traceparent'])
  })

  it('asks the provider only once while the token keeps working', async () => {
    expect.assertions(1)

    const tokenProvider = vi.fn<() => Promise<string>>(async () => 'jwt.token.value')
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    const client = new WalletClient({ tokenProvider, fetch: fetchImpl })

    await client.accounts()
    await client.accounts()

    expect(tokenProvider).toHaveBeenCalledTimes(1)
  })

  it('builds a portfolio from the accounts response', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        available_balance_total_fiat_amount: '150.00',
        available_balance_total_fiat_currency: 'USD',
        accounts: [
          { currency: 'TON', available_balance: '10', available_balance_fiat_amount: '50.00' },
          { currency: 'BTC', available_balance: '0.001', available_balance_fiat_amount: '100.00' },
          { currency: 'ETH', available_balance: '0', available_balance_fiat_amount: '0.00' }
        ]
      })
    )

    const { entries, total, fiatCurrency } = await makeClient(fetchImpl).portfolio()

    expect(entries.map((entry) => entry.currency)).toStrictEqual(['BTC', 'TON'])
    expect(total).toBe(150)
    expect(fiatCurrency).toBe('USD')
  })

  it('unwraps the coins list', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ coins: [{ currency: 'BTC', rate: '62000' }] }))
    const coins = await makeClient(fetchImpl).coins('USD')

    expect(coins[0]?.currency).toBe('BTC')
  })

  it('encodes the padding in a base64 cursor', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ transactions: [] }))
    await makeClient(fetchImpl).transactions('MTAwMDAwMDAwMDAwMDE6Tm9uZQ==')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/api/v1/transactions/?cursor=MTAwMDAwMDAwMDAwMDE6Tm9uZQ%3D%3D'
    )
  })

  it('requests the frozen balances endpoint', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}))
    await makeClient(fetchImpl).frozenBalances()

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/accounts/frozen')
  })

  it('scopes transactions to one currency', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ transactions: [] }))
    await makeClient(fetchImpl).accountTransactions('TON', 20)

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/api/v1/transactions/single-account/?crypto_currency=TON&limit=20'
    )
  })

  it('omits the limit when not given', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ transactions: [] }))
    await makeClient(fetchImpl).accountTransactions('USDT')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/api/v1/transactions/single-account/?crypto_currency=USDT'
    )
  })

  it('fetches a single transaction with its fee and valuation', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ id: 10000000000001, fee_amount: '0.01', local_fiat_amount: '12.00' })
    )
    const details = await makeClient(fetchImpl).transactionDetails(10000000000001)

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/transactions/details/10000000000001/')
    expect(details.fee_amount).toBe('0.01')
    expect(details.local_fiat_amount).toBe('12.00')
  })

  it('narrows a transaction lookup to one gateway when given', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ id: 10000000000001 }))
    await makeClient(fetchImpl).transactionDetails(10000000000001, 'crypto_exchange')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/api/v1/transactions/details/10000000000001/?transaction_gateway=crypto_exchange'
    )
  })

  it('reads pending deposits', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ transactions: [], size: 0 }))
    const { size } = await makeClient(fetchImpl).unconfirmedTransactions()

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/transactions/unconfirmed/')
    expect(size).toBe(0)
  })

  it('caps the pending deposit page when a limit is given', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ transactions: [], size: 0 }))
    await makeClient(fetchImpl).unconfirmedTransactions(50)

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/transactions/unconfirmed/?limit=50')
  })

  it('reads profit and loss from the analytics service', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        positions: [{ currency: 'TON', current_value_in_fiat: '50.00', percentage_all_time: '12.5' }],
        total: { fiat_currency: 'USD', current_value_in_fiat: '150.00', absolute_all_time: '20.00' }
      })
    )

    const { positions, total } = await makeClient(fetchImpl).pnl()

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/customer-analytics/public-api/v1/pnl/assets/')
    expect(positions[0]?.currency).toBe('TON')
    expect(total.current_value_in_fiat).toBe('150.00')
  })

  it('fetches coin details with its 24h preview series', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        currency: 'TON',
        market_cap: null,
        chart_preview_rate_24h: [{ timestamp: 1767225600, value: '5.12' }]
      })
    )
    const details = await makeClient(fetchImpl).coinDetails('TON', 'USD')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/coins/details/TON/USD/')
    expect(details.market_cap).toBeNull()
    expect(details.chart_preview_rate_24h[0]?.value).toBe('5.12')
  })

  it('returns the per-period series from the chart endpoint', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        day: [{ rate: '5.12', timestamp: 1767225600 }],
        week: [],
        month: [],
        year: [],
        all: []
      })
    )

    const { day } = await makeClient(fetchImpl).charts('TON', 'USD')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/charts/TON/USD/')
    expect(day[0]?.rate).toBe('5.12')
    expect(day[0]?.timestamp).toBe(1767225600)
  })

  it('sends all four required parameters for a historical price lookup', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ rate: '1.656928134127' }))
    const price = await makeClient(fetchImpl).priceForFiatAtTime('TON', 'USD', 1, '2026-01-01T00:00:00Z')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/api/v1/exchange_rates/price_for_fiat_at_time/?crypto_currency=TON&local_currency=USD&amount=1&time=2026-01-01T00%3A00%3A00Z'
    )
    expect(price.rate).toBe('1.656928134127')
  })

  it('serialises a Date for a historical price lookup', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}))
    await makeClient(fetchImpl).priceForFiatAtTime('TON', 'USD', 1, new Date('2026-01-01T00:00:00Z'))

    expect(fetchImpl.mock.calls[0]?.[0]).toContain('time=2026-01-01T00%3A00%3A00.000Z')
  })

  it('reads the local currency', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ local_currency: 'USD' }))
    const currency = await makeClient(fetchImpl).localCurrency()

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/currencies/local_currency/')
    expect(currency).toBe('USD')
  })

  it('pages the global and per-currency transaction lists', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ transactions: [] }))
    const client = makeClient(fetchImpl)
    await client.transactions('cur/sor', 20)
    await client.accountTransactions('TON', 2, 'cur/sor')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/transactions/?cursor=cur%2Fsor&limit=20')
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      'https://walletbot.me/api/v1/transactions/single-account/?crypto_currency=TON&limit=2&cursor=cur%2Fsor'
    )
  })

  it('throws on a non-401 error status', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ detail: 'boom' }, 500))

    await expect(makeClient(fetchImpl).accounts()).rejects.toThrow('failed (500)')
  })

  it('refreshes on 401 and retries once', async () => {
    expect.assertions(2)

    const tokens = ['stale', 'fresh']
    const tokenProvider = vi.fn<() => Promise<string>>(async () => tokens.shift() ?? 'fresh')
    const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
      const auth = (options?.headers as Record<string, string> | undefined)?.['authorization']
      return auth === 'fresh' ? jsonResponse({ accounts: [] }) : jsonResponse({ code: 'token_corrupted' }, 401)
    })

    await new WalletClient({ tokenProvider, fetch: fetchImpl }).accounts()

    expect(tokenProvider).toHaveBeenCalledTimes(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('asks the provider once for concurrent requests with no cached token', async () => {
    expect.assertions(2)

    const tokenProvider = vi.fn<() => Promise<string>>(async () => 'jwt.token.value')
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    const client = new WalletClient({ tokenProvider, fetch: fetchImpl })

    await Promise.all([client.accounts(), client.accounts(), client.accounts()])

    expect(tokenProvider).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('gives up after a single refresh attempt', async () => {
    expect.assertions(2)

    const tokenProvider = vi.fn<() => Promise<string>>(async () => 'always-stale')
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ code: 'token_corrupted' }, 401))
    const client = new WalletClient({ tokenProvider, fetch: fetchImpl })

    await expect(client.accounts()).rejects.toBeInstanceOf(WalletAuthError)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
