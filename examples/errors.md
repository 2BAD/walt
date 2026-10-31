# Errors

```ts
import { WaltAuthError, WaltRequestError } from '@2bad/walt'

try {
  await client.accounts()
} catch (error) {
  if (error instanceof WaltRequestError) console.log(error.status) // 404
  if (error instanceof WaltAuthError) console.log('sign in again')
}
```

## `WaltRequestError`

`status` is `0` when there was no response.

## `WaltAuthError`

Thrown when the API rejects a freshly fetched token.

## Retries

429, 502, 503, 504 and network failures are retried.

A 500 is not retried. It means a bad request, such as a malformed cursor.

`createExchange()` is never retried.

## Flood wait

A Telegram `FLOOD_WAIT` longer than `maxFloodWaitMs` throws.
