# Errors

```ts
import { WaltAuthError, WaltError, WaltRequestError } from '@2bad/walt'

try {
  await client.portfolio()
} catch (error) {
  if (error instanceof WaltRequestError) console.log(error.status) // 404
  else if (error instanceof WaltAuthError) console.log('sign in again')
  else if (error instanceof WaltError) console.log(error.message) // accounts total is not a number: undefined
}
```

`WaltAuthError` and `WaltRequestError` extend `WaltError`. A plain `WaltError` means a response the client could not use.

## `WaltRequestError`

`status` is `0` when there was no response.

`body` holds the response body, parsed when it is JSON.

```ts
if (error instanceof WaltRequestError) console.log(error.body) // { code: 'market_order_max_limit_error', detail: '...' }
```

## Retries

429, 502, 503, 504 and network failures are retried.

A 500 is not retried.

`createExchange()` is never retried.
