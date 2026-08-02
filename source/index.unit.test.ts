import { describe, expect, it } from 'vitest'
import { TelegramTokenSource, WalletAuthError, WalletClient } from '~/index.ts'

describe('index', () => {
  it('exposes the public surface', () => {
    expect.assertions(3)

    expect(WalletClient).toBeTypeOf('function')
    expect(TelegramTokenSource).toBeTypeOf('function')
    expect(WalletAuthError.prototype).toBeInstanceOf(Error)
  })
})
