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
  storage, // custom token store, false keeps the token in memory
  deviceSerial, // reuse a device id from an earlier session
  fetch // custom fetch implementation
})
```

Call `source.disconnect()` before the process exits.

## Token storage

The token is cached in `~/.cache/walt/`, or `$XDG_CACHE_HOME/walt/` when that is set. A restart reuses it without signing in
over Telegram again.

The cache file holds live credentials. Only your user can read it.

To keep the token somewhere else, such as a database, pass your own `load` and `save`.

```ts
const source = new TelegramTokenSource({
  session,
  apiId,
  apiHash,
  storage: {
    load: () => db.get('walt-token'),
    save: (state) => db.set('walt-token', state)
  }
})
```

Pass `storage: false` to keep the token in memory only.

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
