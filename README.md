# @2bad/wallet

Read-only client for the Telegram Wallet API. Fetches accounts, coin rates, transactions, and a rolled-up portfolio.

## Install

```bash
pnpm add @2bad/wallet
```

## Usage

With a token from an authenticated Wallet session:

```ts
import { WalletClient } from '@2bad/wallet'

const client = new WalletClient({ token: process.env.WALLET_TOKEN })
const { entries, total, fiatCurrency } = await client.portfolio()
```

To let the client mint and refresh its own tokens, hand it a `TelegramTokenSource`. It signs into the Wallet
mini app over MTProto, so it needs a Telegram session string plus API credentials from
[my.telegram.org](https://my.telegram.org):

```ts
import { TelegramTokenSource, WalletClient } from '@2bad/wallet'

const source = new TelegramTokenSource({
  session: process.env.WALLET_TG_SESSION,
  apiId: Number(process.env.TG_API_ID),
  apiHash: process.env.TG_API_HASH
})

const client = new WalletClient({ tokenProvider: () => source.token() })
```

`WalletClient` caches the token, retries once on a 401, and throws `WalletAuthError` when it cannot recover.

## Getting credentials

Run `pnpm login:telegram` once to complete an interactive Telegram sign-in and print a session string for
`WALLET_TG_SESSION`.

Both the session string and the token grant access to the account. Keep them out of version control; the
example scripts read them from `.env`.

## Scripts

```bash
pnpm build            # compile to ESM + generate .d.ts
pnpm test             # run all tests
pnpm test:unit        # unit tests with coverage
pnpm test:integration # integration tests with coverage
pnpm check            # lint + format check
pnpm fix              # auto-fix lint + formatting
pnpm login:telegram   # interactive Telegram sign-in, prints a session string
pnpm example          # print a portfolio using WALLET_TOKEN
pnpm example:auto     # print a portfolio using a Telegram session
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
