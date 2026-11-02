export type EarnAccount = {
  account_id: number
  /** Units staked in this campaign, absent from `accounts()`. */
  balance: string
  paid_out_amount: string
  currency: string
  created_at: string
  max_withdraw_amount: unknown
  pending_withdraw_deadline_at: unknown
}

export type EarnAccessPolicy = {
  access_to_deposit: boolean
  access_to_withdrawal: boolean
  access_to_full_withdrawal: boolean
  deposit_restriction_reason: unknown
}

export type EarnBonus = {
  account_id: number | null
  name: string
  status: string
  apy: string
  combined_apy: string
  max_amount: string
  paid_out_amount: string
  duration: number | null
  end_at: string | null
}

export type EarnInterestRate = {
  rate: string
  interest_type: string
  combined_rate: string
  effective_rate: string
  bonus_rate: string | null
}

export type EarnPayoutPool = {
  total: string
  available: string
}

export type EarnAmount = {
  amount: string
  currency: string
}

export type EarnCampaign = {
  campaign_id: number
  /** Matches `PnlPosition.earn_campaign_name`. */
  name: string
  status: string
  /** Null unless the campaign was joined. */
  account: EarnAccount | null
  apy_type: string
  current_apy: string
  effective_apy: string | null
  interest_rate: EarnInterestRate
  bonus: EarnBonus | null
  access_policy: EarnAccessPolicy
  payout_pool: EarnPayoutPool | null
  total_earned: EarnAmount | null
  payout_type: string
  payout_account_type: string
  payout_interval: number
  payout_account: unknown
  input_currency: string
  deposit_currency: string
  payout_currency: string
  deposit_withdraw_currency: string
  payout_withdraw_currency: string
  min_amount: string
  max_amount: string | null
  min_deposit_amount: string
  min_withdraw_amount: string | null
  last_24hours_paid_out_amount: string | null
  start_at: string
  end_at: string | null
  terms_and_conditions: boolean
  is_deposit_limit_exceeded: boolean
}

export type EarnCampaignsResponse = {
  campaigns: EarnCampaign[]
  required_kyc_level: string
  ab_tests: Record<string, unknown>
  tooltip_campaign_id: number | null
  total_participants: number
}

export type EarnTransaction = {
  id: number
  transaction_type: string
  direction: string
  status: string
  source: string
  amount: string
  currency: string
  date: string
  transfer_id: string
  idempotency_key: string
  deadline_at: unknown
  pending_reason: unknown
}

export type EarnTransactionsPage = {
  transactions: EarnTransaction[]
  deposit_acc_next_from: number | null
  payout_acc_next_from: number | null
  transfer_request_next_before_datetime: string | null
}

export type EarnDepegInfo = {
  depeg_state: string
  depeg: number
  currency: string
  reference_currency: string
}

export type EarnRate = {
  rate: string
  depeg_info: EarnDepegInfo | null
}
