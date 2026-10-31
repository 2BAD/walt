# Balances

```ts
const { entries, total, fiatCurrency } = await client.portfolio()

for (const { currency, amount, fiatValue } of entries) {
  console.log(currency, amount, fiatValue) // TON 120.5 381.2
}
```

## `portfolio()`

Returns balances above zero, sorted by fiat value, with the total and the account's display currency.

The entries do not add up to `total`. The total also covers staked funds, which have no entry of their own.

```ts
const { entriesTotal, total, staked } = await client.portfolio()
// entriesTotal  sum of the entries
// total         the figure the Walt app shows
// staked        total - entriesTotal
```

Expect a few cents of rounding in `staked` when nothing is staked.

## `accounts()`

Returns every currency the account can hold, zero balances included.

Group by `category` rather than by ticker. Values seen so far are `onchain`, `stock` and `etf`.

```ts
const { accounts } = await client.accounts()
const stocks = accounts.filter((account) => account.category === 'stock')
```

`addresses` holds deposit addresses per network. `actions` lists the operations the account allows.

## `pnl()`

Returns absolute and percentage change over 24h and all time, per holding and in total.

Staked positions have an `account_type` other than `bank_account`.

## Staked funds

```ts
const { campaigns } = await client.earnCampaigns()
const joined = campaigns.filter((campaign) => campaign.account !== null)
// joined[0].account.balance  '50.000000'
```

`earnCampaigns()` returns every campaign. `account` is set only on the ones this wallet has joined.

`earnRate()` prices staking assets that `coins()` does not quote, such as `USDe`. Its `depeg_info` shows how far a
stablecoin is off its peg.

`earnCampaignTransactions()` returns deposits, withdrawals and payouts inside a campaign. It returns the first page
only.

## Unverified shapes

`frozenBalances()` and `unconfirmedTransactions()` take a type parameter for their rows. No row has been observed
yet.

```ts
const frozen = await client.frozenBalances<{ currency: string; amount: string }>()
```
