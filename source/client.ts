import type { AccountsResponse, Charts, Coin, CoinDetails, FiatCurrency, PriceAtTime } from '~/api/accounts.ts'
import type { PnlResponse, PortfolioHistory } from '~/api/analytics.ts'
import type { Balances } from '~/api/balances.ts'
import type { CandleRequest, CandleSeries } from '~/api/candles.ts'
import type { EarnCampaignsResponse, EarnRate, EarnTransaction, EarnTransactionsPage } from '~/api/earn.ts'
import type { AvailableExchanges, Exchange, ExchangeQuote, ExchangeRequest } from '~/api/exchange.ts'
import type { LimitOrder, LimitOrderBounds, LimitOrderQuote, LimitOrderToken } from '~/api/limit-orders.ts'
import type {
  PerpContract,
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
  private readonly maxConcurrent: number

  constructor(options: WaltClientOptions) {
    if (!options.tokenProvider) {
      throw new WaltAuthError('tokenProvider is required')
    }
    const retries = options.retries ?? 3
    this.maxConcurrent = options.maxConcurrent ?? 4
    if (!(this.maxConcurrent >= 1)) {
      throw new RangeError(`maxConcurrent must be at least 1, got ${this.maxConcurrent}`)
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
      maxConcurrent: this.maxConcurrent
    })
  }

  accounts(): Promise<AccountsResponse> {
    return this.transport.get<AccountsResponse>('/api/v1/accounts/')
  }

  /**
   * Every balance with its account type, including USDT held by open limit orders, which `accounts()` omits.
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

  transactions(limit?: number, cursor?: string): Promise<TransactionsPage> {
    const query = new URLSearchParams()
    if (limit !== undefined) query.set('limit', String(limit))
    if (cursor !== undefined) query.set('cursor', cursor)
    const search = query.size === 0 ? '' : `?${query.toString()}`
    return this.transport.get<TransactionsPage>(`/api/v1/transactions/${search}`)
  }

  accountTransactions(currency: string, limit?: number, cursor?: string): Promise<TransactionsPage> {
    const query = new URLSearchParams({ crypto_currency: currency })
    if (limit !== undefined) query.set('limit', String(limit))
    if (cursor !== undefined) query.set('cursor', cursor)
    return this.transport.get<TransactionsPage>(`/api/v1/transactions/single-account/?${query.toString()}`)
  }

  private async *walk(page: (cursor?: string) => Promise<TransactionsPage>): AsyncGenerator<Transaction> {
    let cursor: string | undefined
    const seen = new Set<string>()
    for (;;) {
      const current = await page(cursor)
      // past the last row the API still returns a next_cursor, with an empty page
      if (current.transactions.length === 0) return
      yield* current.transactions
      if (current.next_cursor === null) return
      if (seen.has(current.next_cursor)) throw new Error('transactions pagination returned a cursor twice')
      seen.add(current.next_cursor)
      cursor = current.next_cursor
    }
  }

  allTransactions(limit?: number): AsyncGenerator<Transaction> {
    return this.walk((cursor) => this.transactions(limit, cursor))
  }

  allAccountTransactions(currency: string, limit?: number): AsyncGenerator<Transaction> {
    return this.walk((cursor) => this.accountTransactions(currency, limit, cursor))
  }

  /**
   * `transactionDetails()` for each listing row, several in flight, yielded in input order.
   * A lookup that still fails after its retries ends the iteration.
   *
   * @param transactions - Listing rows, typically `allTransactions()`.
   * @yields One detail record per row.
   */
  async *detailsFor(
    transactions: AsyncIterable<Transaction> | Iterable<Transaction>
  ): AsyncGenerator<TransactionDetails> {
    const width = Math.max(1, Math.min(this.maxConcurrent, 32))
    const inFlight: Promise<TransactionDetails>[] = []
    try {
      for await (const transaction of transactions) {
        const lookup = this.transactionDetails(transaction.id, transaction.gateway)
        void Promise.allSettled([lookup])
        inFlight.push(lookup)
        while (inFlight.length >= width) {
          const next = inFlight.shift()
          if (next) yield await next
        }
      }
      while (inFlight.length > 0) {
        const next = inFlight.shift()
        if (next) yield await next
      }
    } finally {
      await Promise.allSettled(inFlight)
    }
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

  unconfirmedTransactions<T = unknown>(limit?: number): Promise<{ transactions: T[]; size: number }> {
    const query = limit === undefined ? '' : `?${new URLSearchParams({ limit: String(limit) }).toString()}`
    return this.transport.get<{ transactions: T[]; size: number }>(`/api/v1/transactions/unconfirmed/${query}`)
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
   * @param limit - Rows per page. The API defaults to 10.
   * @param after - The previous page, to fetch the one that follows it.
   */
  earnCampaignTransactions(
    campaignId: number | string,
    limit?: number,
    after?: EarnTransactionsPage
  ): Promise<EarnTransactionsPage> {
    const query = new URLSearchParams()
    if (limit !== undefined) query.set('limit', String(limit))
    query.set('merge_with_transfer_requests', 'true')
    if (after?.deposit_acc_next_from != null) query.set('deposit_acc_offset_id', String(after.deposit_acc_next_from))
    if (after?.payout_acc_next_from != null) query.set('payout_acc_offset_id', String(after.payout_acc_next_from))
    if (after?.transfer_request_next_before_datetime != null) {
      query.set('transfer_request_before_datetime', after.transfer_request_next_before_datetime)
    }
    return this.transport.get<EarnTransactionsPage>(
      `/earn/public-api/v1/campaigns/${encodeURIComponent(String(campaignId))}/transactions?${query.toString()}`
    )
  }

  /**
   * Every row of `earnCampaignTransactions()`, page by page. The cursors stay set past the last row,
   * so a page shorter than `limit` ends the walk.
   *
   * @param campaignId - `campaign_id` from `earnCampaigns()`.
   * @param limit - Rows per page.
   * @yields One row per deposit, withdrawal or payout.
   */
  async *allEarnCampaignTransactions(campaignId: number | string, limit = 100): AsyncGenerator<EarnTransaction> {
    const seen = new Set<string>()
    let page: EarnTransactionsPage | undefined
    for (;;) {
      page = await this.earnCampaignTransactions(campaignId, limit, page)
      yield* page.transactions
      if (page.transactions.length < limit) return
      const cursor = [
        page.deposit_acc_next_from,
        page.payout_acc_next_from,
        page.transfer_request_next_before_datetime
      ].join('|')
      if (seen.has(cursor)) throw new Error('earn transactions pagination returned a cursor twice')
      seen.add(cursor)
    }
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
   * @param options - Filters, all optional.
   * @param options.status - Only orders in these states, such as `OPEN`.
   * @param options.limit - Most orders to return.
   */
  async limitOrders(options: { status?: string[]; limit?: number } = {}): Promise<LimitOrder[]> {
    const query = new URLSearchParams()
    for (const status of options.status ?? []) query.append('status', status)
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    const search = query.size === 0 ? '' : `?${query.toString()}`
    const { items } = await this.transport.get<{ items: LimitOrder[] }>(`/emporos/public-api/orders/limit${search}`)
    return items
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
   * @param options.limit - Most orders to return.
   */
  perpOrders(
    options: { contractId?: number; statuses?: PerpOrderStatus[]; limit?: number } = {}
  ): Promise<PerpOrdersPage> {
    const query = new URLSearchParams()
    if (options.contractId !== undefined) query.set('contract_id', String(options.contractId))
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    for (const status of options.statuses ?? []) query.append('statuses', status)
    const search = query.size === 0 ? '' : `?${query.toString()}`
    return this.transport.get<PerpOrdersPage>(`/perps/public-api/v2/orders/${search}`)
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
