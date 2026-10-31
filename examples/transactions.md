# Transactions

```ts
for await (const transaction of client.allTransactions(100)) {
  console.log(transaction.id, transaction.gateway, transaction.amount, transaction.currency)
}

const tonRows = await Array.fromAsync(client.allAccountTransactions('TON'))
```

## Pages

To read one page at a time, pass back the `next_cursor` of the previous page. Stop when a page comes back empty.

```ts
let page = await client.transactions(undefined, 50)
while (page.transactions.length > 0 && page.next_cursor !== null) {
  page = await client.transactions(page.next_cursor, 50)
}
```

Do not loop on `next_cursor` alone. The API keeps returning one past the last row.

Pass back only cursors the API gave you. A malformed cursor is a 500.

## `transactionDetails()`

Returns fees, exchange rate, the paired side of a conversion, and the on-chain destination and hash.

```ts
const details = await client.transactionDetails(row.id, row.gateway)
```

Pass the `gateway` of the list row. An `xstocks_dividends` record is a 404 without it.

## `detailsFor()`

Fetches details for many transactions, in the order they arrived.

```ts
for await (const details of client.detailsFor(client.allTransactions(100))) {
  console.log(details.id, details.fee_amount)
}
```

It also takes an array. `maxConcurrent` sets how many lookups run at once.

A lookup that still fails after its retries stops the walk. A summed result is never short a row.

## `normalizeTransaction()`

Turns a details record into what the wallet received, sent and paid in fees.

```ts
import { normalizeTransaction } from '@2bad/walt'

const { received, sent, fee } = normalizeTransaction(details)
// received  { currency: 'USDT', amount: '1000.000000' }
// sent      { currency: 'BTC', amount: '0.010000000000' }
```

It needs a `transactionDetails()` record. List rows lack the amount of the second leg.

Do not subtract `fee` from `received`. It has already been taken out.

## Staking

Moves inside earn campaigns are in `earnCampaignTransactions()`, not here. `transactions()` sees only the spot side of
a move into or out of earn.
