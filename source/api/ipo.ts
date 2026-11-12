export type IpoOrder = {
  order_uid: string
  /** In `pay_currency`. Counted in no balance or total while the order is active. */
  amount: string
  pay_currency: string
  /** Only `active` has been seen. */
  status: string
  created_at: string
  updated_at: string
}

export type Ipo = {
  id: number
  /** The token a subscription is allocated in. */
  allocation_currency: string
  funding_deadline_dt: string
  indicative_price: string
  indicative_price_range_min: string
  indicative_price_range_max: string
  is_funding_open: boolean
  /** Your subscription. Seen only as an object; absent and null are assumed for an IPO without one. */
  active_order?: IpoOrder | null
}

export type IpoStep = {
  /** For example `initial_filing`, `pre_listing`, `pricing_day` or `listing_day`. */
  type: string
  /** For example `completed`, `active` or `locked`. */
  state: string
  date_range: { start: string; end: string }
  prospectus_url: string | null
}

export type IpoDetails = Ipo & {
  pay_currency: string
  listing_dt: string
  min_order_amount: string
  max_order_amount: string
  fee_percent: string
  limit_exceeded: boolean
  terms_of_use_url: string
  description: string
  company: { industry: string; website_url: string; founded_year: number; headquarters: string }
  steps: IpoStep[]
}
