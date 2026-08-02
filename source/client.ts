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
  balance_hold: string
  available_balance: string
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

export class WalletAuthError extends Error {}

export class WalletClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly tokenProvider: () => Promise<string>
  private token: string | null = null

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
    this.token = (await this.tokenProvider()).replace(/^Bearer\s+/i, '')
    return this.token
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
