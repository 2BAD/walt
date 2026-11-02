export type LimitOrder = {
  id: string
  client_order_id: string
  base_currency: string
  side: string
  /** `LIMIT`, or `TP` and `SL` for take-profit and stop-loss orders. */
  type: string
  price_limit: string
  quantity: string
  multiplier: string
  spv_price_limit: string
  spv_quantity: string
  fee: string
  fee_currency: string
  total: string
  /** For example `OPEN`, `CANCELLING`, `CANCELLED` or `FILLED`. */
  status: string
  created_at: string
  updated_at: string
  /** Only on filled orders. */
  executed_at?: string
  /** Only on filled orders. */
  execution?: { filled_quantity: string; filled_quote_amount: string; price: string }
}

export type LimitOrderQuote = {
  base_currency: string
  side: string
  price_limit: string
  quantity: string
  multiplier: string
  spv_price_limit: string
  spv_quantity: string
  notional: string
  fee: string
  fee_currency: string
  total: string
  fee_discount: { kind: string; regular_amount: string; reason: string }
}

export type LimitOrderBounds = {
  base_currency: string
  price: string
  max_price_limit: string
  take_profit_min_price: string
  stop_loss_max_price: string
  price_decimals: number
  updated_at: string
}

export type LimitOrderToken = {
  code: string
  /** Smallest order, in USDT. */
  min_limit: string
  max_limit: string
  quantity_decimals: number
}
