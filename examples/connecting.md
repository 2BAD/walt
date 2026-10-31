# Connecting

```ts
import { TelegramTokenSource, WaltClient } from '@2bad/walt'

const source = new TelegramTokenSource({
  session: process.env.TG_SESSION ?? '',
  apiId: Number(process.env.TG_API_ID),
  apiHash: process.env.TG_API_HASH ?? ''
})

const client = new WaltClient({ tokenProvider: () => source.token() })
```

## Credentials

Get `apiId` and `apiHash` from [my.telegram.org](https://my.telegram.org).

Sign in once to get a session string.

```sh
npx -p @2bad/walt telegram-login
```

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

Call `source.disconnect()` before the process exits.

## Token storage

With `storage`, a restart skips the Telegram sign-in.

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

Keep the file as private as `.env`.

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

Lower `maxConcurrent` if you see 429 errors.

Firing a large batch at once is safe.

```ts
const details = await Promise.all(ids.map((id) => client.transactionDetails(id)))
```

## Other token providers

Any `() => Promise<string>` works as `tokenProvider`.

```ts
const client = new WaltClient({ tokenProvider: async () => 'JWT' })
```

A static token throws `WaltAuthError` once it expires.
