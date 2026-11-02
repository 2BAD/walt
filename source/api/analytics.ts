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

export type PortfolioFlows = {
  total: string
  crypto_transfer: string
  transfer: string
  p2p: string
  on_ramp: string
  off_ramp: string
  earn: string
  gift: string
  wpay: string
  trading_agent: string
  other: string
}

/** Fiat amounts over one period. */
export type PortfolioPeriod = {
  date_from: string
  date_to: string
  open_balance_fiat: string
  close_amount_fiat: string
  total_pnl: string
  total_pnl_percent: string | null
  realized_pnl_details: { total: string; total_percent: string | null; spot: string; perps: string; earns: string }
  unrealized_pnl_details: { total: string; total_percent: string | null }
  deposits_details: PortfolioFlows
  withdrawals_details: PortfolioFlows
}

export type PortfolioHistory = {
  fiat_currency: string
  chart: { data_points: PortfolioPeriod[] }
  total_period_details: PortfolioPeriod
}
