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
