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

`body` holds the response body, parsed when it is JSON.

```ts
if (error instanceof WaltRequestError) console.log(error.body) // { code: 'market_order_max_limit_error', detail: '...' }
```

## Retries

429, 502, 503, 504 and network failures are retried.

A 500 is not retried. It means a bad request, such as a malformed cursor.

`createExchange()` is never retried.
