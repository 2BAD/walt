# @2bad/wallet

Read-only client for the Telegram Wallet API. Fetches balances, coin rates and charts, transaction history,
profit and loss, and a rolled-up portfolio.

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

## API

Every method is a typed GET. Only `portfolio()` derives anything; the rest hand back what the API returned,
with response fields kept in the API's own `snake_case`.

### Balances

```ts
accounts(): Promise<AccountsResponse>
portfolio(): Promise<{ entries: PortfolioEntry[]; total: number; fiatCurrency: string }>
pnl(): Promise<PnlResponse>
frozenBalances<T = unknown>(): Promise<T[]>
```

`accounts()` returns every currency the account can hold, including the ones with a zero balance.
`portfolio()` is the convenience view over it: non-zero balances only, sorted by fiat value, with the total
and the account's display currency.

`pnl()` adds performance rather than position - absolute and percentage change over 24h and all time, per
holding and as a total.

`portfolio()` entries do not necessarily add up to its `total`, and that is the API's arithmetic rather than
ours. Every row `accounts()` returns is the spot wallet, while the total also covers staked funds that have no
row of their own, so the total can exceed the entries. It is the figure the Wallet app itself displays. `pnl()`
is where the staked side shows up, as positions whose `account_type` is not `bank_account`.

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

### Transactions

```ts
transactions(cursor?: string, limit?: number): Promise<TransactionsPage>
accountTransactions(currency: string, limit?: number, cursor?: string): Promise<TransactionsPage>
allTransactions(limit?: number): AsyncGenerator<Transaction>
allAccountTransactions(currency: string, limit?: number): AsyncGenerator<Transaction>
transactionDetails(id: number | string, gateway?: TransactionGateway): Promise<TransactionDetails>
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
conversion, on-chain destination and hash. Its `gateway` argument is optional and narrows the lookup to one
transaction type; the `gateway` field of a list row is the value to pass.

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
pnpm check            # lint + format check
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
