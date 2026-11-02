import { describe, expect, it } from 'vitest'
import { type TransactionDetails, normalizeTransaction } from '~/api/transactions.ts'

const detailsOf = (overrides: Partial<TransactionDetails>): TransactionDetails => ({
  id: 10000000000001,
  type: 'deposit',
  created_at: '2026-01-01T00:00:00.000000Z',
  status: 'success',
  gateway: 'crypto_exchange',
  crypto_amount: '100.000000',
  crypto_currency: 'USDT',
  local_fiat_amount: '100.00',
  local_fiat_amount_now: '100.00',
  local_currency: 'USD',
  fee_amount: null,
  fee_currency: null,
  exchange_rate: null,
  pair_transaction_amount: null,
  pair_transaction_currency: null,
  username: null,
  tg_id: null,
  transfer_id: null,
  tg_transfer_status: null,
  payment_link_id: null,
  mention: null,
  comment: null,
  input_addresses: null,
  recipient_wallet_address: null,
  network: null,
  crypto_tx_id: null,
  transaction_link: null,
  photo_url: null,
  gateway_details: null,
  is_blocked: false,
  is_cancellable: false,
  block_reason: null,
  ...overrides
})

describe('normalizeTransaction', () => {
  it('reads a deposit of the quote currency as a sale of the paired asset', () => {
    expect.assertions(2)

    const legs = normalizeTransaction(
      detailsOf({
        type: 'deposit',
        crypto_amount: '1000.000000',
        crypto_currency: 'USDT',
        pair_transaction_amount: '0.010000000000',
        pair_transaction_currency: 'BTC'
      })
    )

    expect(legs.received).toStrictEqual({ currency: 'USDT', amount: '1000.000000' })
    expect(legs.sent).toStrictEqual({ currency: 'BTC', amount: '0.010000000000' })
  })

  it('reads a deposit of the asset as a purchase paid for in the quote currency', () => {
    expect.assertions(2)

    const legs = normalizeTransaction(
      detailsOf({
        type: 'deposit',
        crypto_amount: '2.000000',
        crypto_currency: 'GMEx',
        pair_transaction_amount: '200.000000',
        pair_transaction_currency: 'USDT'
      })
    )

    expect(legs.received).toStrictEqual({ currency: 'GMEx', amount: '2.000000' })
    expect(legs.sent).toStrictEqual({ currency: 'USDT', amount: '200.000000' })
  })

  it('flips both legs for a withdraw', () => {
    expect.assertions(2)

    const legs = normalizeTransaction(
      detailsOf({
        type: 'withdraw',
        crypto_amount: '50.000000',
        crypto_currency: 'TON',
        pair_transaction_amount: '90.000000',
        pair_transaction_currency: 'USDT'
      })
    )

    expect(legs.sent).toStrictEqual({ currency: 'TON', amount: '50.000000' })
    expect(legs.received).toStrictEqual({ currency: 'USDT', amount: '90.000000' })
  })

  it('ignores a pair that only repeats the same asset back', () => {
    expect.assertions(2)

    const legs = normalizeTransaction(
      detailsOf({
        type: 'deposit',
        gateway: 'p2p_order',
        crypto_amount: '100.000000',
        crypto_currency: 'USDT',
        pair_transaction_amount: '101.000000',
        pair_transaction_currency: 'USDT'
      })
    )

    expect(legs.received).toStrictEqual({ currency: 'USDT', amount: '100.000000' })
    expect(legs.sent).toBeNull()
  })

  it('leaves one side empty when there is no pair at all', () => {
    expect.assertions(2)

    const legs = normalizeTransaction(
      detailsOf({ type: 'withdraw', gateway: 'withdraw_onchain', crypto_amount: '25.00', crypto_currency: 'USDT' })
    )

    expect(legs.sent).toStrictEqual({ currency: 'USDT', amount: '25.00' })
    expect(legs.received).toBeNull()
  })

  it('reports a fee without implying it should be subtracted again', () => {
    expect.assertions(2)

    const legs = normalizeTransaction(
      detailsOf({
        crypto_amount: '0.500000',
        crypto_currency: 'AAPLx',
        pair_transaction_amount: '100.000000',
        pair_transaction_currency: 'USDT',
        fee_amount: '0.005000',
        fee_currency: 'AAPLx'
      })
    )

    expect(legs.fee).toStrictEqual({ currency: 'AAPLx', amount: '0.005000' })
    expect(legs.received).toStrictEqual({ currency: 'AAPLx', amount: '0.500000' })
  })

  it('treats a zero or absent fee as no fee', () => {
    expect.assertions(2)

    expect(normalizeTransaction(detailsOf({ fee_amount: '0', fee_currency: 'USDT' })).fee).toBeNull()
    expect(normalizeTransaction(detailsOf({})).fee).toBeNull()
  })
})
