# Transactions

```ts
for (const transaction of await client.transactions()) {
  console.log(transaction.id, transaction.gateway, transaction.amount, transaction.currency)
}

const tonRows = await client.transactions({ currency: 'TON' })
```

Newest first.

## `transactionDetails()`

Fees, rates, both sides of a conversion and the on-chain hash.

```ts
const details = await client.transactionDetails(row.id, row.gateway)
```

Pass the row's `gateway`. Some records, such as `xstocks_dividends`, are a 404 without it.

## Details for many rows

```ts
const rows = await client.transactions()
const details = await Promise.all(rows.map((row) => client.transactionDetails(row.id, row.gateway)))
```

The client runs at most `maxConcurrent` lookups at once.

## `normalizeTransaction()`

```ts
import { normalizeTransaction } from '@2bad/walt'

const { received, sent, fee } = normalizeTransaction(details)
// received  { currency: 'USDT', amount: '1000.000000' }
// sent      { currency: 'BTC', amount: '0.010000000000' }
```

`received` already has `fee` taken out.

## Staking

Moves inside earn campaigns are listed by `earnCampaignTransactions()`, not `transactions()`.
