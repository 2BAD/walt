# Exchange

```ts
const { rate, min_amount, max_amount } = await client.quote('USDT', 'NVDAx', 0)
```

## Pairs

`availableExchanges()` maps every currency to what the app offers to exchange it with.

The server accepts more pairs than it lists. A quote is the real test.

## `quote()`

Prices an exchange without performing it.

`rate` already includes the spread. Use it for price triggers, not the rate from `coins()` or `accounts()`.

`min_amount` and `max_amount` bound `fromAmount`. When selling, `max_amount` is the balance.

An amount of `0` returns the rate and limits alone. An amount over the maximum is a 400.

## `createExchange()`

```ts
const filled = await client.createExchange({
  from_currency: 'USDT',
  to_currency: 'NVDAx',
  from_amount: 25,
  local_currency: 'USD'
})
```

This moves real money. It executes at once, with no confirm step.

The response carries both balances after the trade, the fee and the fill `rate`.

It is never retried. If it throws, check the balances before trying again.

Set `max_amount: true` to sell the whole balance.

## Amounts

Amounts in exchange responses are numbers. Everywhere else they are decimal strings.
