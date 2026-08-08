import { randomBytes } from 'node:crypto'

const BASE_URL = 'https://walletbot.me'

const SENTRY_RELEASE = '10.0.74110'
const SENTRY_PUBLIC_KEY = '544a92e441a24f17aa6b08e34e728ed2'

const BROWSER_HEADERS = {
  accept: 'application/json',
  'accept-encoding': 'gzip, deflate, br, zstd',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  dnt: '1',
  pragma: 'no-cache',
  priority: 'u=1, i',
  'sec-ch-ua': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-storage-access': 'active',
  'sec-gpc': '1',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'
}

const hex = (bytes: number): string => randomBytes(bytes).toString('hex')

const decimal = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export type WalletClientOptions = {
  tokenProvider: () => Promise<string>
  baseUrl?: string
  fetch?: typeof fetch
  /** Extra attempts after a request fails on a transient status. Default 3, `0` disables retrying. */
  retries?: number
  /** Base for the exponential backoff between those attempts, in ms. Default 500. */
  retryDelayMs?: number
  /** Requests allowed in flight at once. Default 4, `Infinity` removes the limit. */
  maxConcurrent?: number
}

export type FiatCurrency =
  | 'USD'
  | 'EUR'
  | 'RUB'
  | 'GBP'
  | 'UAH'
  | 'KZT'
  | 'BYN'
  | 'KRW'
  | 'ILS'
  | 'IDR'
  | 'AED'
  | 'GEL'
  | 'TWD'
  | 'TRY'
  | 'HKD'
  | 'INR'
  | 'CAD'
  | 'AMD'
  | 'AUD'
  | 'PLN'
  | 'COP'
  | 'BRL'
  | 'CHF'
  | 'MXN'
  | 'ARS'
  | 'SGD'
  | 'SAR'
  | 'MDL'
  | 'JPY'
  | 'RON'
  | 'SEK'
  | 'AZN'
  | 'RSD'
  | 'NOK'
  | 'MYR'
  | 'BGN'
  | 'EGP'
  | 'GTQ'
  | 'CLP'
  | 'NZD'
  | 'BDT'
  | 'KGS'
  | 'THB'
  | 'UZS'
  | 'UYU'
  | 'VND'
  | 'UGX'
  | 'KES'
  | 'ZAR'
  | 'VES'
  | 'ETB'
  | 'NGN'
  | 'LKR'
  | 'PHP'
  | 'PKR'
  | 'TJS'
  | 'CNY'
  | 'MZN'
  | 'SDG'
  | 'ZMW'

export type PriceAtTime = {
  rate: string
  fiat_amount: string
  currency_from: string
  currency_to: string
  amount_from: string
  time: string
}

export type AccountAddress = {
  /** Null until the address is created, which is what `is_created` on the account reports. */
  address: string | null
  network: string
  network_code: string
  wallet_to_replace: boolean
}

export type AccountAction = {
  is_enabled: boolean
  is_popular: boolean
  scheduled_at: unknown
}

export type AccountActions = {
  deposit: AccountAction
  withdraw_inner: AccountAction
  withdraw_outer: AccountAction
  exchange: AccountAction
  p2p: AccountAction
  purchase: AccountAction
}

export type Account = {
  currency: string
  account_type: string
  /** `onchain`, `stock` or `etf` on the account this was derived from. Left wide, see the readme. */
  category: string
  description: string | null
  market_cap: string | null
  rate: string
  absolute_rate_change: string
  percent_rate_change: string
  balance_hold: string
  available_balance: string
  available_balance_usd_amount: string
  available_balance_fiat_amount: string
  available_balance_fiat_currency: string
  addresses: AccountAddress[]
  actions: AccountActions
  is_created: boolean
  is_always_on_main: boolean
  is_new_currency: boolean
  has_transactions: boolean
}

export type AccountsResponse = {
  available_balance_total_fiat_amount: string
  available_balance_total_fiat_currency: string
  accounts: Account[]
}

export type Coin = {
  currency: string
  fiat_currency: string
  networks: string[]
  category: string
  rate: string
  rate_change_24h_percent: string
  volume24h: string | null
}

export type TradingHoursPeriod = {
  mode: string
  start_at: string
  end_at: string
}

export type TradingHoursState = TradingHoursPeriod & {
  next_mode: string
  schedule: TradingHoursPeriod[]
}

export type CoinDetails = {
  currency: string
  fiat_currency: string
  category: string
  description: string
  networks: string[]
  rate: string
  rate_change_24h_percent: string
  rate_change_24h_absolute: string
  volume24h: string | null
  volume24h_change_24h_percent: string | null
  market_cap: string | null
  market_cap_change_24h_percent: string | null
  total_supply: string | null
  circulating_supply: string | null
  chart_preview_rate_24h: { timestamp: number; value: string }[]
  trading_hours_state: TradingHoursState | null
}

export type TransactionGateway =
  | 'card'
  | 'purchase'
  | 'internal'
  | 'btc'
  | 'manual'
  | 'crypto_exchange'
  | 'tg_transfer'
  | 'binance'
  | 'top_up'
  | 'withdraw_onchain'
  | 'fireblocks'
  | 'single_use'
  | 'multi_use'
  | 'part_multi_use'
  | 'p2p_order'
  | 'p2p_order_inactive_offer'
  | 'p2p_offer'
  | 'p2p_refund'
  | 'p2p_security_deposit'
  | 'p2p_security_deposit_seizure'
  | 'wpay_payment'
  | 'wpay_payout'
  | 'payouts'
  | 'bonus_any'
  | 'onboarding_incentive'
  | 'giveaway'
  | 'earn'
  | 'earn_reward'
  | 'earn_v2'
  | 'earn_v2_reward'
  | 'earn_v2_bonus'
  | 'earn_v2_crypto_exchange'
  | 'forced_transfer'
  | 'tg_transfer_onchain'
  | 'onramp'
  | 'offramp'
  | 'xstocks_dividends'
  | 'perps'
  | 'perps_pnl'
  | 'perps_fee'
  | 'perps_liquidation_fee'
  | 'perps_fundings'
  | 'perps_open_hold_shortfall'
  | 'perps_margin'
  | 'perps_bbook_insurance'
  | 'perps_bbook_reserve'
  | 'perps_resize_position'
  | 'unconfirmed_deposit'
  | 'loyalty_incentive'
  | 'compensation'
  | 'tg_stars_purchase'
  | 'ipo'
  | 'ipo_allocation'

export type Transaction = {
  id: number
  type: string
  created_at: string
  amount: string
  currency: string
  status: string
  gateway: string
  is_blocked: boolean
  username: string | null
  tg_id: number | null
  input_addresses: string | null
  recipient_wallet_address: string | null
  photo_url: string | null
  pair_transaction_currency: string | null
  network: string | null
  block_reason: string | null
  crypto_tx_id: string | null
  gateway_details: unknown
}

export type TransactionsPage = {
  transactions: Transaction[]
  limit: number
  size: number
  next_cursor: string | null
}

export type PortfolioEntry = {
  currency: string
  amount: string
  fiatValue: number
}

export type TransactionDetails = {
  id: number
  type: string
  created_at: string
  status: string
  gateway: string
  crypto_amount: string
  crypto_currency: string
  /** Null on the gateways that never priced the transaction: `p2p_order`, `withdraw_onchain`, `top_up`. */
  local_fiat_amount: string | null
  local_fiat_amount_now: string
  local_currency: string
  fee_amount: string | null
  fee_currency: string | null
  exchange_rate: string | null
  pair_transaction_amount: string | null
  pair_transaction_currency: string | null
  username: string | null
  tg_id: number | null
  transfer_id: string | null
  mention: string | null
  comment: string | null
  input_addresses: string | null
  recipient_wallet_address: string | null
  network: string | null
  crypto_tx_id: string | null
  /** Block explorer url for `crypto_tx_id`, and present on the same records. */
  transaction_link: string | null
  photo_url: string | null
  gateway_details: unknown
  is_blocked: boolean
  is_cancellable: boolean
  block_reason: string | null
}

export type TransactionLeg = {
  currency: string
  amount: string
}

export type NormalizedTransaction = {
  id: number
  createdAt: string
  gateway: string
  status: string
  received: TransactionLeg | null
  sent: TransactionLeg | null
  /** Already deducted from `received`, so adding it back would double count. Reporting only. */
  fee: TransactionLeg | null
}

/**
 * Splits a transaction into what entered the wallet, what left it, and the fee.
 *
 * Three things about the raw shape make this easy to get backwards. `type` is relative to the
 * wallet, so a `deposit` of USDT against a `pair_transaction_currency` of BTC is a sale of BTC
 * rather than a purchase. `pair_transaction_*` is a genuine second leg only when its currency
 * differs from `crypto_currency`; on every gateway but `crypto_exchange` it repeats the same
 * asset back, sometimes with a gross amount against a net `crypto_amount`. And `crypto_amount`
 * is already net of `fee_amount`.
 *
 * Needs a `transactionDetails()` record. A listing row carries `pair_transaction_currency` but
 * not `pair_transaction_amount`, so the second leg cannot be recovered from it.
 *
 * @param details - A single record from `transactionDetails()`.
 * @returns The same transaction as directional legs.
 */
export const normalizeTransaction = (details: TransactionDetails): NormalizedTransaction => {
  const main = { currency: details.crypto_currency, amount: details.crypto_amount }
  const pair =
    details.pair_transaction_currency !== null &&
    details.pair_transaction_amount !== null &&
    details.pair_transaction_currency !== details.crypto_currency
      ? { currency: details.pair_transaction_currency, amount: details.pair_transaction_amount }
      : null
  const inbound = details.type === 'deposit'

  return {
    id: details.id,
    createdAt: details.created_at,
    gateway: details.gateway,
    status: details.status,
    received: inbound ? main : pair,
    sent: inbound ? pair : main,
    fee:
      details.fee_currency !== null && Number(details.fee_amount) > 0
        ? { currency: details.fee_currency, amount: details.fee_amount ?? '0' }
        : null
  }
}

export type ChartPoint = {
  rate: string
  timestamp: number
}

export type Charts = {
  day: ChartPoint[]
  week: ChartPoint[]
  month: ChartPoint[]
  year: ChartPoint[]
  all: ChartPoint[]
}

export type PnlPosition = {
  currency: string
  fiat_currency: string
  /** Cost basis, not value - add `absolute_all_time`. Re-priced from historical rates that carry bad prints. */
  current_value_in_fiat: string
  absolute_24h: string
  percentage_24h: string
  absolute_all_time: string
  percentage_all_time: string
  account_type: string
  earn_campaign_name: string | null
}

export type PnlTotals = {
  fiat_currency: string
  /** Cost basis, not current value - add `absolute_all_time` for that. */
  current_value_in_fiat: string
  absolute_24h: string
  percentage_24h: string
  absolute_all_time: string
  percentage_all_time: string
}

export type PnlResponse = {
  positions: PnlPosition[]
  total: PnlTotals
}

export class WalletAuthError extends Error {}

export class WalletRequestError extends Error {
  /** HTTP status, or `0` when the request never got a response. */
  readonly status: number
  /** Parsed from `retry-after` when the server sent one as a whole number of seconds. */
  readonly retryAfterMs: number | null

  constructor(message: string, status: number, retryAfterMs: number | null, options?: ErrorOptions) {
    super(message, options)
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * Statuses worth trying again. 500 is deliberately absent: this API answers a malformed cursor
 * with one, so it means a bad request rather than a bad moment.
 */
const RETRYABLE_STATUS = new Set([0, 429, 502, 503, 504])

const MAX_RETRY_DELAY_MS = 30_000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const retryAfterOf = (response: Response): number | null => {
  const header = response.headers.get('retry-after')
  return header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) * 1000 : null
}

export class WalletClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly tokenProvider: () => Promise<string>
  private readonly traceId = hex(16)
  private readonly baggage: string
  private readonly referer: string
  private readonly retries: number
  private readonly retryDelayMs: number
  private readonly maxConcurrent: number
  private token: string | null = null
  private pending: Promise<string> | null = null
  private active = 0
  private readonly waiting: (() => void)[] = []

  constructor(options: WalletClientOptions) {
    if (!options.tokenProvider) {
      throw new WalletAuthError('tokenProvider is required')
    }
    this.tokenProvider = options.tokenProvider
    this.baseUrl = options.baseUrl ?? BASE_URL
    this.fetchImpl = options.fetch ?? fetch
    this.retries = options.retries ?? 3
    this.retryDelayMs = options.retryDelayMs ?? 500
    this.maxConcurrent = options.maxConcurrent ?? 4
    this.referer = `${this.baseUrl}/main`
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

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token
    this.pending ??= this.mintToken()
    try {
      return await this.pending
    } finally {
      this.pending = null
    }
  }

  private async mintToken(): Promise<string> {
    const token = (await this.tokenProvider()).replace(/^Bearer\s+/i, '')
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

  private async send<T>(path: string, allowRefresh: boolean): Promise<T> {
    const token = await this.ensureToken()
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: {
          ...BROWSER_HEADERS,
          authorization: token,
          referer: this.referer,
          baggage: this.baggage,
          'sentry-trace': `${this.traceId}-${hex(8)}-0`,
          traceparent: `00-${hex(16)}-${hex(8)}-01`
        }
      })
    } catch (cause) {
      throw new WalletRequestError(`GET ${path} failed (no response)`, 0, null, { cause })
    }
    if (response.status === 401) {
      if (allowRefresh) {
        this.token = null
        return this.send<T>(path, false)
      }
      throw new WalletAuthError('token rejected after refresh')
    }
    if (!response.ok) {
      throw new WalletRequestError(`GET ${path} failed (${response.status})`, response.status, retryAfterOf(response))
    }
    return (await response.json()) as T
  }

  private async get<T>(path: string): Promise<T> {
    await this.acquire()
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.send<T>(path, true)
        } catch (error) {
          const transient = error instanceof WalletRequestError && RETRYABLE_STATUS.has(error.status)
          if (!transient || attempt >= this.retries) throw error
          const backoff = Math.min(MAX_RETRY_DELAY_MS, this.retryDelayMs * 2 ** attempt)
          await sleep(error.retryAfterMs ?? backoff / 2 + Math.random() * (backoff / 2))
        }
      }
    } finally {
      this.release()
    }
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

  transactions(cursor?: string, limit?: number): Promise<TransactionsPage> {
    const query = new URLSearchParams()
    if (cursor !== undefined) query.set('cursor', cursor)
    if (limit !== undefined) query.set('limit', String(limit))
    const search = query.size === 0 ? '' : `?${query.toString()}`
    return this.get<TransactionsPage>(`/api/v1/transactions/${search}`)
  }

  accountTransactions(currency: string, limit?: number, cursor?: string): Promise<TransactionsPage> {
    const query = new URLSearchParams({ crypto_currency: currency })
    if (limit !== undefined) query.set('limit', String(limit))
    if (cursor !== undefined) query.set('cursor', cursor)
    return this.get<TransactionsPage>(`/api/v1/transactions/single-account/?${query.toString()}`)
  }

  /**
   * Walks a transaction listing to its end.
   *
   * Past the last row the API keeps handing back a fresh `next_cursor` with an empty `transactions`
   * array, so an empty page is the only reliable stop signal - looping until `next_cursor` is null
   * never terminates.
   *
   * @param page - Fetches one page, given the cursor the previous page returned.
   * @yields Each transaction, oldest page last, in the order the API returns them.
   */
  private async *walk(page: (cursor?: string) => Promise<TransactionsPage>): AsyncGenerator<Transaction> {
    let cursor: string | undefined
    for (;;) {
      const current = await page(cursor)
      if (current.transactions.length === 0) return
      yield* current.transactions
      if (current.next_cursor === null) return
      cursor = current.next_cursor
    }
  }

  allTransactions(limit?: number): AsyncGenerator<Transaction> {
    return this.walk((cursor) => this.transactions(cursor, limit))
  }

  allAccountTransactions(currency: string, limit?: number): AsyncGenerator<Transaction> {
    return this.walk((cursor) => this.accountTransactions(currency, limit, cursor))
  }

  /**
   * Looks up `transactionDetails()` for a stream of listing rows, keeping several lookups in
   * flight and yielding in the order they arrived.
   *
   * Listing rows carry `pair_transaction_currency` but not `pair_transaction_amount`, so the
   * second leg of an exchange only exists on the detail record. Anything that has to add up -
   * a balance, a cost basis - needs this rather than the rows alone.
   *
   * Each row's `gateway` is passed through. It is optional for most gateways but not all:
   * `xstocks_dividends` records 404 without it.
   *
   * A lookup that fails after its retries stops the walk. Nothing is skipped silently.
   *
   * @param transactions - Rows to look up, typically `allTransactions()`.
   * @yields One detail record per row, in the order the rows arrived.
   */
  async *detailsFor(
    transactions: AsyncIterable<Transaction> | Iterable<Transaction>
  ): AsyncGenerator<TransactionDetails> {
    const width = Math.max(1, Math.min(this.maxConcurrent, 32))
    const inFlight: Promise<TransactionDetails>[] = []
    try {
      for await (const transaction of transactions) {
        inFlight.push(this.transactionDetails(transaction.id, transaction.gateway))
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
   * Optional for most gateways, but `xstocks_dividends` records 404 without it. Pass the
   * `gateway` of the matching listing row whenever you have one.
   *
   * The parameter accepts any string, not just `TransactionGateway`, because a listing row's
   * `gateway` is a plain string that may carry a value added since the request enum was derived.
   *
   * @param id - Transaction id from a listing row.
   * @param gateway - That row's `gateway`.
   * @returns The full record, far wider than the listing row.
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

  pnl(): Promise<PnlResponse> {
    return this.get<PnlResponse>('/customer-analytics/public-api/v1/pnl/assets/')
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

  async portfolio(): Promise<{ entries: PortfolioEntry[]; total: number; fiatCurrency: string }> {
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

    return {
      entries: entries.sort((a, b) => b.fiatValue - a.fiatValue),
      total,
      fiatCurrency: data.available_balance_total_fiat_currency
    }
  }
}
