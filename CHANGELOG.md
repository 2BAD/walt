# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-11-07

### Highlights

- **Command line:** the read-only `walt` command shows balances, history, prices, quotes, orders, perps and earn.
- **Perpetual futures:** read contracts, open and closed positions, and orders.

### Added

- Added `balances()`, which includes USDT held by open limit orders
- Added `perpContracts()`, `perpSystemStatus()`, `perpPositions()` and `perpOrders()` to read perpetual futures
- Added `candles()` to fetch price candles for several assets in one request
- Added the read-only `walt` command for balances, history, transactions, prices, quotes, orders, perps and earn

### Removed

- **Breaking:** Removed the `telegram-login` command. Use `walt login` instead.

## [1.0.1] - 2026-11-02

### Fixed

- Fixed `telegram-login` failing with a misleading error when the API id is not a number

## [1.0.0] - 2026-11-02

### Highlights

- **Portfolio tracking:** read balances, prices, transaction history, profit and loss, and staked funds.
- **Exchange:** quote and perform exchanges between assets.
- **Limit orders:** read open and past limit orders, quotes and price bounds.

### Added

- Added `WaltClient` with the `tokenProvider`, `baseUrl` and `fetch` options
- `tokenProvider` is called again with the rejected token after a 401
- Added `TelegramTokenSource` to sign in over Telegram and renew tokens automatically
- Added the `storage` option to `TelegramTokenSource` to reuse tokens across restarts
- Added the `authUrl` option to `TelegramTokenSource`
- Added `accounts()`, `portfolio()`, `pnl()` and `frozenBalances()` to read balances
- Added `portfolioHistory()` to read balance, profit and loss, deposits and withdrawals per day or month
- Added `earnCampaigns()`, `earnCampaignTransactions()` and `earnRate()` to read staked funds
- Added `allEarnCampaignTransactions()` to read every deposit, withdrawal and payout in a campaign
- Added `coins()`, `coinDetails()`, `charts()`, `priceForFiatAtTime()` and `localCurrency()` to read prices
- Added `availableExchanges()`, `quote()` and `createExchange()` to exchange between assets
- Added `limitOrders()`, `limitOrder()`, `limitOrderQuote()`, `limitOrderBounds()` and `limitOrderTokens()` to read limit orders
- Added `transactions()`, `accountTransactions()`, `transactionDetails()` and `unconfirmedTransactions()`
- Added `allTransactions()` and `allAccountTransactions()` to read a whole transaction history
- Added `detailsFor()` to look up details for many transactions at once
- Added `normalizeTransaction()` to split a transaction into received, sent and fee legs
- Added retries with backoff on 429, 502, 503 and 504, set by `retries` and `retryDelayMs`
- Added the `maxConcurrent` option to limit how many requests run at once
- Added `WaltRequestError` with the HTTP `status` and response `body`, and `WaltAuthError` for rejected tokens
