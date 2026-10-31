# Prices

```ts
const fiat = await client.localCurrency()
const coins = await client.coins(fiat)
// coins[0]  { currency: 'TON', rate: '3.16', ... }
```

## Fiat currency

Every price method takes a `FiatCurrency`. There is no default.

`localCurrency()` returns the account's own.

## `charts()`

Returns five series in one response: `day`, `week`, `month`, `year` and `all`.

```ts
const { week } = await client.charts('TON', 'USD')
// week[0]  { rate: '3.21', timestamp: 1767225600 }
```

## `priceForFiatAtTime()`

Values an amount at a past moment.

```ts
const then = await client.priceForFiatAtTime('TON', 'USD', 100, new Date('2026-01-01'))
```

## `coinDetails()`

Returns the description, networks and trading hours of one coin.
