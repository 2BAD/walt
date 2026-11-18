import { describe, expect, it, vi } from 'vitest'
import { WaltClient } from '~/client.ts'
import { WaltAuthError, WaltError, WaltRequestError } from '~/transport.ts'

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const makeClient = (fetchImpl: FetchMock) =>
  new WaltClient({ tokenProvider: async () => 'jwt.token.value', fetch: fetchImpl })

const portfolioFetch = (accounts: unknown, closes: Record<string, string>) =>
  vi.fn<typeof fetch>(async (input, init) => {
    if (!String(input).endsWith('/candles/batch')) return jsonResponse(accounts)
    const { requests } = JSON.parse(String(init?.body)) as { requests: { ticker: string }[] }
    return jsonResponse({
      responses: requests.map(({ ticker }) => {
        const close = closes[ticker]
        const candles = close === undefined ? [] : [{ o: close, h: close, l: close, c: close, v: '0' }]
        return { ticker, resolution: '1m', start_ts: 1, candles }
      })
    })
  })

describe('waltClient', () => {
  it('requires a tokenProvider', () => {
    expect.assertions(1)

    expect(() => new WaltClient({} as unknown as { tokenProvider: () => Promise<string> })).toThrow(TypeError)
  })

  it('prices a portfolio at the latest candle close', async () => {
    expect.assertions(4)

    const fetchImpl = portfolioFetch(
      {
        available_balance_total_fiat_amount: '150.00',
        available_balance_total_fiat_currency: 'USD',
        accounts: [
          { currency: 'TON', available_balance: '10', available_balance_fiat_amount: '50.00' },
          { currency: 'BTC', available_balance: '0.5', available_balance_fiat_amount: '100.00' },
          { currency: 'ETH', available_balance: '0', available_balance_fiat_amount: '0.00' }
        ]
      },
      { 'TON/USD/SPOT': '12', 'BTC/USD/SPOT': '300' }
    )

    const { entries, total, fiatCurrency } = await makeClient(fetchImpl).portfolio()

    expect(entries).toStrictEqual([
      { currency: 'BTC', amount: '0.5', fiatValue: 150 },
      { currency: 'TON', amount: '10', fiatValue: 120 }
    ])
    expect(total).toBe(270)
    expect(fiatCurrency).toBe('USD')
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toStrictEqual({
      requests: [
        { ticker: 'TON/USD/SPOT', resolution: '1m', limit: 1 },
        { ticker: 'BTC/USD/SPOT', resolution: '1m', limit: 1 }
      ]
    })
  })

  it('adds what the accounts total holds beyond spot balances as staked', async () => {
    expect.assertions(3)

    const fetchImpl = portfolioFetch(
      {
        available_balance_total_fiat_amount: '250.00',
        available_balance_total_fiat_currency: 'USD',
        accounts: [
          { currency: 'TON', available_balance: '10', available_balance_fiat_amount: '50.00' },
          { currency: 'BTC', available_balance: '0.5', available_balance_fiat_amount: '100.00' }
        ]
      },
      { 'TON/USD/SPOT': '12', 'BTC/USD/SPOT': '300' }
    )

    const { entriesTotal, total, staked } = await makeClient(fetchImpl).portfolio()

    expect(entriesTotal).toBe(270)
    expect(staked).toBe(100)
    expect(total).toBe(370)
  })

  it('reports nothing staked when the spot balances already reach the accounts total', async () => {
    expect.assertions(2)

    const fetchImpl = portfolioFetch(
      {
        available_balance_total_fiat_amount: '50.00',
        available_balance_total_fiat_currency: 'USD',
        accounts: [
          { currency: 'TON', available_balance: '10', available_balance_fiat_amount: '50.00' },
          { currency: 'ETH', available_balance: '0', available_balance_fiat_amount: '0.00' }
        ]
      },
      { 'TON/USD/SPOT': '12' }
    )

    const { entriesTotal, staked } = await makeClient(fetchImpl).portfolio()

    expect(entriesTotal).toBe(120)
    expect(staked).toBe(0)
  })

  it('asks for candles in batches of 20', async () => {
    expect.assertions(2)

    const currencies = Array.from({ length: 45 }, (_, index) => `COIN${index}`)
    const fetchImpl = portfolioFetch(
      {
        available_balance_total_fiat_amount: '45.00',
        available_balance_total_fiat_currency: 'USD',
        accounts: currencies.map((currency) => ({
          currency,
          available_balance: '1',
          available_balance_fiat_amount: '1.00'
        }))
      },
      Object.fromEntries(currencies.map((currency) => [`${currency}/USD/SPOT`, '2']))
    )

    const { entriesTotal } = await makeClient(fetchImpl).portfolio()
    const batchSizes = fetchImpl.mock.calls
      .slice(1)
      .map(([, init]) => (JSON.parse(String(init?.body)) as { requests: unknown[] }).requests.length)

    expect(entriesTotal).toBe(90)
    expect(batchSizes.toSorted((a, b) => b - a)).toStrictEqual([20, 20, 5])
  })

  it('keeps the accounts values and asks for no candles when the account is not in usd', async () => {
    expect.assertions(3)

    const fetchImpl = portfolioFetch(
      {
        available_balance_total_fiat_amount: '250.00',
        available_balance_total_fiat_currency: 'EUR',
        accounts: [{ currency: 'TON', available_balance: '10', available_balance_fiat_amount: '50.00' }]
      },
      { 'TON/USD/SPOT': '12' }
    )

    const { entries, total } = await makeClient(fetchImpl).portfolio()

    expect(entries).toStrictEqual([{ currency: 'TON', amount: '10', fiatValue: 50 }])
    expect(total).toBe(250)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects a held balance that has no candle', async () => {
    expect.assertions(1)

    const fetchImpl = portfolioFetch(
      {
        available_balance_total_fiat_amount: '50.00',
        available_balance_total_fiat_currency: 'USD',
        accounts: [{ currency: 'TON', available_balance: '10', available_balance_fiat_amount: '50.00' }]
      },
      {}
    )

    await expect(makeClient(fetchImpl).portfolio()).rejects.toThrow('TON has no candle price')
  })

  it('rejects a portfolio total that is not a number', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ available_balance_total_fiat_currency: 'USD', accounts: [] })
    )

    await expect(makeClient(fetchImpl).portfolio()).rejects.toThrow('total is not a number')
  })

  it('throws a named WaltError for a response it cannot use', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: null }))
    const failure = makeClient(fetchImpl).portfolio()

    await expect(failure).rejects.toThrow(WaltError)
    await expect(failure).rejects.toHaveProperty('name', 'WaltError')
  })

  it('names the auth and request errors and makes them WaltErrors', () => {
    expect.assertions(4)

    const auth = new WaltAuthError('rejected')
    const request = new WaltRequestError('failed', 500, null, null)

    expect(auth).toBeInstanceOf(WaltError)
    expect(auth.name).toBe('WaltAuthError')
    expect(request).toBeInstanceOf(WaltError)
    expect(request.name).toBe('WaltRequestError')
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

    const fetchImpl = portfolioFetch(
      {
        available_balance_total_fiat_amount: '50.00',
        available_balance_total_fiat_currency: 'USD',
        accounts: [
          { currency: 'ETH', available_balance: '0', available_balance_fiat_amount: null },
          { currency: 'TON', available_balance: '10', available_balance_fiat_amount: '50.00' }
        ]
      },
      { 'TON/USD/SPOT': '12' }
    )
    const { entries } = await makeClient(fetchImpl).portfolio()

    expect(entries.map((entry) => entry.currency)).toStrictEqual(['TON'])
  })

  it('unwraps the coins list', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ coins: [{ currency: 'BTC', rate: '62000' }] }))
    const coins = await makeClient(fetchImpl).coins()

    expect(coins[0]?.currency).toBe('BTC')
  })

  it('encodes the padding in a base64 cursor', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('cursor=')
        ? jsonResponse({ transactions: [] })
        : jsonResponse({ transactions: [{ id: 10000000000001 }], next_cursor: 'MTAwMDAwMDAwMDAwMDE6Tm9uZQ==' })
    )
    await makeClient(fetchImpl).transactions()

    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      'https://walletbot.me/api/v1/transactions/?limit=1000&cursor=MTAwMDAwMDAwMDAwMDE6Tm9uZQ%3D%3D'
    )
  })

  it('scopes transactions to one currency', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ transactions: [] }))
    await makeClient(fetchImpl).transactions({ currency: 'TON' })

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/api/v1/transactions/single-account/?crypto_currency=TON&limit=1000'
    )
  })

  it('stops paging when a page comes back empty despite a fresh cursor', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const cursor = new URL(String(input)).searchParams.get('cursor')
      if (cursor === null) return jsonResponse({ transactions: [{ id: 10000000000001 }], next_cursor: 'second' })
      if (cursor === 'second') return jsonResponse({ transactions: [{ id: 10000000000002 }], next_cursor: 'third' })
      return jsonResponse({ transactions: [], next_cursor: 'endless' })
    })

    const rows = await makeClient(fetchImpl).transactions()

    expect(rows.map((row) => row.id)).toStrictEqual([10000000000001, 10000000000002])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('stops paging when the api does return a null cursor', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ transactions: [{ id: 10000000000001 }], next_cursor: null })
    )

    const rows = await makeClient(fetchImpl).transactions()

    expect(rows).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('throws instead of looping when the api repeats a cursor', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ transactions: [{ id: 10000000000001 }], next_cursor: 'stuck' })
    )

    await expect(makeClient(fetchImpl).transactions()).rejects.toThrow('cursor twice')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('keeps the currency on every page of one currency', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const cursor = new URL(String(input)).searchParams.get('cursor')
      if (cursor === null) return jsonResponse({ transactions: [{ id: 10000000000001 }], next_cursor: 'next' })
      return jsonResponse({ transactions: [], next_cursor: 'endless' })
    })

    const rows = await makeClient(fetchImpl).transactions({ currency: 'TON' })

    expect(rows).toHaveLength(1)
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      'https://walletbot.me/api/v1/transactions/single-account/?crypto_currency=TON&limit=1000&cursor=next'
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
    const details = await makeClient(fetchImpl).coinDetails('TON')

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

    const { day } = await makeClient(fetchImpl).charts('TON')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/charts/TON/USD/')
    expect(day[0]?.rate).toBe('5.12')
    expect(day[0]?.timestamp).toBe(1767225600)
  })

  it('sends all four required parameters for a historical price lookup', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ rate: '1.500000000000' }))
    const price = await makeClient(fetchImpl).priceForFiatAtTime('TON', 1, '2026-01-01T00:00:00Z')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/api/v1/exchange_rates/price_for_fiat_at_time/?crypto_currency=TON&local_currency=USD&amount=1&time=2026-01-01T00%3A00%3A00Z'
    )
    expect(price.rate).toBe('1.500000000000')
  })

  it('serialises a Date for a historical price lookup', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}))
    await makeClient(fetchImpl).priceForFiatAtTime('TON', 1, new Date('2026-01-01T00:00:00Z'))

    expect(fetchImpl.mock.calls[0]?.[0]).toContain('time=2026-01-01T00%3A00%3A00.000Z')
  })

  it('sends the fiat currency of the client to every endpoint that takes one', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ coins: [], data: {} }))
    const client = new WaltClient({
      tokenProvider: async () => 'jwt.token.value',
      fetch: fetchImpl,
      fiatCurrency: 'EUR'
    })
    await client.balances()
    await client.coins()
    await client.coinDetails('TON')
    await client.charts('TON')
    await client.priceForFiatAtTime('TON', 1, '2026-01-01T00:00:00Z')

    expect(fetchImpl.mock.calls.map(([url]) => String(url).replace('https://walletbot.me', ''))).toStrictEqual([
      '/portmone/public-api/v1/user/accounts?fiat_currency=EUR',
      '/api/v1/coins/list/EUR/',
      '/api/v1/coins/details/TON/EUR/',
      '/api/v1/charts/TON/EUR/',
      '/api/v1/exchange_rates/price_for_fiat_at_time/?crypto_currency=TON&local_currency=EUR&amount=1&time=2026-01-01T00%3A00%3A00Z'
    ])
  })

  it('reads the local currency', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ local_currency: 'USD' }))
    const currency = await makeClient(fetchImpl).localCurrency()

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/currencies/local_currency/')
    expect(currency).toBe('USD')
  })

  it.each([
    [{ maxConcurrent: 0 }, 'maxConcurrent'],
    [{ maxConcurrent: Number.NaN }, 'maxConcurrent'],
    [{ retries: -1 }, 'retries'],
    [{ retries: 1.5 }, 'retries']
  ])('rejects %o', (options, name) => {
    expect.assertions(1)

    expect(() => new WaltClient({ tokenProvider: async () => 'jwt', ...options })).toThrow(
      new RegExp(`^${name} must be`)
    )
  })

  it('accepts an unlimited maxConcurrent', () => {
    expect.assertions(1)

    expect(() => new WaltClient({ tokenProvider: async () => 'jwt', maxConcurrent: Infinity })).not.toThrow()
  })
})

describe('waltClient earn', () => {
  it('requests the campaigns endpoint with its trailing slash', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ campaigns: [] }))
    const campaigns = await makeClient(fetchImpl).earnCampaigns()

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/earn/public-api/v1/campaigns/')
    expect(campaigns).toStrictEqual([])
  })

  it('scopes transactions to one campaign', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ transactions: [] }))
    await makeClient(fetchImpl).earnCampaignTransactions(11)

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/earn/public-api/v1/campaigns/11/transactions?limit=1000&merge_with_transfer_requests=true'
    )
  })

  it('pages campaign transactions with every set cursor until a short page, although the cursor stays set', async () => {
    expect.assertions(3)

    const fullPage = Array.from({ length: 1000 }, (_, index) => ({ id: 10000000002000 - index }))
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const offset = new URL(String(input)).searchParams.get('deposit_acc_offset_id')
      const rows = offset === null ? fullPage : [{ id: 10000000000001 }]
      return jsonResponse({
        transactions: rows,
        deposit_acc_next_from: Math.min(...rows.map((row) => row.id)),
        payout_acc_next_from: null,
        transfer_request_next_before_datetime: '2026-01-01T00:00:00Z'
      })
    })

    const rows = await makeClient(fetchImpl).earnCampaignTransactions(11)

    expect(rows).toHaveLength(1001)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(Object.fromEntries(new URL(String(fetchImpl.mock.calls[1]?.[0])).searchParams)).toStrictEqual({
      limit: '1000',
      merge_with_transfer_requests: 'true',
      deposit_acc_offset_id: '10000000001001',
      transfer_request_before_datetime: '2026-01-01T00:00:00Z'
    })
  })

  it('throws instead of looping when campaign cursors repeat', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        transactions: Array.from({ length: 1000 }, () => ({ id: 10000000000001 })),
        deposit_acc_next_from: 10000000000001,
        payout_acc_next_from: null,
        transfer_request_next_before_datetime: null
      })
    )

    await expect(makeClient(fetchImpl).earnCampaignTransactions(11)).rejects.toThrow('cursor twice')
  })

  it('encodes both sides of a rate lookup', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ rate: '1' }))
    await makeClient(fetchImpl).earnRate('USDT', 'USDe')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/earn/public-api/v1/rate/USDT/USDe')
  })
})

describe('waltClient portfolio history', () => {
  it('sends a date as its utc calendar day', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ chart: { data_points: [] } }))
    await makeClient(fetchImpl).portfolioHistory(new Date('2026-01-01T23:30:00.000Z'), '1m')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/customer-analytics/public-api/v1/portfolio/private/?date_from=2026-01-01&resolution=1m'
    )
  })
})

describe('waltClient limit orders', () => {
  it('pages through every order with the status filter on each page until one comes without a cursor', async () => {
    expect.assertions(2)

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'order-1' }, { id: 'order-2' }], next_cursor: 'cursor+2=' }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'order-3' }] }))
    const orders = await makeClient(fetchImpl).limitOrders({ statuses: ['OPEN', 'CANCELLING'] })

    expect(orders.map((order) => order.id)).toStrictEqual(['order-1', 'order-2', 'order-3'])
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toStrictEqual([
      'https://walletbot.me/emporos/public-api/orders/limit?status=OPEN&status=CANCELLING&limit=100',
      'https://walletbot.me/emporos/public-api/orders/limit?status=OPEN&status=CANCELLING&limit=100&cursor=cursor%2B2%3D'
    ])
  })

  it('stops paging orders at an empty page that still carries a cursor', async () => {
    expect.assertions(2)

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'order-1' }], next_cursor: 'cursor-2' }))
      .mockResolvedValueOnce(jsonResponse({ items: [], next_cursor: 'cursor-3' }))
    const orders = await makeClient(fetchImpl).limitOrders()

    expect(orders).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('throws instead of looping when the order list repeats a cursor', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [{ id: 'order-1' }], next_cursor: 'cursor-2' })
    )

    await expect(makeClient(fetchImpl).limitOrders()).rejects.toThrow('returned a cursor twice')
  })

  it('fetches one order by id', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ id: 'order-1' }))
    await makeClient(fetchImpl).limitOrder('order-1')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/emporos/public-api/orders/limit/by-id?id=order-1')
  })

  it.each([
    [{ amount: 25 }, 'amount=25'],
    [{ quantity: '0.0001' }, 'quantity=0.0001']
  ])('quotes an order sized by %o', async (size, expected) => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}))
    await makeClient(fetchImpl).limitOrderQuote('BTC', 'BUY', 50000, size)

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `https://walletbot.me/emporos/public-api/orders/limit/quote?base_currency=BTC&side=BUY&price_limit=50000&${expected}`
    )
  })

  it('asks for the bounds of one currency', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}))
    await makeClient(fetchImpl).limitOrderBounds('NVDAx')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/emporos/public-api/orders/limit/bounds?base_currency=NVDAx'
    )
  })

  it('returns the tokens', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ tokens: [{ code: 'BTC' }] }))

    expect(await makeClient(fetchImpl).limitOrderTokens()).toStrictEqual([{ code: 'BTC' }])
  })
})

describe('waltClient ipo', () => {
  const order = {
    order_uid: 'order-uid-1',
    amount: '100.00',
    pay_currency: 'USDT',
    status: 'active',
    created_at: '2026-01-02T03:04:05.000000Z',
    updated_at: '2026-01-02T03:04:05.000000Z'
  }
  const listed = {
    id: 101,
    allocation_currency: 'ACMEx',
    funding_deadline_dt: '2026-01-09T15:00:00Z',
    indicative_price: '10.00',
    indicative_price_range_min: '9.00',
    indicative_price_range_max: '11.00',
    is_funding_open: true
  }

  it('unwraps the ipo list and keeps the order of each', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        ipos: [
          { ...listed, active_order: order },
          { ...listed, id: 102, active_order: null }
        ]
      })
    )
    const ipos = await makeClient(fetchImpl).ipos()

    expect(ipos.map((ipo) => ipo.active_order?.amount)).toStrictEqual(['100.00', undefined])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/ipo/info/list/')
  })

  it('fetches one ipo by id with its trailing slash', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ...listed, pay_currency: 'USDT', fee_percent: '1.0', steps: [], active_order: order })
    )
    const ipo = await makeClient(fetchImpl).ipo(101)

    expect(ipo.active_order).toStrictEqual(order)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/ipo/info/101/')
  })
})

describe('waltClient balances', () => {
  it('unwraps the data envelope', async () => {
    expect.assertions(2)

    const data = { accounts: [{ account_type: 'HOLD_LIMIT', currency: 'USDT' }], fiat_currency: 'USD' }
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ status: 'SUCCESS', data }))

    expect(await makeClient(fetchImpl).balances()).toStrictEqual(data)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/portmone/public-api/v1/user/accounts?fiat_currency=USD'
    )
  })
})

describe('waltClient perps', () => {
  it('lists every contract', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ contracts: [{ contract_id: 1 }] }))

    expect(await makeClient(fetchImpl).perpContracts()).toStrictEqual([{ contract_id: 1 }])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/perps/public-api/v1/contracts/')
  })

  it('asks for one contract', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ contracts: [] }))
    await makeClient(fetchImpl).perpContracts({ contractId: 111 })

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/perps/public-api/v1/contracts/?contract_id=111')
  })

  it('fetches the system status', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}))
    await makeClient(fetchImpl).perpSystemStatus()

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/perps/public-api/v1/system-status/')
  })

  it('lists positions filtered by contract and status', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ positions: [] }))

    expect(await makeClient(fetchImpl).perpPositions({ statuses: ['open'], contractId: 111 })).toStrictEqual([])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/perps/public-api/v1/positions/?contract_id=111&statuses=open'
    )
  })

  it('lists positions without filters', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ positions: [] }))
    await makeClient(fetchImpl).perpPositions()

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/perps/public-api/v1/positions/')
  })

  it('lists orders with repeated statuses', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ orders: [{ order_id: 'order-1' }], next_cursor: null, last_sort_ts: null })
    )

    expect(await makeClient(fetchImpl).perpOrders({ contractId: 111, statuses: ['pending', 'filled'] })).toStrictEqual([
      { order_id: 'order-1' }
    ])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/perps/public-api/v2/orders/?limit=100&contract_id=111&statuses=pending&statuses=filled'
    )
  })

  it('pages perp orders by cursor with the filters on every page until the cursor is null', async () => {
    expect.assertions(2)

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ orders: [{ order_id: 'order-1' }], next_cursor: 'cursor+2=', last_sort_ts: 'ts' })
      )
      .mockResolvedValueOnce(jsonResponse({ orders: [{ order_id: 'order-2' }], next_cursor: null, last_sort_ts: 'ts' }))
    const orders = await makeClient(fetchImpl).perpOrders({ statuses: ['filled'] })

    expect(orders.map((order) => order.order_id)).toStrictEqual(['order-1', 'order-2'])
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toStrictEqual([
      'https://walletbot.me/perps/public-api/v2/orders/?limit=100&statuses=filled',
      'https://walletbot.me/perps/public-api/v2/orders/?limit=100&statuses=filled&cursor=cursor%2B2%3D'
    ])
  })
})

describe('waltClient candles', () => {
  it('posts the batch and returns the series', async () => {
    expect.assertions(3)

    const series = [{ ticker: 'BTC/USD/SPOT', resolution: '5m', start_ts: 1, candles: [] }]
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ responses: series }))
    const requests = [{ ticker: 'BTC/USD/SPOT', resolution: '5m', limit: 6 }]

    expect(await makeClient(fetchImpl).candles(requests)).toStrictEqual(series)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/kandelabr/public-api/v1/candles/batch')
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toStrictEqual({ requests })
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

  it('posts only the amount and currencies of an exchange request as a quote', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(quoteResponse))
    const request = {
      from_currency: 'USDT',
      to_currency: 'XLEx',
      from_amount: 1,
      local_currency: 'USD' as const,
      max_amount: true
    }
    await makeClient(fetchImpl).exchangeQuote(request)
    const [url, options] = fetchImpl.mock.calls[0] ?? []

    expect(url).toContain('/api/v1/exchange/convert/')
    expect(options?.method).toBe('POST')
    expect(JSON.parse(String(options?.body))).toStrictEqual({
      from_amount: 1,
      from_currency: 'USDT',
      to_currency: 'XLEx'
    })
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

    await expect(
      client.exchangeQuote({ from_currency: 'USDT', to_currency: 'XLEx', from_amount: 0 })
    ).resolves.toStrictEqual(quoteResponse)
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
})
