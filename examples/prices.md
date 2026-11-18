# Prices

```ts
const coins = await client.coins()
// coins[0]  { currency: 'TON', rate: '3.16', ... }
```

## Fiat currency

`balances()`, `coins()`, `coinDetails()`, `charts()` and `priceForFiatAtTime()` use the client's `fiatCurrency`. The default is `USD`.

`accounts()` and `portfolio()` use the account's own currency. `localCurrency()` returns it.

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
const then = await client.priceForFiatAtTime('TON', 100, new Date('2026-01-01'))
```

## `coinDetails()`

Description, networks and trading hours of one coin.
