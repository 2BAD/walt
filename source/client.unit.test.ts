import { describe, expect, it, vi } from 'vitest'
import type { Transaction } from '~/api/transactions.ts'
import { WaltClient } from '~/client.ts'
import { WaltAuthError, WaltRequestError } from '~/transport.ts'

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const makeClient = (fetchImpl: FetchMock) =>
  new WaltClient({ tokenProvider: async () => 'jwt.token.value', fetch: fetchImpl })

describe('waltClient', () => {
  it('requires a tokenProvider', () => {
    expect.assertions(1)

    expect(() => new WaltClient({} as unknown as { tokenProvider: () => Promise<string> })).toThrow(WaltAuthError)
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
    await makeClient(fetchImpl).transactions(undefined, 'MTAwMDAwMDAwMDAwMDE6Tm9uZQ==')

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

  it('throws instead of looping when the api repeats a cursor', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ transactions: [{ id: 10000000000001 }], next_cursor: 'stuck' })
    )

    await expect(Array.fromAsync(makeClient(fetchImpl).allTransactions())).rejects.toThrow('cursor twice')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
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
    await client.transactions(20, 'cur/sor')
    await client.accountTransactions('TON', 2, 'cur/sor')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/api/v1/transactions/?limit=20&cursor=cur%2Fsor')
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      'https://walletbot.me/api/v1/transactions/single-account/?crypto_currency=TON&limit=2&cursor=cur%2Fsor'
    )
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
    const { campaigns } = await makeClient(fetchImpl).earnCampaigns()

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://walletbot.me/earn/public-api/v1/campaigns/')
    expect(campaigns).toStrictEqual([])
  })

  it('scopes transactions to one campaign', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ transactions: [] }))
    await makeClient(fetchImpl).earnCampaignTransactions(11)

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/earn/public-api/v1/campaigns/11/transactions?merge_with_transfer_requests=true'
    )
  })

  it('asks for the page after a given one with its set cursors', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ transactions: [] }))
    await makeClient(fetchImpl).earnCampaignTransactions(11, 50, {
      transactions: [],
      deposit_acc_next_from: 10000000000001,
      payout_acc_next_from: null,
      transfer_request_next_before_datetime: '2026-01-01T00:00:00Z'
    })
    const query = new URL(String(fetchImpl.mock.calls[0]?.[0])).searchParams

    expect(Object.fromEntries(query)).toStrictEqual({
      limit: '50',
      merge_with_transfer_requests: 'true',
      deposit_acc_offset_id: '10000000000001',
      transfer_request_before_datetime: '2026-01-01T00:00:00Z'
    })
  })

  it('walks campaign transactions until a short page, although the cursor stays set', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const offset = new URL(String(input)).searchParams.get('deposit_acc_offset_id')
      const ids = offset === null ? [10000000000003, 10000000000002] : [10000000000001]
      return jsonResponse({
        transactions: ids.map((id) => ({ id })),
        deposit_acc_next_from: Math.min(...ids),
        payout_acc_next_from: null,
        transfer_request_next_before_datetime: null
      })
    })

    const rows = await Array.fromAsync(makeClient(fetchImpl).allEarnCampaignTransactions(11, 2))

    expect(rows.map((row) => row.id)).toStrictEqual([10000000000003, 10000000000002, 10000000000001])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(new URL(String(fetchImpl.mock.calls[1]?.[0])).searchParams.get('deposit_acc_offset_id')).toBe(
      '10000000000002'
    )
  })

  it('throws instead of looping when campaign cursors repeat', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        transactions: [{ id: 10000000000001 }],
        deposit_acc_next_from: 10000000000001,
        payout_acc_next_from: null,
        transfer_request_next_before_datetime: null
      })
    )

    await expect(Array.fromAsync(makeClient(fetchImpl).allEarnCampaignTransactions(11, 1))).rejects.toThrow(
      'cursor twice'
    )
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
  it('lists orders filtered by status and returns the items', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ items: [{ id: 'order-1' }] }))
    const orders = await makeClient(fetchImpl).limitOrders({ status: ['OPEN', 'CANCELLING'], limit: 100 })

    expect(orders).toStrictEqual([{ id: 'order-1' }])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/emporos/public-api/orders/limit?status=OPEN&status=CANCELLING&limit=100'
    )
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

describe('waltClient balances', () => {
  it('unwraps the data envelope', async () => {
    expect.assertions(2)

    const data = { accounts: [{ account_type: 'HOLD_LIMIT', currency: 'USDT' }], fiat_currency: 'USD' }
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ status: 'SUCCESS', data }))

    expect(await makeClient(fetchImpl).balances('USD')).toStrictEqual(data)
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
    await makeClient(fetchImpl).perpContracts(111)

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

    const page = { orders: [], next_cursor: null, last_sort_ts: null }
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(page))

    expect(
      await makeClient(fetchImpl).perpOrders({ contractId: 111, limit: 3, statuses: ['pending', 'filled'] })
    ).toStrictEqual(page)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://walletbot.me/perps/public-api/v2/orders/?contract_id=111&limit=3&statuses=pending&statuses=filled'
    )
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

  it('leaves no unhandled rejection when a later lookup fails while an earlier one is pending', async () => {
    expect.assertions(2)

    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onRejection)

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes('10000000000001')) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return jsonResponse({ id: 1 })
      }
      return jsonResponse({}, 400)
    })
    const client = new WaltClient({ tokenProvider: async () => 'jwt.token.value', fetch: fetchImpl })

    await expect(Array.fromAsync(client.detailsFor(rows(3)))).rejects.toThrow('failed (400)')
    process.off('unhandledRejection', onRejection)

    expect(rejections).toStrictEqual([])
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

  it('posts a quote as json', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(quoteResponse))
    await makeClient(fetchImpl).quote('USDT', 'XLEx', 1)
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
})
