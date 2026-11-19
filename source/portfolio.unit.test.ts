import { describe, expect, it, vi } from 'vitest'
import { WaltClient } from '~/client.ts'
import { portfolio } from '~/portfolio.ts'
import { WaltError } from '~/transport.ts'

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

describe('portfolio', () => {
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

    const { entries, total, fiatCurrency } = await portfolio(makeClient(fetchImpl))

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

    const { entriesTotal, total, staked } = await portfolio(makeClient(fetchImpl))

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

    const { entriesTotal, staked } = await portfolio(makeClient(fetchImpl))

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

    const { entriesTotal } = await portfolio(makeClient(fetchImpl))
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

    const { entries, total } = await portfolio(makeClient(fetchImpl))

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

    await expect(portfolio(makeClient(fetchImpl))).rejects.toThrow('TON has no candle price')
  })

  it('rejects a portfolio total that is not a number', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ available_balance_total_fiat_currency: 'USD', accounts: [] })
    )

    await expect(portfolio(makeClient(fetchImpl))).rejects.toThrow('total is not a number')
  })

  it('throws a named WaltError for a response it cannot use', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: null }))
    const failure = portfolio(makeClient(fetchImpl))

    await expect(failure).rejects.toThrow(WaltError)
    await expect(failure).rejects.toHaveProperty('name', 'WaltError')
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

    await expect(portfolio(makeClient(fetchImpl))).rejects.toThrow('TON balance is not a number')
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

    await expect(portfolio(makeClient(fetchImpl))).rejects.toThrow('TON fiat value is not a number')
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
    const { entries } = await portfolio(makeClient(fetchImpl))

    expect(entries.map((entry) => entry.currency)).toStrictEqual(['TON'])
  })
})
