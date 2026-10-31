import { describe, expect, it, vi } from 'vitest'
import {
  type Transaction,
  type TransactionDetails,
  type WaltClientOptions,
  normalizeTransaction,
  WaltAuthError,
  WaltClient,
  WaltRequestError
} from '~/client.ts'

const detailsOf = (overrides: Partial<TransactionDetails>): TransactionDetails => ({
  id: 10000000000001,
  type: 'deposit',
  created_at: '2026-01-01T00:00:00.000000Z',
  status: 'success',
  gateway: 'crypto_exchange',
  crypto_amount: '100.000000',
  crypto_currency: 'USDT',
  local_fiat_amount: '100.00',
  local_fiat_amount_now: '100.00',
  local_currency: 'USD',
  fee_amount: null,
  fee_currency: null,
  exchange_rate: null,
  pair_transaction_amount: null,
  pair_transaction_currency: null,
  username: null,
  tg_id: null,
  transfer_id: null,
  mention: null,
  comment: null,
  input_addresses: null,
  recipient_wallet_address: null,
  network: null,
  crypto_tx_id: null,
  transaction_link: null,
  photo_url: null,
  gateway_details: null,
  is_blocked: false,
  is_cancellable: false,
  block_reason: null,
  ...overrides
})

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const makeClient = (fetchImpl: FetchMock, token = 'jwt.token.value') =>
  new WaltClient({ tokenProvider: async () => token, fetch: fetchImpl })

const headersOf = (fetchImpl: FetchMock, call = 0) => {
  const [, options] = fetchImpl.mock.calls[call] ?? []
  return (options?.headers ?? {}) as Record<string, string>
}

const authHeaderOf = (fetchImpl: FetchMock, call = 0) => headersOf(fetchImpl, call)['authorization']

describe('waltClient', () => {
  it('requires a tokenProvider', () => {
    expect.assertions(1)

    expect(() => new WaltClient({} as unknown as { tokenProvider: () => Promise<string> })).toThrow(WaltAuthError)
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
    const client = new WaltClient({
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
    const client = new WaltClient({ tokenProvider, fetch: fetchImpl })

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

  it('reports what the entries miss against the api total', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        available_balance_total_fiat_amount: '250.00',
        available_balance_total_fiat_currency: 'USD',
        accounts: [
          { currency: 'TON', available_balance: '10', available_balance_fiat_amount: '50.00' },
          { currency: 'BTC', available_balance: '0.001', available_balance_fiat_amount: '100.00' }
        ]
      })
    )

    const { entriesTotal, total, staked } = await makeClient(fetchImpl).portfolio()

    expect(entriesTotal).toBe(150)
    expect(total).toBe(250)
    expect(staked).toBe(100)
  })

  it('reports nothing staked when the entries already reach the total', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        available_balance_total_fiat_amount: '50.00',
        available_balance_total_fiat_currency: 'USD',
        accounts: [
          { currency: 'TON', available_balance: '10', available_balance_fiat_amount: '50.00' },
          { currency: 'ETH', available_balance: '0', available_balance_fiat_amount: '0.00' }
        ]
      })
    )

    const { entriesTotal, staked } = await makeClient(fetchImpl).portfolio()

    expect(entriesTotal).toBe(50)
    expect(staked).toBe(0)
  })

  it('rejects a portfolio total that is not a number', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ available_balance_total_fiat_currency: 'USD', accounts: [] })
    )

    await expect(makeClient(fetchImpl).portfolio()).rejects.toThrow('total is not a number')
  })

  it('rejects a balance that is not a number instead of dropping the row', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        available_balance_total_fiat_amount: '150.00',
        available_balance_total_fiat_currency: 'USD',
        accounts: [{ currency: 'TON', available_balance: null, available_balance_fiat_amount: '50.00' }]
      })
    )

    await expect(makeClient(fetchImpl).portfolio()).rejects.toThrow('TON balance is not a number')
  })

  it('rejects a held balance it cannot value', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        available_balance_total_fiat_amount: '150.00',
        available_balance_total_fiat_currency: 'USD',
        accounts: [{ currency: 'TON', available_balance: '10', available_balance_fiat_amount: undefined }]
      })
    )

    await expect(makeClient(fetchImpl).portfolio()).rejects.toThrow('TON fiat value is not a number')
  })

  it('ignores an unvaluable zero balance', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        available_balance_total_fiat_amount: '50.00',
        available_balance_total_fiat_currency: 'USD',
        accounts: [
          { currency: 'ETH', available_balance: '0', available_balance_fiat_amount: null },
          { currency: 'TON', available_balance: '10', available_balance_fiat_amount: '50.00' }
        ]
      })
    )
    const { entries } = await makeClient(fetchImpl).portfolio()

    expect(entries.map((entry) => entry.currency)).toStrictEqual(['TON'])
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

  it('stops walking when a page comes back empty despite a fresh cursor', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const cursor = new URL(String(input)).searchParams.get('cursor')
      if (cursor === null) return jsonResponse({ transactions: [{ id: 10000000000001 }], next_cursor: 'second' })
      if (cursor === 'second') return jsonResponse({ transactions: [{ id: 10000000000002 }], next_cursor: 'third' })
      return jsonResponse({ transactions: [], next_cursor: 'endless' })
    })

    const rows = await Array.fromAsync(makeClient(fetchImpl).allTransactions())

    expect(rows.map((row) => row.id)).toStrictEqual([10000000000001, 10000000000002])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('stops walking when the api does return a null cursor', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ transactions: [{ id: 10000000000001 }], next_cursor: null })
    )

    const rows = await Array.fromAsync(makeClient(fetchImpl).allTransactions(50))

    expect(rows).toHaveLength(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/transactions/?limit=50')
  })

  it('threads the currency and cursor through an account walk', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const cursor = new URL(String(input)).searchParams.get('cursor')
      if (cursor === null) return jsonResponse({ transactions: [{ id: 10000000000001 }], next_cursor: 'next' })
      return jsonResponse({ transactions: [], next_cursor: 'endless' })
    })

    const rows = await Array.fromAsync(makeClient(fetchImpl).allAccountTransactions('TON', 20))

    expect(rows).toHaveLength(1)
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      'https://walletbot.me/api/v1/transactions/single-account/?crypto_currency=TON&limit=20&cursor=next'
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

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ rate: '1.500000000000' }))
    const price = await makeClient(fetchImpl).priceForFiatAtTime('TON', 'USD', 1, '2026-01-01T00:00:00Z')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/api/v1/exchange_rates/price_for_fiat_at_time/?crypto_currency=TON&local_currency=USD&amount=1&time=2026-01-01T00%3A00%3A00Z'
    )
    expect(price.rate).toBe('1.500000000000')
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

    await new WaltClient({ tokenProvider, fetch: fetchImpl }).accounts()

    expect(tokenProvider).toHaveBeenCalledTimes(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('asks the provider once for concurrent requests with no cached token', async () => {
    expect.assertions(2)

    const tokenProvider = vi.fn<() => Promise<string>>(async () => 'jwt.token.value')
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    const client = new WaltClient({ tokenProvider, fetch: fetchImpl })

    await Promise.all([client.accounts(), client.accounts(), client.accounts()])

    expect(tokenProvider).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('gives up after a single refresh attempt', async () => {
    expect.assertions(2)

    const tokenProvider = vi.fn<() => Promise<string>>(async () => 'always-stale')
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ code: 'token_corrupted' }, 401))
    const client = new WaltClient({ tokenProvider, fetch: fetchImpl })

    await expect(client.accounts()).rejects.toBeInstanceOf(WaltAuthError)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('waltClient retries', () => {
  const retryingClient = (fetchImpl: FetchMock, options: Partial<WaltClientOptions> = {}) =>
    new WaltClient({ tokenProvider: async () => 'jwt.token.value', fetch: fetchImpl, retryDelayMs: 0, ...options })

  it('retries a 503 until it succeeds', async () => {
    expect.assertions(2)

    let calls = 0
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      calls++
      return calls < 3 ? jsonResponse({}, 503) : jsonResponse({ accounts: [] })
    })

    await expect(retryingClient(fetchImpl).accounts()).resolves.toStrictEqual({ accounts: [] })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('gives up after the configured number of extra attempts', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 503))

    await expect(retryingClient(fetchImpl, { retries: 2 }).accounts()).rejects.toBeInstanceOf(WaltRequestError)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('does not retry a 500, which this api returns for bad input', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 500))

    await expect(retryingClient(fetchImpl).accounts()).rejects.toThrow('failed (500)')
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

    await expect(retryingClient(fetchImpl).accounts()).resolves.toStrictEqual({ accounts: [] })
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
    await expect(retryingClient(fetchImpl, { retryDelayMs: 600_000 }).accounts()).resolves.toStrictEqual({
      accounts: []
    })
  })

  it('carries the status on the error it throws', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 429))

    await expect(retryingClient(fetchImpl, { retries: 0 }).accounts()).rejects.toMatchObject({ status: 429 })
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

    const client = retryingClient(fetchImpl, { maxConcurrent: 2 })
    const all = Promise.all(Array.from({ length: 6 }, () => client.accounts()))
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

describe('waltClient earn', () => {
  it('requests the campaigns endpoint with its trailing slash', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ campaigns: [] }))
    const { campaigns } = await makeClient(fetchImpl).earnCampaigns()

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/earn/public-api/v1/campaigns/')
    expect(campaigns).toStrictEqual([])
  })

  it('scopes transactions to one campaign', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ transactions: [] }))
    await makeClient(fetchImpl).earnCampaignTransactions(11)

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/earn/public-api/v1/campaigns/11/transactions')
  })

  it('encodes both sides of a rate lookup', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ rate: '1' }))
    await makeClient(fetchImpl).earnRate('USDT', 'USDe')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/earn/public-api/v1/rate/USDT/USDe')
  })
})

describe('waltClient detailsFor', () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: 10000000000001 + index }) as Transaction)

  const detailFetch = (onCall?: (id: string) => void) =>
    vi.fn<typeof fetch>(async (input) => {
      const id = String(input).split('/details/')[1]?.replace(/\/$/, '') ?? ''
      onCall?.(id)
      return jsonResponse({ id: Number(id), gateway: 'crypto_exchange' })
    })

  it('yields one detail per row, in the order the rows arrived', async () => {
    expect.assertions(1)

    const client = new WaltClient({ tokenProvider: async () => 'jwt.token.value', fetch: detailFetch() })
    const seen = []
    for await (const detail of client.detailsFor(rows(9))) seen.push(detail.id)

    expect(seen).toStrictEqual([
      10000000000001, 10000000000002, 10000000000003, 10000000000004, 10000000000005, 10000000000006, 10000000000007,
      10000000000008, 10000000000009
    ])
  })

  it('passes each row gateway through, which xstocks_dividends needs to resolve', async () => {
    expect.assertions(1)

    const fetchImpl = detailFetch()
    const client = new WaltClient({ tokenProvider: async () => 'jwt.token.value', fetch: fetchImpl })
    await Array.fromAsync(client.detailsFor([{ id: 10000000000001, gateway: 'xstocks_dividends' } as Transaction]))

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/api/v1/transactions/details/10000000000001/?transaction_gateway=xstocks_dividends'
    )
  })

  it('keeps several lookups in flight rather than going one at a time', async () => {
    expect.assertions(1)

    let inFlight = 0
    let peak = 0
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 0))
      inFlight--
      const id = String(input).split('/details/')[1]?.replace(/\/$/, '') ?? ''
      return jsonResponse({ id: Number(id) })
    })

    const client = new WaltClient({
      tokenProvider: async () => 'jwt.token.value',
      fetch: fetchImpl,
      maxConcurrent: 4
    })
    await Array.fromAsync(client.detailsFor(rows(12)))

    expect(peak).toBe(4)
  })

  it('accepts an async listing as well as an array', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes('/details/')) {
        const id = String(input).split('/details/')[1]?.replace(/\/$/, '') ?? ''
        return jsonResponse({ id: Number(id) })
      }
      const cursor = new URL(String(input)).searchParams.get('cursor')
      return cursor === null
        ? jsonResponse({ transactions: [{ id: 10000000000001 }], next_cursor: 'next' })
        : jsonResponse({ transactions: [], next_cursor: 'endless' })
    })

    const client = new WaltClient({ tokenProvider: async () => 'jwt.token.value', fetch: fetchImpl })
    const seen = await Array.fromAsync(client.detailsFor(client.allTransactions()))

    expect(seen.map((detail) => detail.id)).toStrictEqual([10000000000001])
  })

  it('stops the walk when a lookup keeps failing', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('10000000000003') ? jsonResponse({}, 500) : jsonResponse({ id: 1 })
    )

    const client = new WaltClient({ tokenProvider: async () => 'jwt.token.value', fetch: fetchImpl })

    await expect(Array.fromAsync(client.detailsFor(rows(6)))).rejects.toThrow('failed (500)')
  })

  it('settles outstanding lookups when the consumer stops early', async () => {
    expect.assertions(2)

    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onRejection)

    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('10000000000004') ? jsonResponse({}, 500) : jsonResponse({ id: 1 })
    )
    const client = new WaltClient({ tokenProvider: async () => 'jwt.token.value', fetch: fetchImpl })

    for await (const detail of client.detailsFor(rows(8))) {
      expect(detail.id).toBe(1)
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
    process.off('unhandledRejection', onRejection)

    expect(rejections).toStrictEqual([])
  })
})

describe('normalizeTransaction', () => {
  it('reads a deposit of the quote currency as a sale of the paired asset', () => {
    expect.assertions(2)

    const legs = normalizeTransaction(
      detailsOf({
        type: 'deposit',
        crypto_amount: '1000.000000',
        crypto_currency: 'USDT',
        pair_transaction_amount: '0.010000000000',
        pair_transaction_currency: 'BTC'
      })
    )

    expect(legs.received).toStrictEqual({ currency: 'USDT', amount: '1000.000000' })
    expect(legs.sent).toStrictEqual({ currency: 'BTC', amount: '0.010000000000' })
  })

  it('reads a deposit of the asset as a purchase paid for in the quote currency', () => {
    expect.assertions(2)

    const legs = normalizeTransaction(
      detailsOf({
        type: 'deposit',
        crypto_amount: '2.000000',
        crypto_currency: 'GMEx',
        pair_transaction_amount: '200.000000',
        pair_transaction_currency: 'USDT'
      })
    )

    expect(legs.received).toStrictEqual({ currency: 'GMEx', amount: '2.000000' })
    expect(legs.sent).toStrictEqual({ currency: 'USDT', amount: '200.000000' })
  })

  it('flips both legs for a withdraw', () => {
    expect.assertions(2)

    const legs = normalizeTransaction(
      detailsOf({
        type: 'withdraw',
        crypto_amount: '50.000000',
        crypto_currency: 'TON',
        pair_transaction_amount: '90.000000',
        pair_transaction_currency: 'USDT'
      })
    )

    expect(legs.sent).toStrictEqual({ currency: 'TON', amount: '50.000000' })
    expect(legs.received).toStrictEqual({ currency: 'USDT', amount: '90.000000' })
  })

  it('ignores a pair that only repeats the same asset back', () => {
    expect.assertions(2)

    const legs = normalizeTransaction(
      detailsOf({
        type: 'deposit',
        gateway: 'p2p_order',
        crypto_amount: '100.000000',
        crypto_currency: 'USDT',
        pair_transaction_amount: '101.000000',
        pair_transaction_currency: 'USDT'
      })
    )

    expect(legs.received).toStrictEqual({ currency: 'USDT', amount: '100.000000' })
    expect(legs.sent).toBeNull()
  })

  it('leaves one side empty when there is no pair at all', () => {
    expect.assertions(2)

    const legs = normalizeTransaction(
      detailsOf({ type: 'withdraw', gateway: 'withdraw_onchain', crypto_amount: '25.00', crypto_currency: 'USDT' })
    )

    expect(legs.sent).toStrictEqual({ currency: 'USDT', amount: '25.00' })
    expect(legs.received).toBeNull()
  })

  it('reports a fee without implying it should be subtracted again', () => {
    expect.assertions(2)

    const legs = normalizeTransaction(
      detailsOf({
        crypto_amount: '0.500000',
        crypto_currency: 'AAPLx',
        pair_transaction_amount: '100.000000',
        pair_transaction_currency: 'USDT',
        fee_amount: '0.005000',
        fee_currency: 'AAPLx'
      })
    )

    expect(legs.fee).toStrictEqual({ currency: 'AAPLx', amount: '0.005000' })
    expect(legs.received).toStrictEqual({ currency: 'AAPLx', amount: '0.500000' })
  })

  it('treats a zero or absent fee as no fee', () => {
    expect.assertions(2)

    expect(normalizeTransaction(detailsOf({ fee_amount: '0', fee_currency: 'USDT' })).fee).toBeNull()
    expect(normalizeTransaction(detailsOf({})).fee).toBeNull()
  })
})

describe('waltClient exchange', () => {
  const quoteResponse = {
    from_amount: 1,
    from_currency: 'USDT',
    to_amount: 0.0172,
    to_currency: 'XLEx',
    rate: 0.0172,
    min_amount: 1.1,
    max_amount: 25000
  }

  it('reads the available pairs with a plain GET', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ BTC: ['TON', 'USDT'] }))
    const pairs = await makeClient(fetchImpl).availableExchanges()
    const [url, options] = fetchImpl.mock.calls[0] ?? []

    expect(url).toContain('/api/v1/exchange/get-available-exchanges/')
    expect(options?.method).toBe('GET')
    expect(pairs).toStrictEqual({ BTC: ['TON', 'USDT'] })
  })

  it('posts a quote as json with the origin the web app sends', async () => {
    expect.assertions(5)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(quoteResponse))
    await makeClient(fetchImpl).quote('USDT', 'XLEx', 1)
    const [url, options] = fetchImpl.mock.calls[0] ?? []

    expect(url).toContain('/api/v1/exchange/convert/')
    expect(options?.method).toBe('POST')
    expect(headersOf(fetchImpl)['content-type']).toBe('application/json')
    expect(headersOf(fetchImpl)['origin']).toBe('https://walletbot.me')
    expect(JSON.parse(String(options?.body))).toStrictEqual({
      from_amount: 1,
      from_currency: 'USDT',
      to_currency: 'XLEx'
    })
  })

  it('does not send a body or an origin on a GET', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    await makeClient(fetchImpl).accounts()
    const [, options] = fetchImpl.mock.calls[0] ?? []

    expect(options?.body).toBeNull()
    expect(headersOf(fetchImpl)['origin']).toBeUndefined()
    expect(headersOf(fetchImpl)['content-type']).toBeUndefined()
  })

  it('sends the whole exchange request through unchanged', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ uid: 'u', ttl: 20 }))
    const request = {
      from_currency: 'XLEx',
      to_currency: 'USDT',
      from_amount: 4.5,
      local_currency: 'USD' as const,
      max_amount: true
    }
    await makeClient(fetchImpl).createExchange(request)
    const [url, options] = fetchImpl.mock.calls[0] ?? []

    expect(url).toContain('/api/v1/exchange/create_exchange/')
    expect(JSON.parse(String(options?.body))).toStrictEqual(request)
  })

  it('retries a quote on a transient status', async () => {
    expect.assertions(2)

    const responses = [jsonResponse({}, 503), jsonResponse(quoteResponse)]
    const fetchImpl = vi.fn<typeof fetch>(async () => responses.shift() ?? jsonResponse({}, 500))
    const client = new WaltClient({ tokenProvider: async () => 'jwt', fetch: fetchImpl, retryDelayMs: 0 })

    await expect(client.quote('USDT', 'XLEx', 0)).resolves.toStrictEqual(quoteResponse)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('never retries an exchange, whatever the retry setting', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 503))
    const client = new WaltClient({ tokenProvider: async () => 'jwt', fetch: fetchImpl, retries: 3, retryDelayMs: 0 })
    const request = { from_currency: 'USDT', to_currency: 'XLEx', from_amount: 1, local_currency: 'USD' as const }

    await expect(client.createExchange(request)).rejects.toBeInstanceOf(WaltRequestError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('replays the body when the token is refreshed on a 401', async () => {
    expect.assertions(3)

    const tokens = ['stale', 'fresh']
    const tokenProvider = vi.fn<() => Promise<string>>(async () => tokens.shift() ?? 'fresh')
    const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
      const auth = (options?.headers as Record<string, string> | undefined)?.['authorization']
      return auth === 'fresh' ? jsonResponse(quoteResponse) : jsonResponse({ code: 'token_corrupted' }, 401)
    })

    await new WaltClient({ tokenProvider, fetch: fetchImpl }).quote('USDT', 'XLEx', 1)
    const bodies = fetchImpl.mock.calls.map(([, options]) => String(options?.body))

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(bodies[0]).toBe(bodies[1])
    expect(headersOf(fetchImpl, 1)['authorization']).toBe('fresh')
  })

  it('names the method in the error', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ detail: 'bad' }, 422))

    await expect(makeClient(fetchImpl).quote('USDT', 'XLEx', 1)).rejects.toThrow(
      'POST /api/v1/exchange/convert/ failed (422)'
    )
  })
})
