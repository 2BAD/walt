# @2bad/walt

[![NPM version](https://img.shields.io/npm/v/@2bad/walt)](https://www.npmjs.com/package/@2bad/walt)
[![License](https://img.shields.io/npm/l/@2bad/walt)](https://www.npmjs.com/package/@2bad/walt)
[![Code coverage](https://img.shields.io/codecov/c/github/2BAD/walt)](https://codecov.io/gh/2BAD/walt)
[![GitHub Build Status](https://img.shields.io/github/actions/workflow/status/2BAD/walt/build.yml)](https://github.com/2BAD/walt/actions/workflows/build.yml)

Client for Walt, the crypto app in Telegram (ex @wallet).

- Balances, staking, prices, charts and transaction history
- Exchange quotes and exchanges between assets

## Install

```sh
npm install @2bad/walt
```

ESM only. Requires Node.js 26 or later.

## Quick start

```ts
import { TelegramTokenSource, WaltClient } from '@2bad/walt'

const source = new TelegramTokenSource({ session: 'SESSION_STRING', apiId: 12345, apiHash: 'API_HASH' })
const client = new WaltClient({ tokenProvider: () => source.token() })

const { entries, total, fiatCurrency } = await client.portfolio()
console.log(entries[0], total, fiatCurrency) // { currency: 'TON', amount: '120.5', fiatValue: 381.2 } 1250.4 USD
await source.disconnect()
```

## Examples

- [Connecting](examples/connecting.md): Telegram credentials, token storage, retries and pacing
- [Balances](examples/balances.md): accounts, portfolio, profit and loss, staked funds
- [Prices](examples/prices.md): coin rates, charts and past prices
- [Exchange](examples/exchange.md): available pairs, quotes and exchanges
- [Transactions](examples/transactions.md): history, details and reading a transaction
- [Errors](examples/errors.md): `WaltRequestError`, `WaltAuthError` and what is retried

A runnable script is in [examples/portfolio.ts](examples/portfolio.ts).

## API

```ts
new TelegramTokenSource(options: TelegramTokenSourceOptions)

type TelegramTokenSource = {
  token(): Promise<string>
  disconnect(): Promise<void>
}

new WaltClient(options: WaltClientOptions)

type WaltClient = {
  accounts(): Promise<AccountsResponse>
  portfolio(): Promise<Portfolio>
  pnl(): Promise<PnlResponse>
  frozenBalances<T = unknown>(): Promise<T[]>

  earnCampaigns(): Promise<EarnCampaignsResponse>
  earnCampaignTransactions(campaignId: number | string): Promise<EarnTransactionsPage>
  earnRate(from: string, to: string): Promise<EarnRate>

  coins(fiatCurrency: FiatCurrency): Promise<Coin[]>
  coinDetails(currency: string, fiatCurrency: FiatCurrency): Promise<CoinDetails>
  charts(currency: string, fiatCurrency: FiatCurrency): Promise<Charts>
  priceForFiatAtTime(crypto: string, fiat: FiatCurrency, amount: number | string, time: Date | string | number): Promise<PriceAtTime>
  localCurrency(): Promise<FiatCurrency>

  availableExchanges(): Promise<AvailableExchanges>
  quote(fromCurrency: string, toCurrency: string, fromAmount: number): Promise<ExchangeQuote>
  createExchange(request: ExchangeRequest): Promise<Exchange> // moves real money, never retried

  transactions(limit?: number, cursor?: string): Promise<TransactionsPage>
  accountTransactions(currency: string, limit?: number, cursor?: string): Promise<TransactionsPage>
  allTransactions(limit?: number): AsyncGenerator<Transaction>
  allAccountTransactions(currency: string, limit?: number): AsyncGenerator<Transaction>
  transactionDetails(id: number | string, gateway?: TransactionGateway): Promise<TransactionDetails>
  detailsFor(transactions: AsyncIterable<Transaction> | Iterable<Transaction>): AsyncGenerator<TransactionDetails>
  unconfirmedTransactions<T = unknown>(limit?: number): Promise<{ transactions: T[]; size: number }>
}

function normalizeTransaction(details: TransactionDetails): NormalizedTransaction
```

Response fields keep the API's `snake_case`. Amounts are decimal strings, except in the exchange responses.

The API publishes no schemas. Every type was derived from real responses and is loose where a value has not been seen.

## License

MIT
