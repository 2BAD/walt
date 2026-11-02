import type { FiatCurrency } from '~/api/accounts.ts'

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
