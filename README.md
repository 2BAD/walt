# @2bad/walt

[![NPM version](https://img.shields.io/npm/v/@2bad/walt)](https://www.npmjs.com/package/@2bad/walt)
[![License](https://img.shields.io/npm/l/@2bad/walt)](https://www.npmjs.com/package/@2bad/walt)
[![Code coverage](https://img.shields.io/codecov/c/github/2BAD/walt)](https://codecov.io/gh/2BAD/walt)
[![GitHub Build Status](https://img.shields.io/github/actions/workflow/status/2BAD/walt/build.yml)](https://github.com/2BAD/walt/actions/workflows/build.yml)

Client for Walt, the crypto app in Telegram (ex @wallet).

> [!WARNING]
> This is an unofficial client. It is not affiliated with, endorsed by or supported by Walt or Telegram. It uses a
> private, undocumented API. Using it likely violates the Walt and Telegram terms of service and may get your account
> restricted or banned. The software is provided as is, without warranty of any kind. The authors accept no liability
> for any loss of funds, account access or data, or any other damage arising from its use. Use it at your own risk.

## Install

```sh
npm install @2bad/walt
```

ESM only. Requires Node.js 26 or later.

`@2bad/walt/client` exports everything except `TelegramTokenSource`.
It imports no Node.js API and no Telegram library, for runtimes such as Cloudflare Workers.

## Quick start

```ts
import { TelegramTokenSource, WaltClient } from '@2bad/walt'

const source = new TelegramTokenSource({ session: 'SESSION_STRING', apiId: 12345, apiHash: 'API_HASH' })
const client = new WaltClient({ tokenProvider: (rejected) => source.token(rejected) })

const { entries, total, fiatCurrency } = await client.portfolio()
console.log(entries[0], total, fiatCurrency) // { currency: 'TON', amount: '120.5', fiatValue: 381.2 } 1250.4 USD
await source.disconnect()
```

## Examples

- [Connecting](examples/connecting.md): Telegram credentials, token storage, refreshing without Telegram, retries and pacing
- [Balances](examples/balances.md): accounts, portfolio, profit and loss, staked funds
- [Prices](examples/prices.md): coin rates, charts and past prices
- [Exchange](examples/exchange.md): available pairs, quotes, exchanges and limit orders
- [Transactions](examples/transactions.md): history, details and reading a transaction
- [Errors](examples/errors.md): `WaltRequestError`, `WaltAuthError` and what is retried
- [Command line](examples/cli.md): the read-only `walt` command for balances, history, prices and orders

A runnable script is in [examples/portfolio.ts](examples/portfolio.ts).

## API

```ts
new TelegramTokenSource(options: TelegramTokenSourceOptions)

type TelegramTokenSource = {
  token(rejected?: string): Promise<string>
  disconnect(): Promise<void>
}

new RefreshTokenSource(options: RefreshTokenSourceOptions)

type RefreshTokenSource = {
  token(rejected?: string): Promise<string>
}

new WaltClient(options: WaltClientOptions)

type WaltClient = {
  accounts(): Promise<AccountsResponse>
  portfolio(): Promise<Portfolio>
  balances(fiatCurrency: FiatCurrency): Promise<Balances>
  pnl(): Promise<PnlResponse>
  portfolioHistory(dateFrom: Date | string, resolution: '1d' | '1m'): Promise<PortfolioHistory>
  frozenBalances<T = unknown>(): Promise<T[]>

  earnCampaigns(): Promise<EarnCampaignsResponse>
  earnCampaignTransactions(campaignId: number | string, limit?: number, after?: EarnTransactionsPage): Promise<EarnTransactionsPage>
  allEarnCampaignTransactions(campaignId: number | string, limit?: number): AsyncGenerator<EarnTransaction>
  earnRate(from: string, to: string): Promise<EarnRate>

  coins(fiatCurrency: FiatCurrency): Promise<Coin[]>
  coinDetails(currency: string, fiatCurrency: FiatCurrency): Promise<CoinDetails>
  charts(currency: string, fiatCurrency: FiatCurrency): Promise<Charts>
  priceForFiatAtTime(crypto: string, fiat: FiatCurrency, amount: number | string, time: Date | string | number): Promise<PriceAtTime>
  localCurrency(): Promise<FiatCurrency>
  candles(requests: CandleRequest[]): Promise<CandleSeries[]>

  availableExchanges(): Promise<AvailableExchanges>
  quote(fromCurrency: string, toCurrency: string, fromAmount: number): Promise<ExchangeQuote>
  createExchange(request: ExchangeRequest): Promise<Exchange> // moves real money, never retried

  limitOrders(options?: { status?: string[]; limit?: number }): Promise<LimitOrder[]>
  limitOrder(id: string): Promise<LimitOrder>
  limitOrderQuote(baseCurrency: string, side: 'BUY' | 'SELL', priceLimit: number | string, size: { amount: number | string } | { quantity: number | string }): Promise<LimitOrderQuote>
  limitOrderBounds(baseCurrency: string): Promise<LimitOrderBounds>
  limitOrderTokens(): Promise<LimitOrderToken[]>

  perpContracts(contractId?: number): Promise<PerpContract[]>
  perpSystemStatus(): Promise<PerpSystemStatus>
  perpPositions(options?: { statuses?: PerpPositionStatus[]; contractId?: number }): Promise<PerpPosition[]>
  perpOrders(options?: { contractId?: number; statuses?: PerpOrderStatus[]; limit?: number }): Promise<PerpOrdersPage>

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
