export type PerpContract = {
  contract_id: number
  contract_name: string
  base_asset: string
  quote_asset: string
  venue_status: string
  is_active: boolean
  price_decimals: number
  size_decimals: number
  tick_size: string
  step_size: string
  min_size_base: string
  max_size_base: string
  max_size_quote: string
  min_size_quote: string
  max_leverage: number
  maker_fee_pct: string
  taker_fee_pct: string
  base_taker_fee_pct: string
  taker_fee_subscription_id: number
  price_slippage: string
  tpsl_buffer_pct: string
  funding_rate_hourly: string
  next_funding_at: string
  open_interest_usd: string
  volume_24h_usd: string
  trading_hours_state: unknown
  market_data: {
    server_time: string
    /** `fresh`, or `stale` with both prices `null`. */
    status: string
    mark_price: string | null
    index_price: string | null
    source_timestamp: string
    expires_at: string
  }
  /** Fractions in basis points: `1000` is 10%, so 10x leverage. */
  margin: {
    default_initial_margin_fraction: number
    min_initial_margin_fraction: number
    maintenance_margin_fraction: number
    closeout_margin_fraction: number
  }
}

export type PerpSystemStatus = {
  actions: {
    open_enabled: boolean
    cancel_enabled: boolean
    close_enabled: boolean
    add_margin_enabled: boolean
    remove_margin_enabled: boolean
    auto_close_enabled: boolean
  }
  exchange_status: {
    exchange_partner_tech_name: string
    operational_state: string
    is_trading_halted: boolean
    message: unknown
    current_status: unknown
    upcoming_maintenance: unknown
    last_changed_at: string
    last_checked_at: string
  }
}

export type PerpOrdersPage = {
  orders: PerpOrder[]
  next_cursor: unknown
  /** `sort_ts` of the last order on the page, `null` on an empty page. */
  last_sort_ts: string | null
}

export type PerpPositionStatus = 'open' | 'closed'

export type PerpOrderStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'filled'
  | 'partially_filled'
  | 'failed'
  | 'canceled'

type PerpPositionCore = {
  contract_id: number
  contract_name: string
  contract_base_asset: string
  contract_quote_asset: string
  /** Seen: `long`, `short`. */
  side: string
  /** Seen: `closed`. */
  status: string
  leverage: number
  /** Seen: `isolated`. */
  margin_type: string
  value_base: string
  margin_quote: string
  avg_entry_price: string
  liquidation_price: string
  funding_paid_quote: string
  created_at: string
  updated_at: string
  synced_at: string
}

export type PerpPosition = PerpPositionCore & {
  trading_agent_code: string
  /** Priced at the current mark, closed positions included, so it is not the P/L a closed position realised. */
  valuation: {
    server_time: string
    status: string
    mark_price: string
    index_price: string
    source_timestamp: string
    expires_at: string
    unrealized_pnl_quote: string
    equity_quote: string
  }
  auto_close: unknown
}

export type PerpOrder = {
  order_id: string
  contract_id: number
  contract_name: string
  contract_base_asset: string
  contract_quote_asset: string
  side: string
  /** Seen: `market`. */
  type: string
  /** Seen: `open`, `close`, `stop_loss`, `take_profit`. */
  category: string
  status: string
  error_code: unknown
  leverage: number
  base_size: string
  base_price: string
  accounting_base_amount: string
  accounting_quote_amount: string
  filled_price: string | null
  filled_base_amount: string | null
  filled_quote_amount: string | null
  pnl_quote: string | null
  pnl_quote_charged: unknown
  roi: string | null
  trigger_price_quote: string | null
  limit_price_quote: string | null
  /** Unix seconds. */
  valid_to: number | null
  liquidation_fee: unknown
  liquidation_fee_charged: unknown
  integrator_fee: string | null
  integrator_fee_charged: string | null
  venue_fee: string | null
  total_fee: string | null
  total_fee_charged: string | null
  margin_returned_amount: string | null
  created_at: string
  updated_at: string
  filled_at: string | null
  canceled_at: unknown
  sort_ts: string
  position: PerpPositionCore & { fee_quote: unknown; close_price: string }
}
