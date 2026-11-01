# Exchange

```ts
const { rate, min_amount, max_amount } = await client.quote('USDT', 'NVDAx', 0)
```

## Pairs

`availableExchanges()` lists the pairs the app offers. Unlisted pairs can still work. Request a quote to find out.

## `quote()`

`rate` is the price you would get, spread included. Use it for price triggers instead of the rate from `coins()`.

`fromAmount` must be between `min_amount` and `max_amount`. When selling, `max_amount` is your balance.

Pass `0` to get the rate and limits alone.

## `createExchange()`

```ts
const filled = await client.createExchange({
  from_currency: 'USDT',
  to_currency: 'NVDAx',
  from_amount: 25,
  local_currency: 'USD'
})
```

This moves real money at once. There is no confirm step.

If it throws, check the balances before trying again.

Set `max_amount: true` to sell the whole balance.

## Limit orders

```ts
const quote = await client.limitOrderQuote('NVDAx', 'BUY', 170, { amount: 25 })
// quote.quantity '0.147058', quote.fee '0.05'
```

Only `BUY` orders are accepted.

Size an order by `amount` to spend or by `quantity` to receive.

`limitOrderTokens()` lists what can be bought, with the smallest order in USDT as `min_limit`.

```ts
const open = await client.limitOrders({ status: ['OPEN'] })
```

Filled orders carry `execution` with the fill price and amounts.
