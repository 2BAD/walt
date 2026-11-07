import { describe, expect, it, vi } from 'vitest'
import { run, UsageError } from '~/cli/run.ts'
import { WaltClient } from '~/client.ts'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const clientFor = (routes: Record<string, unknown>) => {
  const fetchImpl = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    const match = Object.keys(routes).find((path) => url.includes(path))
    return match === undefined ? jsonResponse({ detail: 'not found' }, 404) : jsonResponse(routes[match])
  })
  return { client: new WaltClient({ tokenProvider: async () => 'jwt.token.value', fetch: fetchImpl }), fetchImpl }
}

const account = (account_type: string, currency: string, total: string, fiat: string) => ({
  account_type,
  currency,
  total_balance: total,
  available_balance: total,
  available_balance_fiat_amount: fiat
})

describe('balances', () => {
  const routes = {
    '/portmone/public-api/v1/user/accounts': {
      status: 'SUCCESS',
      data: {
        fiat_currency: 'USD',
        overall_available_balance_fiat_amount: '400.00',
        has_open_perp_position: false,
        accounts: [
          account('REGULAR', 'TON', '10.000000000000000001', '100.00'),
          account('HOLD_LIMIT', 'USDT', '200', '200.00'),
          account('EARN_V2', 'SOL', '1', '100.00'),
          account('REGULAR', 'ETH', '0', '0')
        ]
      }
    }
  }

  it('lists every non-empty balance by value with its kind and share', async () => {
    expect.assertions(1)

    const { client } = clientFor(routes)

    expect(await run(client, 'balances', [])).toBe(
      [
        'ASSET  KIND    AMOUNT  VALUE USD  SHARE',
        'USDT   orders     200     200.00  50.0%',
        'TON    spot        10     100.00  25.0%',
        'SOL    earn         1     100.00  25.0%',
        'total 400.00 USD'
      ].join('\n')
    )
  })

  it('prints rows as json', async () => {
    expect.assertions(1)

    const { client } = clientFor(routes)
    const rows = JSON.parse(await run(client, 'balances', [], { json: true })) as unknown[]

    expect(rows[0]).toStrictEqual({ asset: 'USDT', kind: 'orders', amount: '200', value: '200.00', share: '50.0%' })
  })

  it('asks for the requested fiat currency', async () => {
    expect.assertions(1)

    const { client, fetchImpl } = clientFor(routes)
    await run(client, 'balances', [], { fiat: 'eur' })

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('fiat_currency=EUR')
  })
})

describe('history', () => {
  const flows = (total: string) => ({ total })
  const period = (date_from: string, close: string, pnl: string, percent: string | null) => ({
    date_from,
    close_amount_fiat: close,
    total_pnl: pnl,
    total_pnl_percent: percent,
    deposits_details: flows('10'),
    withdrawals_details: flows('0')
  })
  const routes = {
    '/customer-analytics/public-api/v1/portfolio/private/': {
      fiat_currency: 'USD',
      chart: { data_points: [period('2026-01-01', '110', '5', '4.76'), period('2026-02-01', '120', '0', null)] },
      total_period_details: period('2026-01-01', '120', '5', '4.5')
    }
  }

  it('shows one row per month', async () => {
    expect.assertions(2)

    const { client, fetchImpl } = clientFor(routes)
    const output = await run(client, 'history', [], { monthly: true, from: '2026-01-01' })

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('date_from=2026-01-01&resolution=1m')
    expect(output.split('\n')).toStrictEqual([
      'MONTH    BALANCE USD  DEPOSITS  WITHDRAWALS   P/L  P/L %',
      '2026-01       110.00     10.00         0.00  5.00  4.76%',
      '2026-02       120.00     10.00         0.00  0.00      -',
      'since 2026-01-01: P/L 5.00 USD (4.50%), deposits 10.00, withdrawals 0.00',
      'as reported by Walt'
    ])
  })

  it('defaults to daily rows over the last 30 days', async () => {
    expect.assertions(1)

    const { client, fetchImpl } = clientFor(routes)
    await run(client, 'history', [])
    const start = new Date()
    start.setUTCDate(start.getUTCDate() - 29)

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      `date_from=${start.toISOString().slice(0, 10)}&resolution=1d`
    )
  })

  it('rejects a malformed date', async () => {
    expect.assertions(1)

    await expect(run(clientFor(routes).client, 'history', [], { from: '01/01/2026' })).rejects.toThrow(UsageError)
  })
})

describe('transactions', () => {
  const page = {
    transactions: [
      {
        created_at: '2026-01-02T03:04:05Z',
        type: 'deposit',
        gateway: 'p2p_order',
        amount: '100',
        currency: 'USDT',
        status: 'success'
      }
    ],
    next_cursor: null
  }

  it('lists the latest transactions', async () => {
    expect.assertions(2)

    const { client, fetchImpl } = clientFor({ '/api/v1/transactions/': page })
    const output = await run(client, 'transactions', [], { limit: '5' })

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://walletbot.me/api/v1/transactions/?limit=5')
    expect(output.split('\n')[1]).toBe('2026-01-02 03:04  deposit  p2p_order     100  USDT   success')
  })

  it('filters by asset', async () => {
    expect.assertions(1)

    const { client, fetchImpl } = clientFor({ '/api/v1/transactions/single-account/': page })
    await run(client, 'transactions', [], { asset: 'USDT' })

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('single-account/?crypto_currency=USDT&limit=20')
  })

  it('rejects a limit that is not a whole number', async () => {
    expect.assertions(1)

    await expect(run(clientFor({}).client, 'transactions', [], { limit: 'ten' })).rejects.toThrow(UsageError)
  })
})

describe('price', () => {
  const points = (...rates: number[]) => rates.map((rate, index) => ({ rate: String(rate), timestamp: index }))

  it('shows the price and its change over each window', async () => {
    expect.assertions(1)

    const { client } = clientFor({
      '/api/v1/charts/BTC/USD/': { day: points(100, 110.000000001), week: points(88, 110), month: points(220, 110) }
    })

    expect((await run(client, 'price', ['BTC'])).split('\n')).toStrictEqual([
      'ASSET  PRICE USD      24H       7D      30D',
      'BTC          110  +10.00%  +25.00%  -50.00%'
    ])
  })

  it('shows dashes for an asset without a chart', async () => {
    expect.assertions(1)

    const { client } = clientFor({ '/api/v1/charts/NEW/USD/': { day: [], week: [], month: [] } })

    expect((await run(client, 'price', ['NEW'])).split('\n')[1]).toBe('NEW            -    -   -    -')
  })

  it('needs a symbol', async () => {
    expect.assertions(1)

    await expect(run(clientFor({}).client, 'price', [])).rejects.toThrow(UsageError)
  })
})

describe('quote', () => {
  const converted = (from_currency: string, from_amount: number, to_currency: string, to_amount: number) => ({
    from_amount,
    from_currency,
    to_amount,
    to_currency,
    rate: to_amount / from_amount,
    min_amount: 1,
    max_amount: 50000
  })

  it('shows what a purchase gives and its price in the currency paid', async () => {
    expect.assertions(2)

    const { client, fetchImpl } = clientFor({ '/api/v1/exchange/convert/': converted('USDT', 100, 'BTC', 0.001) })
    const output = await run(client, 'quote', ['USDT', 'BTC', '100'])

    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toStrictEqual({
      from_amount: 100,
      from_currency: 'USDT',
      to_currency: 'BTC'
    })
    expect(output.split('\n')[1]).toBe('100 USDT  0.001 BTC  100000 USDT/BTC')
  })

  it('prices a sale in USDT per unit sold', async () => {
    expect.assertions(1)

    const { client } = clientFor({ '/api/v1/exchange/convert/': converted('BTC', 0.002, 'USDT', 200) })

    expect((await run(client, 'quote', ['BTC', 'USDT', '0.002'])).split('\n')[1]).toBe(
      '0.002 BTC  200 USDT  100000 USDT/BTC'
    )
  })

  it('cuts decimals the api rejects and says so', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const { from_amount } = JSON.parse(String(init?.body)) as { from_amount: number }
      return from_amount === 6.084524
        ? jsonResponse(converted('TQQQx', 6.084524, 'USDT', 315.66))
        : jsonResponse({ code: 'invalid_amount' }, 400)
    })
    const client = new WaltClient({ tokenProvider: async () => 'jwt.token.value', fetch: fetchImpl })
    const lines = (await run(client, 'quote', ['TQQQx', 'USDT', '6.08452414'])).split('\n')

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(lines[1]).toBe('6.084524 TQQQx  315.66 USDT  51.879161 USDT/TQQQx')
    expect(lines[2]).toBe('amount cut to 6.084524 TQQQx, the most decimals it accepts')
  })

  it('gives up when no precision is accepted', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ code: 'invalid_amount' }, 400))
    const client = new WaltClient({ tokenProvider: async () => 'jwt.token.value', fetch: fetchImpl })

    await expect(run(client, 'quote', ['TQQQx', 'USDT', '1.5'])).rejects.toThrow('failed (400)')
    expect(fetchImpl.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).from_amount)).toStrictEqual([1.5, 1])
  })

  it('does not retry other errors', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ code: 'market_order_max_limit_error' }, 400))
    const client = new WaltClient({ tokenProvider: async () => 'jwt.token.value', fetch: fetchImpl })

    await expect(run(client, 'quote', ['USDT', 'BTC', '9999999.5'])).rejects.toThrow('failed (400)')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([[[]], [['USDT', 'BTC']], [['USDT', 'BTC', '-1']], [['USDT', 'BTC', '1e3']], [['USDT', 'BTC', '0']]])(
    'rejects %o',
    async (args) => {
      expect.assertions(1)

      await expect(run(clientFor({}).client, 'quote', args)).rejects.toThrow(UsageError)
    }
  )
})

describe('orders', () => {
  const order = {
    created_at: '2026-01-02T03:04:05Z',
    base_currency: 'BTC',
    side: 'BUY',
    price_limit: '50000',
    quantity: '0.001',
    total: '50',
    fee_currency: 'USDT',
    fee: '0.3',
    status: 'OPEN'
  }

  it('lists open orders and the USDT they hold', async () => {
    expect.assertions(3)

    const { client, fetchImpl } = clientFor({ '/emporos/public-api/orders/limit': { items: [order] } })
    const lines = (await run(client, 'orders', [])).split('\n')

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('status=OPEN&status=CANCELLING&limit=100')
    expect(lines[1]).toBe('2026-01-02 03:04  BTC    BUY   50000     0.001  50 USDT  0.3  OPEN')
    expect(lines[2]).toBe('50.00 held by open orders')
  })

  it('lists every order with --all', async () => {
    expect.assertions(1)

    const { client, fetchImpl } = clientFor({ '/emporos/public-api/orders/limit': { items: [] } })
    await run(client, 'orders', [], { all: true })

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://walletbot.me/emporos/public-api/orders/limit?limit=100')
  })
})

describe('perps', () => {
  const position = {
    contract_name: 'BTC-USDC',
    side: 'long',
    leverage: 10,
    value_base: '0.01',
    avg_entry_price: '50000',
    margin_quote: '50',
    liquidation_price: '45000',
    created_at: '2026-01-02T03:04:05Z',
    updated_at: '2026-01-03T03:04:05Z',
    valuation: { mark_price: '51000', unrealized_pnl_quote: '10' }
  }

  it('shows open positions with mark, liquidation and unrealised P/L', async () => {
    expect.assertions(2)

    const { client, fetchImpl } = clientFor({ '/perps/public-api/v1/positions/': { positions: [position] } })
    const lines = (await run(client, 'perps', [])).split('\n')

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('statuses=open')
    expect(lines[0]).toBe('CONTRACT  SIDE  LEV  SIZE  ENTRY  MARGIN   MARK  LIQUIDATION  UNREALISED')
  })

  it('shows closed positions with their dates and no valuation', async () => {
    expect.assertions(2)

    const { client, fetchImpl } = clientFor({ '/perps/public-api/v1/positions/': { positions: [position] } })
    const lines = (await run(client, 'perps', [], { closed: true })).split('\n')

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('statuses=closed')
    expect(lines[1]).toBe('BTC-USDC  long  10x  0.01  50000   50.00  2026-01-02 03:04  2026-01-03 03:04')
  })

  it('says when there is nothing to show', async () => {
    expect.assertions(1)

    const { client } = clientFor({ '/perps/public-api/v1/positions/': { positions: [] } })

    expect(await run(client, 'perps', [])).toBe('nothing to show')
  })
})

describe('earn', () => {
  const campaign = (name: string, status: string, balance: string | null) => ({
    name,
    status,
    current_apy: '0.05',
    deposit_currency: 'TON',
    account: balance === null ? null : { currency: 'TON', balance, paid_out_amount: '1.123456789012' }
  })
  const routes = {
    '/earn/public-api/v1/campaigns/': {
      campaigns: [
        campaign('Staked', 'active', '10'),
        campaign('Open', 'active', null),
        campaign('Old', 'finished', '0')
      ]
    }
  }

  it('shows only campaigns holding a stake', async () => {
    expect.assertions(1)

    expect((await run(clientFor(routes).client, 'earn', [])).split('\n')).toStrictEqual([
      'CAMPAIGN  ASSET  STAKED    PAID OUT    APY  STATUS',
      'Staked    TON        10  1.12345679  5.00%  active'
    ])
  })

  it('shows every active campaign with --all', async () => {
    expect.assertions(1)

    const rows = JSON.parse(await run(clientFor(routes).client, 'earn', [], { all: true, json: true })) as {
      campaign: string
    }[]

    expect(rows.map((row) => row.campaign)).toStrictEqual(['Staked', 'Open'])
  })
})

describe('run', () => {
  it('rejects an unknown command', async () => {
    expect.assertions(1)

    await expect(run(clientFor({}).client, 'trade', [])).rejects.toThrow('unknown command: trade')
  })
})
