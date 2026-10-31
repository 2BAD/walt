# Balances

```ts
const { entries, total, fiatCurrency } = await client.portfolio()

for (const { currency, amount, fiatValue } of entries) {
  console.log(currency, amount, fiatValue) // TON 120.5 381.2
}
```

## `portfolio()`

Entries are sorted by fiat value. Zero balances are left out.

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
const { campaigns } = await client.earnCampaigns()
const joined = campaigns.filter((campaign) => campaign.account !== null)
// joined[0].account.balance  '50.000000'
```

`earnRate()` prices staking assets that `coins()` does not, such as `USDe`.

`earnCampaignTransactions()` lists deposits, withdrawals and payouts in one campaign. It returns the first page only.

## Frozen and unconfirmed

No rows have been seen for `frozenBalances()` or `unconfirmedTransactions()`. Pass your own row type.

```ts
const frozen = await client.frozenBalances<{ currency: string; amount: string }>()
```
