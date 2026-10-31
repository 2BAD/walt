import { describe, expect, it } from 'vitest'
import { TelegramTokenSource, WaltAuthError, WaltClient } from '~/index.ts'

describe('index', () => {
  it('exposes the public surface', () => {
    expect.assertions(3)

    expect(WaltClient).toBeTypeOf('function')
    expect(TelegramTokenSource).toBeTypeOf('function')
    expect(WaltAuthError.prototype).toBeInstanceOf(Error)
  })
})
