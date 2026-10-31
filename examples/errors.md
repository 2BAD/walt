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

A failed request throws `WaltRequestError`. Its `status` is `0` when there was no response.

## `WaltAuthError`

On a 401 the client fetches a new token and replays the request once. If that is rejected too, it throws
`WaltAuthError`.

## Retries

429, 502, 503, 504 and requests with no response are retried with exponential backoff. A `retry-after` header from
the server replaces the backoff.

500 is not retried. The API returns it for bad requests, such as a malformed cursor.

`createExchange()` is never retried.

## Flood wait

`TelegramTokenSource` waits out a Telegram `FLOOD_WAIT` once when it is shorter than `maxFloodWaitMs`. A longer one
throws.
