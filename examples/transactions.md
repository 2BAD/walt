# Transactions

```ts
for await (const transaction of client.allTransactions(100)) {
  console.log(transaction.id, transaction.gateway, transaction.amount, transaction.currency)
}

const tonRows = await Array.fromAsync(client.allAccountTransactions('TON'))
```

## Pages

Stop on an empty page. `next_cursor` is still set after the last one.

```ts
let page = await client.transactions(50)
while (page.transactions.length > 0 && page.next_cursor !== null) {
  page = await client.transactions(50, page.next_cursor)
}
```

## `transactionDetails()`

Fees, rates, both sides of a conversion and the on-chain hash.

```ts
const details = await client.transactionDetails(row.id, row.gateway)
```

Pass the row's `gateway`. Some records, such as `xstocks_dividends`, are a 404 without it.

## `detailsFor()`

```ts
for await (const details of client.detailsFor(client.allTransactions(100))) {
  console.log(details.id, details.fee_amount)
}
```

Takes an array or an async iterable. Results keep the input order.

A lookup that fails after its retries throws and ends the loop.

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
