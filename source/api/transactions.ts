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
