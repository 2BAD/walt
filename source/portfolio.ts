import type { WaltClient } from '~/client.ts'
import { WaltError } from '~/transport.ts'

const CANDLE_BATCH_SIZE = 20

const decimal = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export type PortfolioEntry = {
  currency: string
  amount: string
  fiatValue: number
}

export type Portfolio = {
  /** Spot balances above zero, largest fiat value first. */
  entries: PortfolioEntry[]
  entriesTotal: number
  /** `entriesTotal + staked`. */
  total: number
  /** What the API total counts beyond spot balances, itemised by `earnCampaigns()`. */
  staked: number
  fiatCurrency: string
}

/**
 * Non-zero spot balances and the total, which also counts staked funds.
 * A USD account is priced at the latest candle close, any other at the rates `accounts()` reports.
 *
 * @param client - A signed-in client.
 */
export const portfolio = async (client: WaltClient): Promise<Portfolio> => {
  const data = await client.accounts()
  if (!Array.isArray(data.accounts)) {
    throw new WaltError('accounts response carries no accounts array')
  }
  const accountsTotal = decimal(data.available_balance_total_fiat_amount)
  if (accountsTotal === null) {
    throw new WaltError(`accounts total is not a number: ${String(data.available_balance_total_fiat_amount)}`)
  }

  const entries: PortfolioEntry[] = []
  for (const account of data.accounts) {
    const balance = decimal(account.available_balance)
    if (balance === null) {
      throw new WaltError(`${account.currency} balance is not a number: ${String(account.available_balance)}`)
    }
    if (balance <= 0) continue
    const fiatValue = decimal(account.available_balance_fiat_amount)
    if (fiatValue === null) {
      throw new WaltError(
        `${account.currency} fiat value is not a number: ${String(account.available_balance_fiat_amount)}`
      )
    }
    entries.push({ currency: account.currency, amount: account.available_balance, fiatValue })
  }
  const staked = accountsTotal - entries.reduce((sum, entry) => sum + entry.fiatValue, 0)

  if (data.available_balance_total_fiat_currency === 'USD') {
    const requests = entries.map((entry) => ({ ticker: `${entry.currency}/USD/SPOT`, resolution: '1m', limit: 1 }))
    const batches = Array.from({ length: Math.ceil(requests.length / CANDLE_BATCH_SIZE) }, (_, index) =>
      requests.slice(index * CANDLE_BATCH_SIZE, (index + 1) * CANDLE_BATCH_SIZE)
    )
    const series = (await Promise.all(batches.map((batch) => client.candles(batch)))).flat()
    const closes = new Map(series.map((item) => [item.ticker, decimal(item.candles.at(-1)?.c)]))
    for (const entry of entries) {
      const close = closes.get(`${entry.currency}/USD/SPOT`) ?? null
      if (close === null) throw new WaltError(`${entry.currency} has no candle price`)
      entry.fiatValue = Number(entry.amount) * close
    }
  }

  const entriesTotal = entries.reduce((sum, entry) => sum + entry.fiatValue, 0)

  return {
    entries: entries.sort((a, b) => b.fiatValue - a.fiatValue),
    entriesTotal,
    total: entriesTotal + staked,
    staked,
    fiatCurrency: data.available_balance_total_fiat_currency
  }
}
