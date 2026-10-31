# Prices

```ts
const fiat = await client.localCurrency()
const coins = await client.coins(fiat)
// coins[0]  { currency: 'TON', rate: '3.16', ... }
```

## Fiat currency

Price methods need a `FiatCurrency`. `localCurrency()` returns the one the account uses.

## `charts()`

```ts
const { day, week, month, year, all } = await client.charts('TON', 'USD')
// week[0]  { rate: '3.21', timestamp: 1767225600 }
```

## `priceForFiatAtTime()`

```ts
const then = await client.priceForFiatAtTime('TON', 'USD', 100, new Date('2026-01-01'))
```

## `coinDetails()`

Description, networks and trading hours of one coin.
