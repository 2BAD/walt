# Balances

```ts
const { entries, total, fiatCurrency } = await client.portfolio()

for (const { currency, amount, fiatValue } of entries) {
  console.log(currency, amount, fiatValue) // TON 120.5 381.2
}
```

## `portfolio()`

Entries are sorted by fiat value. Zero balances are left out.

A USD account is valued at the latest candle close. Any other fiat currency uses the values from `accounts()`.

`total` is the figure the Walt app shows. Staked funds count in `total` but have no entry.

```ts
const { total, entriesTotal, staked } = await client.portfolio()
// 1250.4 1200.1 50.3
```

`staked` can be a few cents when nothing is staked.

## `accounts()`

Lists every currency, zero balances included. `category` is `onchain`, `stock` or `etf`.

```ts
const { accounts } = await client.accounts()
const stocks = accounts.filter((account) => account.category === 'stock')
```

## `pnl()`

24h and all-time change, per holding and in total.

To leave out staked positions, keep the rows whose `account_type` is `bank_account`.

## Staked funds

```ts
const campaigns = await client.earnCampaigns()
const joined = campaigns.filter((campaign) => campaign.account !== null)
// joined[0].account.balance  '50.000000'
```

`earnRate()` prices staking assets that `coins()` does not, such as `USDe`.

`earnCampaignTransactions()` lists every deposit, withdrawal and payout in one campaign, newest first.

```ts
for (const campaign of joined) {
  for (const row of await client.earnCampaignTransactions(campaign.campaign_id)) {
    console.log(campaign.name, row.date, row.direction, row.amount) // TON Staking 2026-01-02T07:00:00Z deposit 0.0041
  }
}
```

## IPO subscriptions

```ts
for (const { allocation_currency, active_order } of await client.ipos()) {
  if (active_order) console.log(allocation_currency, active_order.amount, active_order.pay_currency) // ACMEx 100.00 USDT
}
```

The amount of an active order is in no balance and not in `total`.

`ipo()` returns one IPO with its dates, order limits, fee and company.

## `portfolioHistory()`

Balance, profit and loss, deposits and withdrawals per day (`1d`) or per calendar month (`1m`).

```ts
const { chart, total_period_details } = await client.portfolioHistory('2026-01-01', '1m')

for (const period of chart.data_points) {
  console.log(period.date_from, period.close_amount_fiat, period.total_pnl) // 2026-01-01T00:00:00Z 1250.40 12.75
}
```

`total_period_details` sums the whole range.
