# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added `portfolioHistory()` to read balance, profit and loss, deposits and withdrawals per day or month
- Added `limitOrders()`, `limitOrder()`, `limitOrderQuote()`, `limitOrderBounds()` and `limitOrderTokens()` to read limit orders
- Added `allEarnCampaignTransactions()` to read every deposit, withdrawal and payout in a campaign
- `earnCampaignTransactions()` can now take a page size and fetch the page after a given one
- Added `body` to `WaltRequestError` with the response body, parsed when it is JSON
- Added the `authUrl` option to `TelegramTokenSource`
- Added `limit_swap`, `payment_link` and four more values to `TransactionGateway`
- Added `payment_link_id` and `tg_transfer_status` to `TransactionDetails`
- Added `mira_summary` to `CoinDetails`, and `account_id` to `EarnAccount` and `EarnBonus`

### Changed

- `tokenProvider` is now called with the rejected token after a 401, and `TelegramTokenSource.token()` renews it
- Sign-in now goes to `alectryon.walletbot.me` and registers the device serial like the Walt app
- Requests now carry the Chrome 156 browser headers, sign-in requests included
- A response that is not JSON now throws `WaltRequestError` instead of `SyntaxError`
- `new WaltClient()` now throws a `RangeError` for a `maxConcurrent` below 1 or an invalid `retries`
- **Breaking:** the `WaltRequestError` constructor takes the response body as its fourth argument. Pass `null` when there is none.

### Fixed

- Fixed requests failing with `WaltAuthError` after the API revoked a token that had not expired
- Fixed tokens being rejected early when the local clock runs behind
- Fixed a network error during token refresh forcing a new Telegram sign-in
- Fixed `allTransactions()` and `allAccountTransactions()` looping forever when the API repeats a cursor

## [0.1.0] - 2026-10-31

### Highlights

- **Portfolio tracking:** read balances, prices, transaction history, profit and loss, and staked funds.
- **Exchange:** quote and perform exchanges between assets.

### Added

- Added `WaltClient` with the `tokenProvider`, `baseUrl` and `fetch` options
- Added `TelegramTokenSource` to sign in over Telegram and renew tokens automatically
- Added the `storage` option to `TelegramTokenSource` to reuse tokens across restarts
- Added `accounts()`, `portfolio()`, `pnl()` and `frozenBalances()` to read balances
- Added `earnCampaigns()`, `earnCampaignTransactions()` and `earnRate()` to read staked funds
- Added `coins()`, `coinDetails()`, `charts()`, `priceForFiatAtTime()` and `localCurrency()` to read prices
- Added `availableExchanges()`, `quote()` and `createExchange()` to exchange between assets
- Added `transactions()`, `accountTransactions()`, `transactionDetails()` and `unconfirmedTransactions()`
- Added `allTransactions()` and `allAccountTransactions()` to read a whole transaction history
- Added `detailsFor()` to look up details for many transactions at once
- Added `normalizeTransaction()` to split a transaction into received, sent and fee legs
- Added retries with backoff on 429, 502, 503 and 504, set by `retries` and `retryDelayMs`
- Added the `maxConcurrent` option to limit how many requests run at once
- Added `WaltRequestError` with the HTTP `status`, and `WaltAuthError` for rejected tokens
