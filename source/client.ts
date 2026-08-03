const BASE_URL = 'https://walletbot.me'

export type WalletClientOptions = {
  tokenProvider: () => Promise<string>
  baseUrl?: string
  fetch?: typeof fetch
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
  networks: string[]
  category: string
  rate: string
  rate_change_24h_percent: string
  volume24h: string
}

export type Transaction = {
  id: number
  type: string
  created_at: string
  amount: string
  currency: string
  status: string
  gateway: string
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
  private token: string | null = null
  private pending: Promise<string> | null = null

  constructor(options: WalletClientOptions) {
    if (!options.tokenProvider) {
      throw new WalletAuthError('tokenProvider is required')
    }
    this.tokenProvider = options.tokenProvider
    this.baseUrl = options.baseUrl ?? BASE_URL
    this.fetchImpl = options.fetch ?? fetch
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
      headers: { accept: 'application/json', authorization: token }
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

  async coins(fiatCurrency = 'USD'): Promise<Coin[]> {
    const { coins } = await this.get<{ coins: Coin[] }>(`/api/v1/coins/list/${fiatCurrency}/`)
    return coins
  }

  transactions(cursor?: string): Promise<TransactionsPage> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    return this.get<TransactionsPage>(`/api/v1/transactions/${query}`)
  }

  frozenBalances<T = unknown>(): Promise<T[]> {
    return this.get<T[]>('/api/v1/accounts/frozen')
  }

  pnl(): Promise<PnlResponse> {
    return this.get<PnlResponse>('/customer-analytics/public-api/v1/pnl/assets/')
  }

  charts(currency: string, fiatCurrency: string): Promise<Charts> {
    return this.get<Charts>(`/api/v1/charts/${encodeURIComponent(currency)}/${encodeURIComponent(fiatCurrency)}/`)
  }

  priceForFiatAtTime<T = unknown>(query: Record<string, string | number>): Promise<T> {
    const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString()
    return this.get<T>(`/api/v1/exchange_rates/price_for_fiat_at_time/?${search}`)
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
