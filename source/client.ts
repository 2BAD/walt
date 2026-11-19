import type { Accounts, Charts, Coin, CoinDetails, FiatCurrency, PriceAtTime } from '~/api/accounts.ts'
import type { Pnl, PortfolioHistory } from '~/api/analytics.ts'
import type { Balances } from '~/api/balances.ts'
import type { CandleRequest, CandleSeries } from '~/api/candles.ts'
import type { EarnCampaign, EarnRate, EarnTransaction, EarnTransactionsPage } from '~/api/earn.ts'
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
import { Transport, WaltError } from '~/transport.ts'

const BASE_URL = 'https://walletbot.me'
const TRANSACTIONS_PAGE_SIZE = 1000
const EARN_PAGE_SIZE = 1000
const LIMIT_ORDERS_PAGE_SIZE = 100
const PERP_ORDERS_PAGE_SIZE = 100

const calendarDate = (date: Date): string =>
  [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-')

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
  /** Currency of the fiat values from `balances()`, `coins()`, `coin()`, `charts()` and `priceForFiatAtTime()`. Default `USD`. */
  fiatCurrency?: FiatCurrency
}

export class WaltClient {
  readonly fiatCurrency: FiatCurrency
  private readonly transport: Transport

  constructor(options: WaltClientOptions) {
    if (!options.tokenProvider) {
      throw new TypeError('tokenProvider is required')
    }
    const retries = options.retries ?? 3
    const maxConcurrent = options.maxConcurrent ?? 4
    if (!(maxConcurrent >= 1)) {
      throw new RangeError(`maxConcurrent must be at least 1, got ${maxConcurrent}`)
    }
    if (!Number.isInteger(retries) || retries < 0) {
      throw new RangeError(`retries must be a whole number of at least 0, got ${retries}`)
    }
    this.fiatCurrency = options.fiatCurrency ?? 'USD'
    this.transport = new Transport({
      tokenProvider: options.tokenProvider,
      baseUrl: options.baseUrl ?? BASE_URL,
      fetch: options.fetch ?? fetch,
      retries,
      retryDelayMs: options.retryDelayMs ?? 500,
      maxConcurrent
    })
  }

  accounts(): Promise<Accounts> {
    return this.transport.get<Accounts>('/api/v1/accounts/')
  }

  /**
   * Every balance with its account type, including what open limit and take-profit orders hold,
   * which `accounts()` omits.
   */
  async balances(): Promise<Balances> {
    const query = new URLSearchParams({ fiat_currency: this.fiatCurrency })
    const { data } = await this.transport.get<{ data: Balances }>(
      `/portmone/public-api/v1/user/accounts?${query.toString()}`
    )
    return data
  }

  async coins(): Promise<Coin[]> {
    const { coins } = await this.transport.get<{ coins: Coin[] }>(
      `/api/v1/coins/list/${encodeURIComponent(this.fiatCurrency)}/`
    )
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
      if (seen.has(cursor)) throw new WaltError('pagination returned a cursor twice')
      seen.add(cursor)
      previous = page
    }
  }

  /**
   * @param id - Transaction id from a listing row.
   * @param options - Filters, all optional.
   * @param options.gateway - The row's `gateway`. Some records, such as `xstocks_dividends`, 404 without it.
   */
  transaction(id: number, options: { gateway?: TransactionGateway | (string & {}) } = {}): Promise<TransactionDetails> {
    const { gateway } = options
    const query = gateway ? `?${new URLSearchParams({ transaction_gateway: gateway }).toString()}` : ''
    return this.transport.get<TransactionDetails>(
      `/api/v1/transactions/details/${encodeURIComponent(String(id))}/${query}`
    )
  }

  /** Every earn campaign. Staked balances are here, not in `accounts()`. */
  async earnCampaigns(): Promise<EarnCampaign[]> {
    const { campaigns } = await this.transport.get<{ campaigns: EarnCampaign[] }>('/earn/public-api/v1/campaigns/')
    return campaigns
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

  earnRate(pair: { from: string; to: string }): Promise<EarnRate> {
    const { from, to } = pair
    return this.transport.get<EarnRate>(
      `/earn/public-api/v1/rate/${encodeURIComponent(from)}/${encodeURIComponent(to)}`
    )
  }

  pnl(): Promise<Pnl> {
    return this.transport.get<Pnl>('/customer-analytics/public-api/v1/pnl/assets/')
  }

  /**
   * Balance, P/L, deposits and withdrawals per day or per calendar month, plus totals for the whole range.
   *
   * @param range - The periods wanted.
   * @param range.from - Start of the first period, as a `Date` or `YYYY-MM-DD`. A `Date` counts by its UTC day.
   * @param range.resolution - Length of each period.
   */
  portfolioHistory(range: { from: Date | string; resolution: 'day' | 'month' }): Promise<PortfolioHistory> {
    const { from, resolution } = range
    const query = new URLSearchParams({
      date_from: from instanceof Date ? calendarDate(from) : from,
      resolution: resolution === 'day' ? '1d' : '1m'
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
   * @param order - The order, sized by `amount` to spend or `quantity` of `baseCurrency` to receive.
   * @param order.side - `SELL` is a valid value that the API currently rejects.
   * @param order.priceLimit - Highest price to pay per unit.
   */
  limitOrderQuote(
    baseCurrency: string,
    order: { side: 'BUY' | 'SELL'; priceLimit: number | string } & (
      | { amount: number | string }
      | { quantity: number | string }
    )
  ): Promise<LimitOrderQuote> {
    const query = new URLSearchParams({
      base_currency: baseCurrency,
      side: order.side,
      price_limit: String(order.priceLimit)
    })
    if ('amount' in order) query.set('amount', String(order.amount))
    else query.set('quantity', String(order.quantity))
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

  /**
   * @param options - Filters, all optional.
   * @param options.contractId - Only this contract.
   */
  async perpContracts(options: { contractId?: number } = {}): Promise<PerpContract[]> {
    const query =
      options.contractId === undefined
        ? ''
        : `?${new URLSearchParams({ contract_id: String(options.contractId) }).toString()}`
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
  perpOrders(options: { contractId?: number; statuses?: PerpOrderStatus[] } = {}): Promise<PerpOrder[]> {
    return this.paged<PerpOrdersPage, PerpOrder>(
      (previous) => {
        const query = new URLSearchParams({ limit: String(PERP_ORDERS_PAGE_SIZE) })
        if (options.contractId !== undefined) query.set('contract_id', String(options.contractId))
        for (const status of options.statuses ?? []) query.append('statuses', status)
        if (previous?.next_cursor != null) query.set('cursor', previous.next_cursor)
        return this.transport.get<PerpOrdersPage>(`/perps/public-api/v2/orders/?${query.toString()}`)
      },
      (page) => page.orders,
      (page) => page.next_cursor
    )
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

  coin(currency: string): Promise<CoinDetails> {
    return this.transport.get<CoinDetails>(
      `/api/v1/coins/details/${encodeURIComponent(currency)}/${encodeURIComponent(this.fiatCurrency)}/`
    )
  }

  charts(currency: string): Promise<Charts> {
    return this.transport.get<Charts>(
      `/api/v1/charts/${encodeURIComponent(currency)}/${encodeURIComponent(this.fiatCurrency)}/`
    )
  }

  priceForFiatAtTime(
    currency: string,
    lookup: { amount: number | string; time: Date | string | number }
  ): Promise<PriceAtTime> {
    const { amount, time } = lookup
    const query = new URLSearchParams({
      crypto_currency: currency,
      local_currency: this.fiatCurrency,
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
   * @param request - The exchange as `createExchange()` takes it. An `amount` of `0` returns the rate and limits only.
   */
  exchangeQuote(request: Pick<ExchangeRequest, 'from' | 'to' | 'amount'>): Promise<ExchangeQuote> {
    return this.transport.post<ExchangeQuote>('/api/v1/exchange/convert/', {
      from_amount: request.amount,
      from_currency: request.from,
      to_currency: request.to
    })
  }

  /**
   * Moves real money and is never retried. After a failure, check balances before trying again.
   *
   * @param request - The exchange, as `exchangeQuote()` takes it plus the fiat currency to value it in.
   */
  createExchange(request: ExchangeRequest): Promise<Exchange> {
    const body = {
      from_currency: request.from,
      to_currency: request.to,
      from_amount: request.amount,
      local_currency: request.localCurrency,
      ...(request.maxAmount === undefined ? {} : { max_amount: request.maxAmount })
    }
    return this.transport.post<Exchange>('/api/v1/exchange/create_exchange/', body, 0)
  }
}
