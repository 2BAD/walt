import { randomBytes } from 'node:crypto'
import { BROWSER_HEADERS } from '~/browser.ts'

const BASE_URL = 'https://walletbot.me'

const SENTRY_RELEASE = '10.0.84666'
const SENTRY_PUBLIC_KEY = '544a92e441a24f17aa6b08e34e728ed2'

const hex = (bytes: number): string => randomBytes(bytes).toString('hex')

const telegramUserIdOf = (token: string): number | null => {
  try {
    const payload = token.replace(/^Bearer\s+/i, '').split('.')[1] ?? ''
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
  /** Null until the account `is_created`. */
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
  /** For example `onchain`, `stock` or `etf`. */
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
  mira_summary: { summary: string; bot_url: string; updated_at: string } | null
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
  | 'loyalty_payout'
  | 'crypto_card_cashback'
  | 'affiliate_payout'
  | 'limit_swap'
  | 'payment_link'
  | 'bot_banking'

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

export type TransactionDetails = {
  id: number
  type: string
  created_at: string
  status: string
  gateway: string
  crypto_amount: string
  crypto_currency: string
  /** Null when the transaction was never priced. */
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
  tg_transfer_status: string | null
  payment_link_id: string | null
  mention: string | null
  comment: string | null
  input_addresses: string | null
  recipient_wallet_address: string | null
  network: string | null
  crypto_tx_id: string | null
  /** Block explorer url for `crypto_tx_id`. */
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
  /** Already deducted from the legs; reporting only. */
  fee: TransactionLeg | null
}

/**
 * Splits a `transactionDetails()` record into what entered the wallet, what left it, and the fee.
 * A `deposit` of USDT paired with BTC is a sale of BTC. Listing rows lack `pair_transaction_amount`,
 * so they cannot be normalised.
 *
 * @param details - A `transactionDetails()` record.
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
      details.fee_currency !== null && details.fee_amount !== null && Number(details.fee_amount) > 0
        ? { currency: details.fee_currency, amount: details.fee_amount }
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

export type EarnAccount = {
  account_id: number
  /** Units staked in this campaign, absent from `accounts()`. */
  balance: string
  paid_out_amount: string
  currency: string
  created_at: string
  max_withdraw_amount: unknown
  pending_withdraw_deadline_at: unknown
}

export type EarnAccessPolicy = {
  access_to_deposit: boolean
  access_to_withdrawal: boolean
  access_to_full_withdrawal: boolean
  deposit_restriction_reason: unknown
}

export type EarnBonus = {
  account_id: number | null
  name: string
  status: string
  apy: string
  combined_apy: string
  max_amount: string
  paid_out_amount: string
  duration: number | null
  end_at: string | null
}

export type EarnInterestRate = {
  rate: string
  interest_type: string
  combined_rate: string
  effective_rate: string
  bonus_rate: string | null
}

export type EarnPayoutPool = {
  total: string
  available: string
}

export type EarnAmount = {
  amount: string
  currency: string
}

export type EarnCampaign = {
  campaign_id: number
  /** Matches `PnlPosition.earn_campaign_name`. */
  name: string
  status: string
  /** Null unless the campaign was joined. */
  account: EarnAccount | null
  apy_type: string
  current_apy: string
  effective_apy: string | null
  interest_rate: EarnInterestRate
  bonus: EarnBonus | null
  access_policy: EarnAccessPolicy
  payout_pool: EarnPayoutPool | null
  total_earned: EarnAmount | null
  payout_type: string
  payout_account_type: string
  payout_interval: number
  payout_account: unknown
  input_currency: string
  deposit_currency: string
  payout_currency: string
  deposit_withdraw_currency: string
  payout_withdraw_currency: string
  min_amount: string
  max_amount: string | null
  min_deposit_amount: string
  min_withdraw_amount: string | null
  last_24hours_paid_out_amount: string | null
  start_at: string
  end_at: string | null
  terms_and_conditions: boolean
  is_deposit_limit_exceeded: boolean
}

export type EarnCampaignsResponse = {
  campaigns: EarnCampaign[]
  required_kyc_level: string
  ab_tests: Record<string, unknown>
  tooltip_campaign_id: number | null
  total_participants: number
}

export type EarnTransaction = {
  id: number
  transaction_type: string
  direction: string
  status: string
  source: string
  amount: string
  currency: string
  date: string
  transfer_id: string
  idempotency_key: string
  deadline_at: unknown
  pending_reason: unknown
}

export type EarnTransactionsPage = {
  transactions: EarnTransaction[]
  deposit_acc_next_from: number | null
  payout_acc_next_from: number | null
  transfer_request_next_before_datetime: string | null
}

export type EarnDepegInfo = {
  depeg_state: string
  depeg: number
  currency: string
  reference_currency: string
}

export type EarnRate = {
  rate: string
  depeg_info: EarnDepegInfo | null
}

export type PnlPosition = {
  currency: string
  fiat_currency: string
  /** Cost basis, not current value; add `absolute_all_time` for that. */
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
  /** Cost basis, not current value; add `absolute_all_time` for that. */
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

/** Each exchangeable currency mapped to its counterparts. Pairs appear in both directions. */
export type AvailableExchanges = Record<string, string[]>

/**
 * Amounts are numbers, not decimal strings. `min_amount` and `max_amount` bound `from_amount`;
 * `max_amount` is the balance when selling and the platform limit when buying.
 */
export type ExchangeQuote = {
  from_amount: number
  from_currency: string
  to_amount: number
  to_currency: string
  rate: number
  min_amount: number
  max_amount: number
}

export type ExchangeRequest = {
  from_currency: string
  to_currency: string
  from_amount: number
  local_currency: FiatCurrency
  /** Set when `from_amount` is the whole balance. */
  max_amount?: boolean
}

/** `ttl` is in seconds. */
export type Exchange = {
  uid: string
  transfer_id: string
  ttl: number
  from_amount: number
  from_balance_after: number
  from_currency: string
  to_amount: number
  to_balance_after: number
  to_currency: string
  from_fiat_amount: number
  from_fiat_currency: string
  to_fiat_amount: number
  to_fiat_currency: string
  rate: number
  fee_amount: number
  fee_currency: string
  fee_fiat_amount: number
  fee_fiat_currency: string
  new_rates: boolean
  non_promo_fee_amount: unknown
  non_promo_fee_currency: unknown
  promo_fee: unknown
  max_amount: boolean
  price_deviation_percent: string
}

export class WaltAuthError extends Error {}

export class WaltRequestError extends Error {
  /** HTTP status, or `0` when the request never got a response. */
  readonly status: number
  /** From a `retry-after` given in seconds. */
  readonly retryAfterMs: number | null

  constructor(message: string, status: number, retryAfterMs: number | null, options?: ErrorOptions) {
    super(message, options)
    this.status = status
    this.retryAfterMs = retryAfterMs
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
    const userId = telegramUserIdOf(token)
    const headers: Record<string, string> = {
      ...BROWSER_HEADERS,
      accept: 'application/json',
      authorization: token.replace(/^Bearer\s+/i, ''),
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
      throw new WaltRequestError(`${method} ${path} failed (no response)`, 0, null, { cause })
    }
    if (response.status === 401) {
      if (rejected !== undefined) throw new WaltAuthError('token rejected after refresh')
      if (this.token === token) this.token = null
      return this.send<T>(path, body, token)
    }
    if (!response.ok) {
      throw new WaltRequestError(
        `${method} ${path} failed (${response.status})`,
        response.status,
        retryAfterOf(response)
      )
    }
    return (await response.json()) as T
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
    for (;;) {
      const current = await page(cursor)
      // past the last row the API still returns a next_cursor, with an empty page
      if (current.transactions.length === 0) return
      yield* current.transactions
      if (current.next_cursor === null) return
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
   * Deposits, withdrawals and payouts within one campaign. First page only.
   *
   * @param campaignId - `campaign_id` from `earnCampaigns()`.
   */
  earnCampaignTransactions(campaignId: number | string): Promise<EarnTransactionsPage> {
    return this.get<EarnTransactionsPage>(
      `/earn/public-api/v1/campaigns/${encodeURIComponent(String(campaignId))}/transactions`
    )
  }

  earnRate(from: string, to: string): Promise<EarnRate> {
    return this.get<EarnRate>(`/earn/public-api/v1/rate/${encodeURIComponent(from)}/${encodeURIComponent(to)}`)
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
