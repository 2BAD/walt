# @2bad/wallet

Client for the Telegram Wallet API. Fetches balances, coin rates and charts, transaction history, profit and
loss, and a rolled-up portfolio, and can quote and perform exchanges between assets.

## Install

```bash
pnpm add @2bad/wallet
```

## Usage

`WalletClient` needs a `tokenProvider`. `TelegramTokenSource` is the one that ships with the package: it signs
into the Wallet mini app over MTProto, so it needs a Telegram session string plus API credentials from
[my.telegram.org](https://my.telegram.org):

```ts
import { TelegramTokenSource, WalletClient } from '@2bad/wallet'

const source = new TelegramTokenSource({
  session: process.env.WALLET_TG_SESSION,
  apiId: Number(process.env.TG_API_ID),
  apiHash: process.env.TG_API_HASH
})

const client = new WalletClient({ tokenProvider: () => source.token() })
const { entries, total, fiatCurrency } = await client.portfolio()
```

`TelegramTokenSource` renews the token 30s before it expires, preferring its refresh token and falling back to
a full re-authentication. `WalletClient` caches whatever it is handed, drops it and retries once on a 401, and
throws `WalletAuthError` if the second attempt is rejected too. Both collapse concurrent callers onto a single
in-flight authentication, so fanning out requests with a cold cache costs one sign-in rather than one each.

Without `storage` the token lives only in memory, so every process start re-authenticates over MTProto. Pass
one to survive restarts:

```ts
const source = new TelegramTokenSource({
  session,
  apiId,
  apiHash,
  storage: {
    load: async () => JSON.parse(await readFile(cacheFile, 'utf8')) as TokenState,
    save: (state) => writeFile(cacheFile, JSON.stringify(state), { mode: 0o600 })
  }
})
```

That persists the token, refresh token, session id and `deviceSerial` together, so a restart reuses a valid
token outright, or refreshes without a Telegram round trip. Treat the file like `.env`: it holds live
credentials. See `examples/portfolio.ts` for a working version.

If `RequestWebView` returns `FLOOD_WAIT`, the source waits and retries once when the delay is under
`maxFloodWaitMs` (default 60s), and throws otherwise rather than sleeping for hours.

Any `() => Promise<string>` works as a `tokenProvider`, so you can supply tokens another way. Bear in mind a
static token has no way to renew itself, and the client will throw once it expires.

### Retries and pacing

Sustained reading gets rate limited, so the client paces itself:

```ts
new WalletClient({
  tokenProvider,
  retries: 3,        // extra attempts on a transient failure, 0 disables
  retryDelayMs: 500, // base for the exponential backoff between them
  maxConcurrent: 4   // requests in flight at once, Infinity removes the limit
})
```

Retries cover 429, 502, 503, 504 and a request that never got a response at all, with exponential backoff and
jitter. A `retry-after` header is used instead of the backoff when the server sends one. **500 is deliberately
not retried**: this API answers a malformed cursor with one, so it means a bad request rather than a bad
moment.

A failed request throws `WalletRequestError`, which carries the `status` (`0` when there was no response) so
callers can branch without matching on the message. A 401 is separate and unchanged: the token is dropped and
the request replayed once, then `WalletAuthError` if it is rejected again.

`maxConcurrent` queues rather than rejects, so firing a batch is safe:

```ts
const details = await Promise.all(ids.map((id) => client.transactionDetails(id)))
```

## API

Every method is a thin typed call, and all but `quote()` and `createExchange()` are GETs. Only `portfolio()`
derives anything; the rest hand back what the API returned, with response fields kept in the API's own
`snake_case`.

### Balances

```ts
accounts(): Promise<AccountsResponse>
portfolio(): Promise<Portfolio>
pnl(): Promise<PnlResponse>
frozenBalances<T = unknown>(): Promise<T[]>
```

`accounts()` returns every currency the account can hold, including the ones with a zero balance.
`portfolio()` is the convenience view over it: non-zero balances only, sorted by fiat value, with the total
and the account's display currency.

An `Account` row carries more than a balance. `category` classifies the asset, `onchain`, `stock` or `etf` on
the account these types came from, which is the field to group by rather than guessing from the ticker - the
tokenized equities all end in `x`, but so do the ETFs:

```ts
const { accounts } = await client.accounts()
const equities = accounts.filter((account) => account.category === 'stock')
```

It is typed `string` rather than a union of those three, for the same reason as every other response enum
here: a value added later would make the narrower type a lie. `addresses` holds the deposit addresses per
network, `actions` which operations the account allows, and `description` and `market_cap` the display data
the app shows.

`pnl()` adds performance rather than position - absolute and percentage change over 24h and all time, per
holding and as a total.

`portfolio()` entries do not add up to its `total`, and that is the API's arithmetic rather than ours. Every
row `accounts()` returns is the spot wallet, while the total also covers staked funds that have no row of
their own. It is the figure the Wallet app itself displays. Rather than leave that to a footnote, the return
carries both numbers and their difference:

```ts
const { entries, entriesTotal, total, staked } = await client.portfolio()
// entries      spot balances above zero
// entriesTotal what they add up to
// total        the API's own figure, spot and staked
// staked       total - entriesTotal
```

`staked` is derived by subtraction, so it is whatever the API counted without handing back a row for it. On
the account these types came from that was the earn balance to within 0.03%. Expect a few cents either way
from rounding when nothing is staked, and use `earnCampaigns()` to itemise it.

### Earn

```ts
earnCampaigns(): Promise<EarnCampaignsResponse>
earnCampaignTransactions(campaignId: number | string): Promise<EarnTransactionsPage>
earnRate(from: string, to: string): Promise<EarnRate>
```

This is the staked side `accounts()` leaves out, and the reason its rows fall short of its own total.
`earnCampaigns()` returns every campaign; `account` is populated only on the ones this wallet has joined, and
`account.balance` is the staked quantity:

```ts
const { campaigns } = await client.earnCampaigns()
const staked = campaigns.filter((campaign) => campaign.account !== null)
```

Priced up, those balances account for the difference between the spot rows and the stated total, apart from
rate drift between the two calls.

Not every staking asset is quoted by `coins()` - `USDe` is not - which is what `earnRate()` is for. It also
reports how far a stablecoin has drifted from its peg, in `depeg_info`.

`earnCampaignTransactions()` covers deposits, withdrawals and payouts inside a campaign. These are not in
`transactions()`, which sees only the spot leg of a move into or out of earn. The response carries three
separate cursors, one per source; the method returns the first page and does not follow them yet.

`pnl()` also reports the staked positions, as ones whose `account_type` is not `bank_account`, but only
`earnCampaigns()` gives the balance, the rate and the terms.

`portfolio()` throws rather than returning `NaN` if a balance or total is not a parseable decimal string.

### Prices and charts

```ts
coins(fiatCurrency: FiatCurrency): Promise<Coin[]>
coinDetails(currency: string, fiatCurrency: FiatCurrency): Promise<CoinDetails>
charts(currency: string, fiatCurrency: FiatCurrency): Promise<Charts>
priceForFiatAtTime(
  cryptoCurrency: string,
  localCurrency: FiatCurrency,
  amount: number | string,
  time: Date | string | number
): Promise<PriceAtTime>
localCurrency(): Promise<FiatCurrency>
```

`FiatCurrency` is the 60-code set the API accepts. There is no default: pass one explicitly, or read the
account's own with `localCurrency()`.

`charts()` returns five fixed series - `day`, `week`, `month`, `year`, `all` - in one response.
`priceForFiatAtTime()` values an amount at a past moment; a `Date` is serialised for you.

```ts
const fiat = await client.localCurrency()
const { all } = await client.charts('TON', fiat)
const then = await client.priceForFiatAtTime('TON', fiat, 100, new Date('2026-01-01'))
```

### Exchange

```ts
availableExchanges(): Promise<AvailableExchanges>
quote(fromCurrency: string, toCurrency: string, fromAmount: number): Promise<ExchangeQuote>
createExchange(request: ExchangeRequest): Promise<Exchange>
```

`availableExchanges()` maps every currency to what it can be exchanged with. Nearly everything pairs with
`TON` and `USDT`, on-chain coins also with `XLM`, and the list is what the app offers rather than what the
server enforces: it quoted `BTC` to `ETH` although neither lists the other.

`quote()` prices an exchange without performing it. The `rate` it returns is the one an exchange executes at,
with the spread already in it, so it is the number to watch for a price trigger rather than the display rate
on `coins()` or `accounts()`. `min_amount` and `max_amount` bound `from_amount`; `max_amount` is the balance
when selling and the platform limit when buying. An amount of `0` returns the rate and the limits alone, and
the server does not reject an amount under the minimum at this step, only one over the maximum with a 400.

```ts
const { rate, min_amount, max_amount } = await client.quote('USDT', 'NVDAx', 0)
```

`createExchange()` performs an exchange and moves real money. It executes immediately, with no confirm step,
and the response carries both balances after the trade, the fee, and the `rate` it filled at. It is the one
request the client never retries, because a timeout after the server has committed the trade would otherwise
execute it twice. If it throws `WalletRequestError`, check the balances before trying again.

```ts
const filled = await client.createExchange({
  from_currency: 'USDT',
  to_currency: 'NVDAx',
  from_amount: 25,
  local_currency: 'USD'
})
```

`max_amount: true` marks a sale of the whole balance, which is what the app sends when selling everything.
Amounts in these three responses are numbers, unlike the decimal strings everywhere else in the API.

### Transactions

```ts
transactions(cursor?: string, limit?: number): Promise<TransactionsPage>
accountTransactions(currency: string, limit?: number, cursor?: string): Promise<TransactionsPage>
allTransactions(limit?: number): AsyncGenerator<Transaction>
allAccountTransactions(currency: string, limit?: number): AsyncGenerator<Transaction>
transactionDetails(id: number | string, gateway?: TransactionGateway): Promise<TransactionDetails>
detailsFor(transactions: AsyncIterable<Transaction> | Iterable<Transaction>): AsyncGenerator<TransactionDetails>
unconfirmedTransactions<T = unknown>(limit?: number): Promise<{ transactions: T[]; size: number }>
```

To read a whole listing, use the `all*` generators. They stop on the first empty page:

```ts
for await (const transaction of client.allTransactions(100)) {
  console.log(transaction.id, transaction.gateway, transaction.amount, transaction.currency)
}

const rows = await Array.fromAsync(client.allAccountTransactions('TON'))
```

Both paged methods are still there if you want a single page at a time: read `next_cursor` off a page and
pass it back. Pass back only a cursor the API gave you, since a malformed one is a 500 rather than a
validation error.

Do not drive that loop with `while (page.next_cursor)`. Past the last row the API keeps returning a fresh
`next_cursor` alongside an empty `transactions` array, and it does so indefinitely - a walk of one real
account ran 5000 pages past the end without ever seeing null. `next_cursor` is typed `string | null` because
the field can hold null, not because you will be handed one. Stop when a page comes back empty.

```ts
let page = await client.transactions(undefined, 50)
const rows = [...page.transactions]
while (page.transactions.length > 0 && page.next_cursor !== null) {
  page = await client.transactions(page.next_cursor, 50)
  rows.push(...page.transactions)
}
```

`transactionDetails()` returns a much wider record than a list row - fees, exchange rate, the paired side of a
conversion, on-chain destination and hash. Pass the `gateway` of the matching list row: it is optional for
most gateways, but an `xstocks_dividends` record returns 404 without it. The argument accepts any string, not
only the values in `TransactionGateway`, because a list row's `gateway` may carry one added since.

To hydrate a whole listing, `detailsFor()` looks up several at a time and yields in the order the rows
arrived:

```ts
for await (const details of client.detailsFor(client.allTransactions(100))) {
  const { received, sent } = normalizeTransaction(details)
}
```

It takes an array just as happily as a listing, so you can filter first. `maxConcurrent` governs how many
lookups run at once. A lookup that still fails after its retries stops the walk rather than skipping a row,
so a summed result is never quietly short.

### Reading a transaction

```ts
normalizeTransaction(details: TransactionDetails): NormalizedTransaction
```

The raw record is easy to read backwards, so this turns one into directional legs:

```ts
const details = await client.transactionDetails(10000000000001, 'crypto_exchange')
const { received, sent, fee } = normalizeTransaction(details)
// received { currency: 'USDT', amount: '1000.000000' }
// sent     { currency: 'BTC',  amount: '0.010000000000' }
```

Three things it takes care of. `type` is relative to the wallet, so the deposit above is a *sale* of BTC, not a
purchase. `pair_transaction_*` is a real second leg only when its currency differs from `crypto_currency`; on
every gateway except `crypto_exchange` it repeats the same asset back, sometimes as a gross amount against a
net `crypto_amount`. And `crypto_amount` already has `fee_amount` taken out, so `fee` is reported for the
record but must not be subtracted again.

It needs a `transactionDetails()` record rather than a listing row: rows carry
`pair_transaction_currency` but not `pair_transaction_amount`, so the second leg cannot be recovered from one.

Summing the legs of every transaction reproduces the live account balances exactly, which is the check to
repeat if any of this changes.

`frozenBalances()` and `unconfirmedTransactions()` are generic because their element shape is unverified: the
account used to derive these types has never held either. The container is typed, the rows are yours to
describe.

### A note on the types

The Wallet API is undocumented and publishes no response schemas, so every type here was derived from real
responses and checked field by field against a live account. They are accurate for what has been observed, and
deliberately loose where it has not - nullable rather than narrow, `string` rather than a union that a future
value would break. Treat them as a good map rather than a guarantee.

## Request headers

Requests carry the same header set the Wallet web app sends: its `user-agent` and `sec-ch-ua` pair, the
`sec-fetch-*` and `priority` hints, `dnt`/`sec-gpc`, a `referer` on the configured origin, and the Sentry
tracing trio. `sentry-trace` and `traceparent` get fresh random span ids per request, with one trace id per
client instance, the way a single browser session behaves.

The Chrome version and the `sentry-release` in `baggage` are pinned constants in `source/client.ts`. They are a
snapshot of a real session and will drift as the web app ships; re-capture and bump them if that matters to
you.

## Getting credentials

Run `pnpm telegram:login` once to complete an interactive Telegram sign-in and print a session string for
`WALLET_TG_SESSION`.

The session string grants access to the account. Keep it out of version control; the example reads it
from `.env`.

## Scripts

```bash
pnpm build            # compile to ESM + generate .d.ts
pnpm test             # run all tests
pnpm test:unit        # unit tests with coverage
pnpm check            # lint, format and type check
pnpm fix              # auto-fix lint + formatting
pnpm telegram:login   # interactive Telegram sign-in, prints a session string
pnpm example          # print a portfolio using a Telegram session
```

## Project Structure

```
source/     # source code, tests co-located
examples/   # runnable usage samples
scripts/    # credential helpers
build/      # compiled output (generated)
```

## Requirements

- Node.js >= 26
- pnpm >= 11

## License

MIT
