# @2bad/wallet

Read-only client for the Telegram Wallet API. Fetches accounts, coin rates, transactions, and a rolled-up portfolio.

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
throws `WalletAuthError` if the second attempt is rejected too.

Any `() => Promise<string>` works as a `tokenProvider`, so you can supply tokens another way. Bear in mind a
static token has no way to renew itself, and the client will throw once it expires.

## Getting credentials

Run `pnpm login:telegram` once to complete an interactive Telegram sign-in and print a session string for
`WALLET_TG_SESSION`.

The session string grants access to the account. Keep it out of version control; the example reads it
from `.env`.

## Scripts

```bash
pnpm build            # compile to ESM + generate .d.ts
pnpm test             # run all tests
pnpm test:unit        # unit tests with coverage
pnpm test:integration # integration tests with coverage
pnpm check            # lint + format check
pnpm fix              # auto-fix lint + formatting
pnpm login:telegram   # interactive Telegram sign-in, prints a session string
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
