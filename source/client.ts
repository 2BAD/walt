import type { AccountsResponse, Charts, Coin, CoinDetails, FiatCurrency, PriceAtTime } from '~/api/accounts.ts'
import type { PnlResponse, PortfolioHistory } from '~/api/analytics.ts'
import type { Balances } from '~/api/balances.ts'
import type { CandleRequest, CandleSeries } from '~/api/candles.ts'
import type { EarnCampaignsResponse, EarnRate, EarnTransaction, EarnTransactionsPage } from '~/api/earn.ts'
import type { AvailableExchanges, Exchange, ExchangeQuote, ExchangeRequest } from '~/api/exchange.ts'
import type { Ipo, IpoDetails } from '~/api/ipo.ts'
import type {
  LimitOrder,
  LimitOrderBounds,
  LimitOrderQuote,
  LimitOrdersPage,
  LimitOrderToken
} from '~/api/limit-orders.ts'
import type {
  PerpContract,
  PerpOrder,
  PerpOrdersPage,
  PerpOrderStatus,
  PerpPosition,
  PerpPositionStatus,
  PerpSystemStatus
} from '~/api/perps.ts'
import type { Transaction, TransactionDetails, TransactionGateway, TransactionsPage } from '~/api/transactions.ts'
import { Transport, WaltAuthError } from '~/transport.ts'

const BASE_URL = 'https://walletbot.me'
const CANDLE_BATCH_SIZE = 20
const TRANSACTIONS_PAGE_SIZE = 1000
const EARN_PAGE_SIZE = 1000
const LIMIT_ORDERS_PAGE_SIZE = 100
const PERP_ORDERS_PAGE_SIZE = 100

const calendarDate = (date: Date): string =>
  [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-')

const decimal = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export type WaltClientOptions = {
  /** Called again with the rejected token after a 401, so the provider can renew it before its expiry. */
  tokenProvider: (rejected?: string) => Promise<string>
  baseUrl?: string
  fetch?: typeof fetch
  /** Extra attempts after a request fails on a transient status. Default 3, `0` disables retrying. */
  retries?: number
  /** Base for the exponential backoff between those attempts, in ms. Default 500. */
  retryDelayMs?: number
  /** Requests allowed in flight at once. Default 4, `Infinity` removes the limit. */
  maxConcurrent?: number
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

export class WaltClient {
  private readonly transport: Transport

  constructor(options: WaltClientOptions) {
    if (!options.tokenProvider) {
      throw new WaltAuthError('tokenProvider is required')
    }
    const retries = options.retries ?? 3
    const maxConcurrent = options.maxConcurrent ?? 4
    if (!(maxConcurrent >= 1)) {
      throw new RangeError(`maxConcurrent must be at least 1, got ${maxConcurrent}`)
    }
    if (!Number.isInteger(retries) || retries < 0) {
      throw new RangeError(`retries must be a whole number of at least 0, got ${retries}`)
    }
    this.transport = new Transport({
      tokenProvider: options.tokenProvider,
      baseUrl: options.baseUrl ?? BASE_URL,
      fetch: options.fetch ?? fetch,
      retries,
      retryDelayMs: options.retryDelayMs ?? 500,
      maxConcurrent
    })
  }

  accounts(): Promise<AccountsResponse> {
    return this.transport.get<AccountsResponse>('/api/v1/accounts/')
  }

  /**
   * Every balance with its account type, including what open limit and take-profit orders hold,
   * which `accounts()` omits.
   *
   * @param fiatCurrency - Currency of the fiat amounts and the overall total.
   */
  async balances(fiatCurrency: FiatCurrency): Promise<Balances> {
    const query = new URLSearchParams({ fiat_currency: fiatCurrency })
    const { data } = await this.transport.get<{ data: Balances }>(
      `/portmone/public-api/v1/user/accounts?${query.toString()}`
    )
    return data
  }

  async coins(fiatCurrency: FiatCurrency): Promise<Coin[]> {
    const { coins } = await this.transport.get<{ coins: Coin[] }>(`/api/v1/coins/list/${fiatCurrency}/`)
    return coins
  }

  async localCurrency(): Promise<FiatCurrency> {
    const { local_currency } = await this.transport.get<{ local_currency: FiatCurrency }>(
      '/api/v1/currencies/local_currency/'
    )
    return local_currency
  }

  /**
   * Every transaction, newest first.
   *
   * @param options - Filters, all optional.
   * @param options.currency - Only transactions in this currency.
   */
  transactions(options: { currency?: string } = {}): Promise<Transaction[]> {
    const { currency } = options
    const path = currency === undefined ? '/api/v1/transactions/' : '/api/v1/transactions/single-account/'
    return this.paged<TransactionsPage, Transaction>(
      (previous) => {
        const query = new URLSearchParams(currency === undefined ? {} : { crypto_currency: currency })
        query.set('limit', String(TRANSACTIONS_PAGE_SIZE))
        if (previous?.next_cursor != null) query.set('cursor', previous.next_cursor)
        return this.transport.get<TransactionsPage>(`${path}?${query.toString()}`)
      },
      (page) => page.transactions,
      (page) => page.next_cursor
    )
  }

  private async paged<Page, Item>(
    fetchPage: (previous?: Page) => Promise<Page>,
    itemsOf: (page: Page) => Item[],
    cursorOf: (page: Page) => string | null
  ): Promise<Item[]> {
    const items: Item[] = []
    const seen = new Set<string>()
    let previous: Page | undefined
    for (;;) {
      const page = await fetchPage(previous)
      const pageItems = itemsOf(page)
      if (pageItems.length === 0) return items
      items.push(...pageItems)
      const cursor = cursorOf(page)
      if (cursor === null) return items
      if (seen.has(cursor)) throw new Error('pagination returned a cursor twice')
      seen.add(cursor)
      previous = page
    }
  }

  /**
   * `transactionDetails()` for each listing row, in the same order. Lookups run concurrently up to `maxConcurrent`.
   *
   * @param transactions - Listing rows, typically from `transactions()`.
   */
  detailsFor(transactions: Transaction[]): Promise<TransactionDetails[]> {
    return Promise.all(transactions.map((row) => this.transactionDetails(row.id, row.gateway)))
  }

  /**
   * @param id - Transaction id from a listing row.
   * @param gateway - The row's `gateway`. Some records, such as `xstocks_dividends`, 404 without it.
   */
  transactionDetails(id: number | string, gateway?: TransactionGateway | (string & {})): Promise<TransactionDetails> {
    const query = gateway ? `?${new URLSearchParams({ transaction_gateway: gateway }).toString()}` : ''
    return this.transport.get<TransactionDetails>(
      `/api/v1/transactions/details/${encodeURIComponent(String(id))}/${query}`
    )
  }

  async unconfirmedTransactions<T = unknown>(): Promise<T[]> {
    const query = new URLSearchParams({ limit: String(TRANSACTIONS_PAGE_SIZE) })
    const { transactions } = await this.transport.get<{ transactions: T[] }>(
      `/api/v1/transactions/unconfirmed/?${query.toString()}`
    )
    return transactions
  }

  frozenBalances<T = unknown>(): Promise<T[]> {
    return this.transport.get<T[]>('/api/v1/accounts/frozen')
  }

  /** Every earn campaign. Staked balances are here, not in `accounts()`. */
  earnCampaigns(): Promise<EarnCampaignsResponse> {
    return this.transport.get<EarnCampaignsResponse>('/earn/public-api/v1/campaigns/')
  }

  /**
   * Deposits, withdrawals and payouts within one campaign, newest first.
   *
   * @param campaignId - `campaign_id` from `earnCampaigns()`.
   */
  earnCampaignTransactions(campaignId: number): Promise<EarnTransaction[]> {
    const path = `/earn/public-api/v1/campaigns/${encodeURIComponent(String(campaignId))}/transactions`
    return this.paged<EarnTransactionsPage, EarnTransaction>(
      (previous) => {
        const query = new URLSearchParams({ limit: String(EARN_PAGE_SIZE), merge_with_transfer_requests: 'true' })
        if (previous?.deposit_acc_next_from != null) {
          query.set('deposit_acc_offset_id', String(previous.deposit_acc_next_from))
        }
        if (previous?.payout_acc_next_from != null) {
          query.set('payout_acc_offset_id', String(previous.payout_acc_next_from))
        }
        if (previous?.transfer_request_next_before_datetime != null) {
          query.set('transfer_request_before_datetime', previous.transfer_request_next_before_datetime)
        }
        return this.transport.get<EarnTransactionsPage>(`${path}?${query.toString()}`)
      },
      (page) => page.transactions,
      (page) =>
        page.transactions.length < EARN_PAGE_SIZE
          ? null
          : [page.deposit_acc_next_from, page.payout_acc_next_from, page.transfer_request_next_before_datetime].join(
              '|'
            )
    )
  }

  earnRate(from: string, to: string): Promise<EarnRate> {
    return this.transport.get<EarnRate>(
      `/earn/public-api/v1/rate/${encodeURIComponent(from)}/${encodeURIComponent(to)}`
    )
  }

  pnl(): Promise<PnlResponse> {
    return this.transport.get<PnlResponse>('/customer-analytics/public-api/v1/pnl/assets/')
  }

  /**
   * Balance, P/L, deposits and withdrawals per day or per calendar month, plus totals for the whole range.
   *
   * @param dateFrom - Start of the first period, as a `Date` or `YYYY-MM-DD`. A `Date` counts by its UTC day.
   * @param resolution - `1d` for days, `1m` for months.
   */
  portfolioHistory(dateFrom: Date | string, resolution: '1d' | '1m'): Promise<PortfolioHistory> {
    const query = new URLSearchParams({
      date_from: dateFrom instanceof Date ? calendarDate(dateFrom) : dateFrom,
      resolution
    })
    return this.transport.get<PortfolioHistory>(
      `/customer-analytics/public-api/v1/portfolio/private/?${query.toString()}`
    )
  }

  /**
   * Every limit, take-profit and stop-loss order, newest first.
   *
   * @param options - Filters, all optional.
   * @param options.statuses - Only orders in these states, such as `OPEN`.
   */
  limitOrders(options: { statuses?: string[] } = {}): Promise<LimitOrder[]> {
    return this.paged<LimitOrdersPage, LimitOrder>(
      (previous) => {
        const query = new URLSearchParams()
        for (const status of options.statuses ?? []) query.append('status', status)
        query.set('limit', String(LIMIT_ORDERS_PAGE_SIZE))
        if (previous?.next_cursor !== undefined) query.set('cursor', previous.next_cursor)
        return this.transport.get<LimitOrdersPage>(`/emporos/public-api/orders/limit?${query.toString()}`)
      },
      (page) => page.items,
      (page) => page.next_cursor ?? null
    )
  }

  limitOrder(id: string): Promise<LimitOrder> {
    const query = new URLSearchParams({ id })
    return this.transport.get<LimitOrder>(`/emporos/public-api/orders/limit/by-id?${query.toString()}`)
  }

  /**
   * Fee and fill for a limit order, without placing it. Only `BUY` is accepted.
   *
   * @param baseCurrency - What is bought, from `limitOrderTokens()`.
   * @param side - `SELL` is a valid value that the API currently rejects.
   * @param priceLimit - Highest price to pay per unit.
   * @param size - `amount` to spend, or `quantity` of `baseCurrency` to receive.
   */
  limitOrderQuote(
    baseCurrency: string,
    side: 'BUY' | 'SELL',
    priceLimit: number | string,
    size: { amount: number | string } | { quantity: number | string }
  ): Promise<LimitOrderQuote> {
    const query = new URLSearchParams({ base_currency: baseCurrency, side, price_limit: String(priceLimit) })
    if ('amount' in size) query.set('amount', String(size.amount))
    else query.set('quantity', String(size.quantity))
    return this.transport.get<LimitOrderQuote>(`/emporos/public-api/orders/limit/quote?${query.toString()}`)
  }

  limitOrderBounds(baseCurrency: string): Promise<LimitOrderBounds> {
    const query = new URLSearchParams({ base_currency: baseCurrency })
    return this.transport.get<LimitOrderBounds>(`/emporos/public-api/orders/limit/bounds?${query.toString()}`)
  }

  /** Every currency a limit order can buy. */
  async limitOrderTokens(): Promise<LimitOrderToken[]> {
    const { tokens } = await this.transport.get<{ tokens: LimitOrderToken[] }>(
      '/emporos/public-api/orders/limit/tokens'
    )
    return tokens
  }

  /** Every IPO the app lists, with your order in each. Past IPOs are not listed. */
  async ipos(): Promise<Ipo[]> {
    const { ipos } = await this.transport.get<{ ipos: Ipo[] }>('/api/v1/ipo/info/list/')
    return ipos
  }

  /** @param id - `id` from `ipos()`. */
  ipo(id: number): Promise<IpoDetails> {
    return this.transport.get<IpoDetails>(`/api/v1/ipo/info/${encodeURIComponent(String(id))}/`)
  }

  /** @param contractId - Only this contract. */
  async perpContracts(contractId?: number): Promise<PerpContract[]> {
    const query =
      contractId === undefined ? '' : `?${new URLSearchParams({ contract_id: String(contractId) }).toString()}`
    const { contracts } = await this.transport.get<{ contracts: PerpContract[] }>(
      `/perps/public-api/v1/contracts/${query}`
    )
    return contracts
  }

  perpSystemStatus(): Promise<PerpSystemStatus> {
    return this.transport.get<PerpSystemStatus>('/perps/public-api/v1/system-status/')
  }

  /**
   * @param options - Filters, all optional.
   * @param options.statuses - Only positions in these states. Without it, closed positions are included.
   * @param options.contractId - Only this contract.
   */
  async perpPositions(options: { statuses?: PerpPositionStatus[]; contractId?: number } = {}): Promise<PerpPosition[]> {
    const query = new URLSearchParams()
    if (options.contractId !== undefined) query.set('contract_id', String(options.contractId))
    for (const status of options.statuses ?? []) query.append('statuses', status)
    const search = query.size === 0 ? '' : `?${query.toString()}`
    const { positions } = await this.transport.get<{ positions: PerpPosition[] }>(
      `/perps/public-api/v1/positions/${search}`
    )
    return positions
  }

  /**
   * @param options - Filters, all optional.
   * @param options.contractId - Only this contract.
   * @param options.statuses - Only orders in these states.
   */
  async perpOrders(options: { contractId?: number; statuses?: PerpOrderStatus[] } = {}): Promise<PerpOrder[]> {
    const query = new URLSearchParams({ limit: String(PERP_ORDERS_PAGE_SIZE) })
    if (options.contractId !== undefined) query.set('contract_id', String(options.contractId))
    for (const status of options.statuses ?? []) query.append('statuses', status)
    const page = await this.transport.get<PerpOrdersPage>(`/perps/public-api/v2/orders/?${query.toString()}`)
    if (page.next_cursor != null) {
      throw new Error(`more than ${PERP_ORDERS_PAGE_SIZE} perp orders, and paging them is not supported`)
    }
    return page.orders
  }

  /**
   * OHLCV candles for several tickers in one request.
   *
   * @param requests - One per series wanted, 20 at most.
   */
  async candles(requests: CandleRequest[]): Promise<CandleSeries[]> {
    const { responses } = await this.transport.post<{ responses: CandleSeries[] }>(
      '/kandelabr/public-api/v1/candles/batch',
      { requests }
    )
    return responses
  }

  coinDetails(currency: string, fiatCurrency: FiatCurrency): Promise<CoinDetails> {
    return this.transport.get<CoinDetails>(
      `/api/v1/coins/details/${encodeURIComponent(currency)}/${encodeURIComponent(fiatCurrency)}/`
    )
  }

  charts(currency: string, fiatCurrency: FiatCurrency): Promise<Charts> {
    return this.transport.get<Charts>(
      `/api/v1/charts/${encodeURIComponent(currency)}/${encodeURIComponent(fiatCurrency)}/`
    )
  }

  priceForFiatAtTime(
    cryptoCurrency: string,
    localCurrency: FiatCurrency,
    amount: number | string,
    time: Date | string | number
  ): Promise<PriceAtTime> {
    const query = new URLSearchParams({
      crypto_currency: cryptoCurrency,
      local_currency: localCurrency,
      amount: String(amount),
      time: time instanceof Date ? time.toISOString() : String(time)
    })
    return this.transport.get<PriceAtTime>(`/api/v1/exchange_rates/price_for_fiat_at_time/?${query.toString()}`)
  }

  availableExchanges(): Promise<AvailableExchanges> {
    return this.transport.get<AvailableExchanges>('/api/v1/exchange/get-available-exchanges/')
  }

  /**
   * Executable rate, spread included, unlike the display rates.
   *
   * @param fromCurrency - What is paid.
   * @param toCurrency - What is received.
   * @param fromAmount - Amount of `fromCurrency`; `0` returns the rate and limits only.
   */
  quote(fromCurrency: string, toCurrency: string, fromAmount: number): Promise<ExchangeQuote> {
    return this.transport.post<ExchangeQuote>('/api/v1/exchange/convert/', {
      from_amount: fromAmount,
      from_currency: fromCurrency,
      to_currency: toCurrency
    })
  }

  /**
   * Moves real money and is never retried. After a failure, check balances before trying again.
   *
   * @param request - The exchange, in the shape the API takes it.
   */
  createExchange(request: ExchangeRequest): Promise<Exchange> {
    return this.transport.post<Exchange>('/api/v1/exchange/create_exchange/', request, 0)
  }

  /**
   * Non-zero spot balances and the total, which also counts staked funds.
   * A USD account is priced at the latest candle close, any other at the rates `accounts()` reports.
   */
  async portfolio(): Promise<Portfolio> {
    const data = await this.accounts()
    if (!Array.isArray(data.accounts)) {
      throw new Error('accounts response carries no accounts array')
    }
    const accountsTotal = decimal(data.available_balance_total_fiat_amount)
    if (accountsTotal === null) {
      throw new Error(`accounts total is not a number: ${String(data.available_balance_total_fiat_amount)}`)
    }

    const entries: PortfolioEntry[] = []
    for (const account of data.accounts) {
      const balance = decimal(account.available_balance)
      if (balance === null) {
        throw new Error(`${account.currency} balance is not a number: ${String(account.available_balance)}`)
      }
      if (balance <= 0) continue
      const fiatValue = decimal(account.available_balance_fiat_amount)
      if (fiatValue === null) {
        throw new Error(
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
      const series = (await Promise.all(batches.map((batch) => this.candles(batch)))).flat()
      const closes = new Map(series.map((item) => [item.ticker, decimal(item.candles.at(-1)?.c)]))
      for (const entry of entries) {
        const close = closes.get(`${entry.currency}/USD/SPOT`) ?? null
        if (close === null) throw new Error(`${entry.currency} has no candle price`)
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
}
