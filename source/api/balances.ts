export type Balance = {
  /** `REGULAR` for spot, `HOLD_LIMIT` for USDT reserved by open limit orders, `EARN_V2` for staked funds. */
  account_type: string
  currency: string
  asset_currency: string
  total_balance: string
  available_balance: string
  balance_hold: string
  is_always_on_main: boolean
  category: string
  rate_to_fiat: string
  rate_to_usd: string
  available_balance_fiat_amount: string
  available_balance_usd_amount: string
}

export type Balances = {
  accounts: Balance[]
  fiat_currency: string
  /** Spot, staked and limit order holds together. */
  overall_available_balance_fiat_amount: string
  /** Also `true` when the perps account has no open position. */
  has_open_perp_position: boolean
}
