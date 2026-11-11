import type { FiatCurrency } from '~/api/accounts.ts'
import type { ExchangeQuote } from '~/api/exchange.ts'
import type { WaltClient } from '~/client.ts'
import { WaltRequestError } from '~/transport.ts'

type Column = { key: string; title: string; numeric?: boolean }
type Row = Record<string, string>
type Report = { columns: Column[]; rows: Row[]; footer?: string[] }

export type CliOptions = {
  json?: boolean
  fiat?: string
  asset?: string
  limit?: string
  from?: string
  monthly?: boolean
  all?: boolean
  closed?: boolean
}

export class UsageError extends Error {}

export const COMMANDS = `Commands:
  balances [--all]          every asset: spot, staked and held by limit orders,
                            and with --all the ones worth less than 0.01
  history [--monthly]       balance, deposits, withdrawals and P/L per day or month
          [--from DATE]     start date, YYYY-MM-DD (default: 30 days or 12 months back)
  transactions              latest transactions
          [--asset SYM]     only this asset
          [--limit N]       how many (default 20)
  price SYM...              current price and change over 24h, 7d and 30d
  quote FROM TO AMOUNT      what an exchange would give right now, without making it
  orders [--all]            open limit orders, or every order with --all
  perps [--closed]          open perpetual positions, or closed ones
  earn [--all]              your earn stakes, or every active campaign with --all`

const fixed = (value: string | number | null | undefined, digits = 2): string => {
  const parsed = Number(value)
  return value === null || value === undefined || value === '' || !Number.isFinite(parsed)
    ? '-'
    : parsed.toFixed(digits)
}

const trimmed = (value: string | null | undefined): string => {
  const parsed = Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(parsed)) return '-'
  return String(Number(parsed.toFixed(8)))
}

const significant = (value: number): string => (Number.isFinite(value) ? String(Number(value.toPrecision(8))) : '-')

const percent = (value: number): string =>
  Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%` : '-'

const change = (now: number, then: number | undefined): string =>
  then === undefined || then === 0 ? '-' : percent(now / then - 1)

const minute = (timestamp: string): string => timestamp.slice(0, 16).replace('T', ' ')

const isoDate = (date: Date): string => date.toISOString().slice(0, 10)

const ACCOUNT_KINDS: Record<string, string> = { REGULAR: 'spot', EARN_V2: 'earn', HOLD_LIMIT: 'orders' }

const positiveInteger = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new UsageError(`--limit must be a whole number, got ${value}`)
  return parsed
}

const balances = async (client: WaltClient, fiat: string, options: CliOptions): Promise<Report> => {
  const data = await client.balances(fiat as FiatCurrency)
  const total = Number(data.overall_available_balance_fiat_amount)
  const held = data.accounts
    .filter((account) => Number(account.total_balance) > 0)
    .map((account) => ({ account, value: Number(account.available_balance_fiat_amount) }))
  const shown = options.all ? held : held.filter(({ value }) => !(value < 0.005))
  const rows = shown
    .sort((a, b) => b.value - a.value)
    .map(({ account, value }) => ({
      asset: account.currency,
      kind: ACCOUNT_KINDS[account.account_type] ?? account.account_type.toLowerCase(),
      amount: trimmed(account.total_balance),
      value: value.toFixed(2),
      share: total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '-'
    }))
  return {
    columns: [
      { key: 'asset', title: 'ASSET' },
      { key: 'kind', title: 'KIND' },
      { key: 'amount', title: 'AMOUNT', numeric: true },
      { key: 'value', title: `VALUE ${data.fiat_currency}`, numeric: true },
      { key: 'share', title: 'SHARE', numeric: true }
    ],
    rows,
    footer: [
      `total ${total.toFixed(2)} ${data.fiat_currency}`,
      ...(shown.length < held.length
        ? [`${held.length - shown.length} worth less than 0.01 not shown, --all lists them`]
        : [])
    ]
  }
}

const history = async (client: WaltClient, options: CliOptions): Promise<Report> => {
  const start = new Date()
  if (options.monthly) start.setUTCMonth(start.getUTCMonth() - 11, 1)
  else start.setUTCDate(start.getUTCDate() - 29)
  const from = options.from ?? isoDate(start)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new UsageError(`--from must be YYYY-MM-DD, got ${from}`)
  const data = await client.portfolioHistory(from, options.monthly ? '1m' : '1d')
  const period = (dateFrom: string): string => (options.monthly ? dateFrom.slice(0, 7) : dateFrom.slice(0, 10))
  const rows = data.chart.data_points.map((point) => ({
    period: period(point.date_from),
    balance: fixed(point.close_amount_fiat),
    deposits: fixed(point.deposits_details.total),
    withdrawals: fixed(point.withdrawals_details.total),
    pnl: fixed(point.total_pnl),
    pnlPercent: point.total_pnl_percent === null ? '-' : `${fixed(point.total_pnl_percent)}%`
  }))
  const total = data.total_period_details
  return {
    columns: [
      { key: 'period', title: options.monthly ? 'MONTH' : 'DAY' },
      { key: 'balance', title: `BALANCE ${data.fiat_currency}`, numeric: true },
      { key: 'deposits', title: 'DEPOSITS', numeric: true },
      { key: 'withdrawals', title: 'WITHDRAWALS', numeric: true },
      { key: 'pnl', title: 'P/L', numeric: true },
      { key: 'pnlPercent', title: 'P/L %', numeric: true }
    ],
    rows,
    footer: [
      `since ${from}: P/L ${fixed(total.total_pnl)} ${data.fiat_currency}` +
        (total.total_pnl_percent === null ? '' : ` (${fixed(total.total_pnl_percent)}%)`) +
        `, deposits ${fixed(total.deposits_details.total)}, withdrawals ${fixed(total.withdrawals_details.total)}`,
      'as reported by Walt'
    ]
  }
}

const transactions = async (client: WaltClient, options: CliOptions): Promise<Report> => {
  const limit = positiveInteger(options.limit, 20)
  const page = options.asset ? await client.accountTransactions(options.asset, limit) : await client.transactions(limit)
  return {
    columns: [
      { key: 'time', title: 'TIME (UTC)' },
      { key: 'type', title: 'TYPE' },
      { key: 'gateway', title: 'VIA' },
      { key: 'amount', title: 'AMOUNT', numeric: true },
      { key: 'asset', title: 'ASSET' },
      { key: 'status', title: 'STATUS' }
    ],
    rows: page.transactions.map((row) => ({
      time: minute(row.created_at),
      type: row.type,
      gateway: row.gateway,
      amount: trimmed(row.amount),
      asset: row.currency,
      status: row.status
    }))
  }
}

const price = async (client: WaltClient, symbols: string[], fiat: string): Promise<Report> => {
  if (symbols.length === 0) throw new UsageError('price needs at least one symbol, such as `walt price BTC`')
  const rows = await Promise.all(
    symbols.map(async (symbol) => {
      const charts = await client.charts(symbol, fiat as FiatCurrency)
      const rates = (points: { rate: string }[]) => points.map((point) => Number(point.rate))
      const day = rates(charts.day)
      const last = day.at(-1) ?? rates(charts.month).at(-1)
      if (last === undefined) return { asset: symbol, price: '-', day: '-', week: '-', month: '-' }
      return {
        asset: symbol,
        price: significant(last),
        day: change(last, day[0]),
        week: change(last, rates(charts.week)[0]),
        month: change(last, rates(charts.month)[0])
      }
    })
  )
  return {
    columns: [
      { key: 'asset', title: 'ASSET' },
      { key: 'price', title: `PRICE ${fiat}`, numeric: true },
      { key: 'day', title: '24H', numeric: true },
      { key: 'week', title: '7D', numeric: true },
      { key: 'month', title: '30D', numeric: true }
    ],
    rows
  }
}

const quoteSizes = (amount: string): string[] => {
  const [whole = '', fraction = ''] = amount.split('.')
  const sizes = [
    amount,
    ...[6, 4, 2, 0]
      .filter((places) => places < fraction.length)
      .map((places) => (places === 0 ? whole : `${whole}.${fraction.slice(0, places)}`))
  ]
  return [...new Set(sizes)].filter((size) => Number(size) > 0)
}

const quote = async (client: WaltClient, args: string[]): Promise<Report> => {
  const [from, to, amount] = args
  if (!from || !to || amount === undefined || !/^\d+(\.\d+)?$/.test(amount) || !(Number(amount) > 0)) {
    throw new UsageError('usage: walt quote FROM TO AMOUNT, such as `walt quote USDT BTC 100`')
  }
  let result: ExchangeQuote | undefined
  let size = amount
  let rejection: unknown
  for (const candidate of quoteSizes(amount)) {
    try {
      result = await client.quote(from, to, Number(candidate))
      size = candidate
      break
    } catch (error) {
      if (
        !(error instanceof WaltRequestError) ||
        (error.body as { code?: unknown } | null)?.code !== 'invalid_amount'
      ) {
        throw error
      }
      rejection = error
    }
  }
  if (result === undefined) throw rejection
  const sale = result.to_currency === 'USDT' && result.from_currency !== 'USDT'
  const price =
    result.from_amount <= 0 || result.to_amount <= 0
      ? '-'
      : sale
        ? `${significant(result.to_amount / result.from_amount)} USDT/${result.from_currency}`
        : `${significant(result.from_amount / result.to_amount)} ${result.from_currency}/${result.to_currency}`
  const footer = [
    `order size ${result.min_amount} to ${result.max_amount} ${from}`,
    'fees included, nothing was exchanged'
  ]
  if (size !== amount) footer.unshift(`amount cut to ${size} ${from}, the most decimals it accepts`)
  return {
    columns: [
      { key: 'pay', title: 'PAY', numeric: true },
      { key: 'receive', title: 'RECEIVE', numeric: true },
      { key: 'price', title: 'PRICE', numeric: true }
    ],
    rows: [
      {
        pay: `${result.from_amount} ${result.from_currency}`,
        receive: `${result.to_amount} ${result.to_currency}`,
        price
      }
    ],
    footer
  }
}

const orders = async (client: WaltClient, options: CliOptions): Promise<Report> => {
  const list = await client.limitOrders(options.all ? { limit: 100 } : { status: ['OPEN', 'CANCELLING'], limit: 100 })
  const held = list.filter((order) => order.status === 'OPEN').reduce((sum, order) => sum + Number(order.total), 0)
  return {
    columns: [
      { key: 'created', title: 'CREATED (UTC)' },
      { key: 'asset', title: 'ASSET' },
      { key: 'side', title: 'SIDE' },
      { key: 'limit', title: 'LIMIT', numeric: true },
      { key: 'quantity', title: 'QUANTITY', numeric: true },
      { key: 'total', title: 'TOTAL', numeric: true },
      { key: 'fee', title: 'FEE', numeric: true },
      { key: 'status', title: 'STATUS' }
    ],
    rows: list.map((order) => ({
      created: minute(order.created_at),
      asset: order.base_currency,
      side: order.side,
      limit: order.price_limit,
      quantity: order.quantity,
      total: `${order.total} ${order.fee_currency}`,
      fee: order.fee,
      status: order.status
    })),
    footer: [`${held.toFixed(2)} USDT held by open orders`]
  }
}

const perps = async (client: WaltClient, options: CliOptions): Promise<Report> => {
  const positions = await client.perpPositions({ statuses: [options.closed ? 'closed' : 'open'] })
  const columns: Column[] = [
    { key: 'contract', title: 'CONTRACT' },
    { key: 'side', title: 'SIDE' },
    { key: 'leverage', title: 'LEV', numeric: true },
    { key: 'size', title: 'SIZE', numeric: true },
    { key: 'entry', title: 'ENTRY', numeric: true },
    { key: 'margin', title: 'MARGIN', numeric: true }
  ]
  if (options.closed) {
    columns.push({ key: 'opened', title: 'OPENED (UTC)' }, { key: 'closed', title: 'CLOSED (UTC)' })
  } else {
    columns.push(
      { key: 'mark', title: 'MARK', numeric: true },
      { key: 'liquidation', title: 'LIQUIDATION', numeric: true },
      { key: 'pnl', title: 'UNREALISED', numeric: true }
    )
  }
  return {
    columns,
    rows: positions.map((position) => ({
      contract: position.contract_name,
      side: position.side,
      leverage: `${position.leverage}x`,
      size: trimmed(position.value_base),
      entry: significant(Number(position.avg_entry_price)),
      margin: fixed(position.margin_quote),
      opened: minute(position.created_at),
      closed: minute(position.updated_at),
      mark: significant(Number(position.valuation.mark_price)),
      liquidation: significant(Number(position.liquidation_price)),
      pnl: fixed(position.valuation.unrealized_pnl_quote)
    }))
  }
}

const earn = async (client: WaltClient, options: CliOptions): Promise<Report> => {
  const { campaigns } = await client.earnCampaigns()
  const shown = campaigns.filter((campaign) =>
    options.all ? campaign.status === 'active' : campaign.account !== null && Number(campaign.account.balance) > 0
  )
  return {
    columns: [
      { key: 'campaign', title: 'CAMPAIGN' },
      { key: 'asset', title: 'ASSET' },
      { key: 'staked', title: 'STAKED', numeric: true },
      { key: 'paid', title: 'PAID OUT', numeric: true },
      { key: 'apy', title: 'APY', numeric: true },
      { key: 'status', title: 'STATUS' }
    ],
    rows: shown.map((campaign) => ({
      campaign: campaign.name,
      asset: campaign.account?.currency ?? campaign.deposit_currency,
      staked: trimmed(campaign.account?.balance),
      paid: trimmed(campaign.account?.paid_out_amount),
      apy: `${fixed(Number(campaign.current_apy) * 100)}%`,
      status: campaign.status
    }))
  }
}

const render = (report: Report): string => {
  if (report.rows.length === 0) return ['nothing to show', ...(report.footer ?? [])].join('\n')
  const widths = report.columns.map((column) =>
    Math.max(column.title.length, ...report.rows.map((row) => (row[column.key] ?? '').length))
  )
  const line = (cells: string[]) =>
    cells
      .map((cell, index) => {
        const width = widths[index] ?? 0
        return report.columns[index]?.numeric ? cell.padStart(width) : cell.padEnd(width)
      })
      .join('  ')
      .trimEnd()
  return [
    line(report.columns.map((column) => column.title)),
    ...report.rows.map((row) => line(report.columns.map((column) => row[column.key] ?? ''))),
    ...(report.footer ?? [])
  ].join('\n')
}

/**
 * Runs one read-only command and returns what to print.
 *
 * @param client - A signed-in client.
 * @param command - The command name, such as `balances`.
 * @param args - Positional arguments after the command.
 * @param options - Parsed flags.
 */
export const run = async (
  client: WaltClient,
  command: string,
  args: string[],
  options: CliOptions = {}
): Promise<string> => {
  const fiat = (options.fiat ?? 'USD').toUpperCase()
  let report: Report
  switch (command) {
    case 'balances':
      report = await balances(client, fiat, options)
      break
    case 'history':
      report = await history(client, options)
      break
    case 'transactions':
      report = await transactions(client, options)
      break
    case 'price':
      report = await price(client, args, fiat)
      break
    case 'quote':
      report = await quote(client, args)
      break
    case 'orders':
      report = await orders(client, options)
      break
    case 'perps':
      report = await perps(client, options)
      break
    case 'earn':
      report = await earn(client, options)
      break
    default:
      throw new UsageError(`unknown command: ${command}`)
  }
  if (!options.json) return render(report)
  return JSON.stringify(
    report.rows.map((row) => Object.fromEntries(report.columns.map((column) => [column.key, row[column.key] ?? null]))),
    null,
    2
  )
}
