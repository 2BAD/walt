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

export type WalletClientOptions = {
  tokenProvider: () => Promise<string>
  baseUrl?: string
  fetch?: typeof fetch
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

export type Account = {
  currency: string
  account_type: string
  rate: string
  absolute_rate_change: string
  percent_rate_change: string
  balance_hold: string
  available_balance: string
  available_balance_usd_amount: string
  available_balance_fiat_amount: string
  available_balance_fiat_currency: string
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
  local_fiat_amount: string
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
  gateway_details: unknown
  is_blocked: boolean
  is_cancellable: boolean
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

export class WalletClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly tokenProvider: () => Promise<string>
  private readonly traceId = hex(16)
  private readonly baggage: string
  private readonly referer: string
  private token: string | null = null
  private pending: Promise<string> | null = null

  constructor(options: WalletClientOptions) {
    if (!options.tokenProvider) {
      throw new WalletAuthError('tokenProvider is required')
    }
    this.tokenProvider = options.tokenProvider
    this.baseUrl = options.baseUrl ?? BASE_URL
    this.fetchImpl = options.fetch ?? fetch
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

  private async get<T>(path: string, allowRefresh = true): Promise<T> {
    const token = await this.ensureToken()
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: {
        ...BROWSER_HEADERS,
        authorization: token,
        referer: this.referer,
        baggage: this.baggage,
        'sentry-trace': `${this.traceId}-${hex(8)}-0`,
        traceparent: `00-${hex(16)}-${hex(8)}-01`
      }
    })
    if (response.status === 401) {
      if (allowRefresh) {
        this.token = null
        return this.get<T>(path, false)
      }
      throw new WalletAuthError('token rejected after refresh')
    }
    if (!response.ok) throw new Error(`GET ${path} failed (${response.status})`)
    return (await response.json()) as T
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

  transactionDetails(id: number | string, gateway?: TransactionGateway): Promise<TransactionDetails> {
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
    const entries = data.accounts
      .filter((account) => Number(account.available_balance) > 0)
      .map((account) => ({
        currency: account.currency,
        amount: account.available_balance,
        fiatValue: Number(account.available_balance_fiat_amount)
      }))
      .sort((a, b) => b.fiatValue - a.fiatValue)
    return {
      entries,
      total: Number(data.available_balance_total_fiat_amount),
      fiatCurrency: data.available_balance_total_fiat_currency
    }
  }
}
