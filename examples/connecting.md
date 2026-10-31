# Connecting

```ts
import { TelegramTokenSource, WaltClient } from '@2bad/walt'

const source = new TelegramTokenSource({
  session: process.env.WALLET_TG_SESSION ?? '',
  apiId: Number(process.env.TG_API_ID),
  apiHash: process.env.TG_API_HASH ?? ''
})

const client = new WaltClient({ tokenProvider: () => source.token() })
```

## Credentials

Get `apiId` and `apiHash` from [my.telegram.org](https://my.telegram.org).

Run `pnpm telegram:login` in a clone of this repository to sign in once and print a session string.

The session string grants full access to the account. Keep it out of version control.

## `TelegramTokenSource`

```ts
const source = new TelegramTokenSource({
  session, // Telegram session string
  apiId,
  apiHash,

  // optional, values are the defaults
  bot: 'walt', // bot that hosts the mini app
  baseUrl: 'https://walletbot.me',
  maxFloodWaitMs: 60_000, // longest FLOOD_WAIT to wait out before throwing

  // optional, off by default
  storage, // keeps the token across restarts
  deviceSerial, // reuse a device id from an earlier session
  fetch // custom fetch implementation
})
```

Tokens are renewed before they expire.

Call `source.disconnect()` before the process exits.

## Token storage

Without `storage`, every process start signs in over Telegram again.

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { type TokenState, TelegramTokenSource } from '@2bad/walt'

const source = new TelegramTokenSource({
  session,
  apiId,
  apiHash,
  storage: {
    load: async () => JSON.parse(await readFile('.walt-token.json', 'utf8')) as TokenState,
    save: (state) => writeFile('.walt-token.json', JSON.stringify(state), { mode: 0o600 })
  }
})
```

The stored state holds live credentials. Treat the file like `.env`.

## `WaltClient`

```ts
const client = new WaltClient({
  tokenProvider: () => source.token(),

  // optional, values are the defaults
  retries: 3, // extra attempts on a transient failure, 0 disables
  retryDelayMs: 500, // base of the exponential backoff
  maxConcurrent: 4, // requests in flight at once, Infinity removes the limit
  baseUrl: 'https://walletbot.me',

  // optional, off by default
  fetch // custom fetch implementation
})
```

Sustained reading gets rate limited. Lower `maxConcurrent` if you see 429 errors.

Extra requests wait in a queue. Firing a large batch is safe.

```ts
const details = await Promise.all(ids.map((id) => client.transactionDetails(id)))
```

## Other token providers

Any `() => Promise<string>` works as `tokenProvider`.

A static token cannot renew itself. The client throws `WaltAuthError` once it expires.

```ts
const client = new WaltClient({ tokenProvider: async () => 'JWT' })
```
