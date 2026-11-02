import { randomBytes } from 'node:crypto'
import type { AccountsResponse, Charts, Coin, CoinDetails, FiatCurrency, PriceAtTime } from '~/api/accounts.ts'
import type { PnlResponse, PortfolioHistory } from '~/api/analytics.ts'
import type { EarnCampaignsResponse, EarnRate, EarnTransaction, EarnTransactionsPage } from '~/api/earn.ts'
import type { AvailableExchanges, Exchange, ExchangeQuote, ExchangeRequest } from '~/api/exchange.ts'
import type { LimitOrder, LimitOrderBounds, LimitOrderQuote, LimitOrderToken } from '~/api/limit-orders.ts'
import type { Transaction, TransactionDetails, TransactionGateway, TransactionsPage } from '~/api/transactions.ts'
import { BROWSER_HEADERS } from '~/browser.ts'

const BASE_URL = 'https://walletbot.me'

const SENTRY_RELEASE = '10.0.84666'
const SENTRY_PUBLIC_KEY = '544a92e441a24f17aa6b08e34e728ed2'

const hex = (bytes: number): string => randomBytes(bytes).toString('hex')

const calendarDate = (date: Date): string =>
  [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-')

const telegramUserIdOf = (token: string): number | null => {
  try {
    const payload = token.split('.')[1] ?? ''
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      web_view_init_data?: { user?: { id?: unknown } }
    }
    const id = claims.web_view_init_data?.user?.id
    return typeof id === 'number' ? id : null
  } catch {
    return null
  }
}

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
  /** The API's own total, which includes staked funds. */
  total: number
  /** `total - entriesTotal`, itemised by `earnCampaigns()`. */
  staked: number
  fiatCurrency: string
}

export class WaltAuthError extends Error {}

export class WaltRequestError extends Error {
  /** HTTP status, or `0` when the request never got a response. */
  readonly status: number
  /** From a `retry-after` given in seconds. */
  readonly retryAfterMs: number | null
  /** The response body, parsed when it is JSON, such as `{ code: 'market_order_max_limit_error', detail }`. */
  readonly body: unknown

  constructor(message: string, status: number, retryAfterMs: number | null, body: unknown, options?: ErrorOptions) {
    super(message, options)
    this.status = status
    this.retryAfterMs = retryAfterMs
    this.body = body
  }
}

const parseBody = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const RETRYABLE_STATUS = new Set([0, 429, 502, 503, 504])

const MAX_RETRY_DELAY_MS = 30_000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const retryAfterOf = (response: Response): number | null => {
  const header = response.headers.get('retry-after')
  return header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) * 1000 : null
}

export class WaltClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly tokenProvider: (rejected?: string) => Promise<string>
  private readonly traceId = hex(16)
  private readonly baggage: string
  private readonly retries: number
  private readonly retryDelayMs: number
  private readonly maxConcurrent: number
  private token: string | null = null
  private pending: Promise<string> | null = null
  private active = 0
  private readonly waiting: (() => void)[] = []

  constructor(options: WaltClientOptions) {
    if (!options.tokenProvider) {
      throw new WaltAuthError('tokenProvider is required')
    }
    this.tokenProvider = options.tokenProvider
    this.baseUrl = options.baseUrl ?? BASE_URL
    this.fetchImpl = options.fetch ?? fetch
    this.retries = options.retries ?? 3
    this.retryDelayMs = options.retryDelayMs ?? 500
    this.maxConcurrent = options.maxConcurrent ?? 4
    if (!(this.maxConcurrent >= 1)) {
      throw new RangeError(`maxConcurrent must be at least 1, got ${this.maxConcurrent}`)
    }
    if (!Number.isInteger(this.retries) || this.retries < 0) {
      throw new RangeError(`retries must be a whole number of at least 0, got ${this.retries}`)
    }
    this.baggage = [
      'sentry-environment=production',
      `sentry-release=${SENTRY_RELEASE}`,
      `sentry-public_key=${SENTRY_PUBLIC_KEY}`,
      `sentry-trace_id=${this.traceId}`,
      'sentry-transaction=%2Fwv',
      'sentry-sampled=false',
      `sentry-sample_rand=${Math.random()}`,
      'sentry-sample_rate=0.01'
    ].join(',')
  }

  private async ensureToken(rejected?: string): Promise<string> {
    if (this.token) return this.token
    this.pending ??= this.mintToken(rejected)
    try {
      return await this.pending
    } finally {
      this.pending = null
    }
  }

  private async mintToken(rejected?: string): Promise<string> {
    const token = await this.tokenProvider(rejected)
    this.token = token
    return token
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++
      return
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active++
        resolve()
      })
    })
  }

  private release(): void {
    this.active--
    this.waiting.shift()?.()
  }

  private async send<T>(path: string, body: unknown, rejected?: string): Promise<T> {
    const token = await this.ensureToken(rejected)
    const method = body === undefined ? 'GET' : 'POST'
    const jwt = token.replace(/^Bearer\s+/i, '')
    const userId = telegramUserIdOf(jwt)
    const headers: Record<string, string> = {
      ...BROWSER_HEADERS,
      accept: 'application/json',
      authorization: path.startsWith('/emporos/') ? `Bearer ${jwt}` : jwt,
      referer: `${this.baseUrl}/main?ep=menu${userId === null ? '' : `&tgWebAppUserId=${userId}`}`,
      baggage: this.baggage,
      'sentry-trace': `${this.traceId}-${hex(8)}-0`,
      traceparent: `00-${hex(16)}-${hex(8)}-01`
    }
    if (method === 'POST') {
      headers['content-type'] = 'application/json'
      headers['origin'] = this.baseUrl
    }
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(body) : null
      })
    } catch (cause) {
      throw new WaltRequestError(`${method} ${path} failed (no response)`, 0, null, null, { cause })
    }
    if (response.status === 401) {
      if (rejected !== undefined) throw new WaltAuthError('token rejected after refresh')
      if (this.token === token) this.token = null
      return this.send<T>(path, body, token)
    }
    let text: string
    try {
      text = await response.text()
    } catch (cause) {
      throw new WaltRequestError(`${method} ${path} failed (body not received)`, 0, null, null, { cause })
    }
    if (!response.ok) {
      throw new WaltRequestError(
        `${method} ${path} failed (${response.status})`,
        response.status,
        retryAfterOf(response),
        parseBody(text)
      )
    }
    try {
      return JSON.parse(text) as T
    } catch (cause) {
      throw new WaltRequestError(
        `${method} ${path} returned a body that is not JSON (${response.status})`,
        response.status,
        null,
        text,
        { cause }
      )
    }
  }

  private async request<T>(path: string, body: unknown, retries: number): Promise<T> {
    await this.acquire()
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.send<T>(path, body)
        } catch (error) {
          const transient = error instanceof WaltRequestError && RETRYABLE_STATUS.has(error.status)
          if (!transient || attempt >= retries) throw error
          const backoff = Math.min(MAX_RETRY_DELAY_MS, this.retryDelayMs * 2 ** attempt)
          await sleep(error.retryAfterMs ?? backoff / 2 + Math.random() * (backoff / 2))
        }
      }
    } finally {
      this.release()
    }
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path, undefined, this.retries)
  }

  accounts(): Promise<AccountsResponse> {
    return this.get<AccountsResponse>('/api/v1/accounts/')
  }

  async coins(fiatCurrency: FiatCurrency): Promise<Coin[]> {
    const { coins } = await this.get<{ coins: Coin[] }>(`/api/v1/coins/list/${fiatCurrency}/`)
    return coins
  }

  async localCurrency(): Promise<FiatCurrency> {
    const { local_currency } = await this.get<{ local_currency: FiatCurrency }>('/api/v1/currencies/local_currency/')
    return local_currency
  }

  transactions(limit?: number, cursor?: string): Promise<TransactionsPage> {
    const query = new URLSearchParams()
    if (limit !== undefined) query.set('limit', String(limit))
    if (cursor !== undefined) query.set('cursor', cursor)
    const search = query.size === 0 ? '' : `?${query.toString()}`
    return this.get<TransactionsPage>(`/api/v1/transactions/${search}`)
  }

  accountTransactions(currency: string, limit?: number, cursor?: string): Promise<TransactionsPage> {
    const query = new URLSearchParams({ crypto_currency: currency })
    if (limit !== undefined) query.set('limit', String(limit))
    if (cursor !== undefined) query.set('cursor', cursor)
    return this.get<TransactionsPage>(`/api/v1/transactions/single-account/?${query.toString()}`)
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
    return this.get<TransactionDetails>(`/api/v1/transactions/details/${encodeURIComponent(String(id))}/${query}`)
  }

  unconfirmedTransactions<T = unknown>(limit?: number): Promise<{ transactions: T[]; size: number }> {
    const query = limit === undefined ? '' : `?${new URLSearchParams({ limit: String(limit) }).toString()}`
    return this.get<{ transactions: T[]; size: number }>(`/api/v1/transactions/unconfirmed/${query}`)
  }

  frozenBalances<T = unknown>(): Promise<T[]> {
    return this.get<T[]>('/api/v1/accounts/frozen')
  }

  /** Every earn campaign. Staked balances are here, not in `accounts()`. */
  earnCampaigns(): Promise<EarnCampaignsResponse> {
    return this.get<EarnCampaignsResponse>('/earn/public-api/v1/campaigns/')
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
    return this.get<EarnTransactionsPage>(
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
    return this.get<EarnRate>(`/earn/public-api/v1/rate/${encodeURIComponent(from)}/${encodeURIComponent(to)}`)
  }

  pnl(): Promise<PnlResponse> {
    return this.get<PnlResponse>('/customer-analytics/public-api/v1/pnl/assets/')
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
    return this.get<PortfolioHistory>(`/customer-analytics/public-api/v1/portfolio/private/?${query.toString()}`)
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
    const { items } = await this.get<{ items: LimitOrder[] }>(`/emporos/public-api/orders/limit${search}`)
    return items
  }

  limitOrder(id: string): Promise<LimitOrder> {
    const query = new URLSearchParams({ id })
    return this.get<LimitOrder>(`/emporos/public-api/orders/limit/by-id?${query.toString()}`)
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
    return this.get<LimitOrderQuote>(`/emporos/public-api/orders/limit/quote?${query.toString()}`)
  }

  limitOrderBounds(baseCurrency: string): Promise<LimitOrderBounds> {
    const query = new URLSearchParams({ base_currency: baseCurrency })
    return this.get<LimitOrderBounds>(`/emporos/public-api/orders/limit/bounds?${query.toString()}`)
  }

  /** Every currency a limit order can buy. */
  async limitOrderTokens(): Promise<LimitOrderToken[]> {
    const { tokens } = await this.get<{ tokens: LimitOrderToken[] }>('/emporos/public-api/orders/limit/tokens')
    return tokens
  }

  coinDetails(currency: string, fiatCurrency: FiatCurrency): Promise<CoinDetails> {
    return this.get<CoinDetails>(
      `/api/v1/coins/details/${encodeURIComponent(currency)}/${encodeURIComponent(fiatCurrency)}/`
    )
  }

  charts(currency: string, fiatCurrency: FiatCurrency): Promise<Charts> {
    return this.get<Charts>(`/api/v1/charts/${encodeURIComponent(currency)}/${encodeURIComponent(fiatCurrency)}/`)
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
    return this.get<PriceAtTime>(`/api/v1/exchange_rates/price_for_fiat_at_time/?${query.toString()}`)
  }

  availableExchanges(): Promise<AvailableExchanges> {
    return this.get<AvailableExchanges>('/api/v1/exchange/get-available-exchanges/')
  }

  /**
   * Executable rate, spread included, unlike the display rates.
   *
   * @param fromCurrency - What is paid.
   * @param toCurrency - What is received.
   * @param fromAmount - Amount of `fromCurrency`; `0` returns the rate and limits only.
   */
  quote(fromCurrency: string, toCurrency: string, fromAmount: number): Promise<ExchangeQuote> {
    return this.request<ExchangeQuote>(
      '/api/v1/exchange/convert/',
      { from_amount: fromAmount, from_currency: fromCurrency, to_currency: toCurrency },
      this.retries
    )
  }

  /**
   * Moves real money and is never retried. After a failure, check balances before trying again.
   *
   * @param request - The exchange, in the shape the API takes it.
   */
  createExchange(request: ExchangeRequest): Promise<Exchange> {
    return this.request<Exchange>('/api/v1/exchange/create_exchange/', request, 0)
  }

  /** Non-zero spot balances against the API total, which also counts staked funds. */
  async portfolio(): Promise<Portfolio> {
    const data = await this.accounts()
    if (!Array.isArray(data.accounts)) {
      throw new Error('accounts response carries no accounts array')
    }
    const total = decimal(data.available_balance_total_fiat_amount)
    if (total === null) {
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

    const entriesTotal = entries.reduce((sum, entry) => sum + entry.fiatValue, 0)

    return {
      entries: entries.sort((a, b) => b.fiatValue - a.fiatValue),
      entriesTotal,
      total,
      staked: total - entriesTotal,
      fiatCurrency: data.available_balance_total_fiat_currency
    }
  }
}
