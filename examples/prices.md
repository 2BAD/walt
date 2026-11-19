# Prices

```ts
const coins = await client.coins()
// coins[0]  { currency: 'TON', rate: '3.16', ... }
```

## Fiat currency

`balances()`, `coins()`, `coin()`, `charts()` and `priceForFiatAtTime()` use the client's `fiatCurrency`. The default is `USD`.

`accounts()` and `portfolio()` ignore it and report in the currency the account uses.

`localCurrency()` returns the account's local currency.

```ts
const client = new WaltClient({ tokenProvider, fiatCurrency: 'EUR' })
```

## `charts()`

```ts
const { day, week, month, year, all } = await client.charts('TON')
// week[0]  { rate: '3.21', timestamp: 1767225600 }
```

## `priceForFiatAtTime()`

```ts
const then = await client.priceForFiatAtTime('TON', { amount: 100, time: new Date('2026-01-01') })
```

## `coin()`

Description, networks and trading hours of one coin.
