import { describe, expect, it, vi } from 'vitest'
import { WalletAuthError, WalletClient } from '~/client.ts'

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const makeClient = (fetchImpl: FetchMock, token = 'jwt.token.value') =>
  new WalletClient({ tokenProvider: async () => token, fetch: fetchImpl })

const authHeaderOf = (fetchImpl: FetchMock, call = 0) => {
  const [, options] = fetchImpl.mock.calls[call] ?? []
  return (options?.headers as Record<string, string> | undefined)?.['authorization']
}

describe('walletClient', () => {
  it('requires a tokenProvider', () => {
    expect.assertions(1)

    expect(() => new WalletClient({} as unknown as { tokenProvider: () => Promise<string> })).toThrow(WalletAuthError)
  })

  it('sends the raw token in the Authorization header (no Bearer prefix)', async () => {
    expect.assertions(2)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    await makeClient(fetchImpl).accounts()

    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/api/v1/accounts/')
    expect(authHeaderOf(fetchImpl)).toBe('jwt.token.value')
  })

  it('strips a leading Bearer prefix from the provided token', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    await makeClient(fetchImpl, 'Bearer jwt.token.value').accounts()

    expect(authHeaderOf(fetchImpl)).toBe('jwt.token.value')
  })

  it('asks the provider only once while the token keeps working', async () => {
    expect.assertions(1)

    const tokenProvider = vi.fn<() => Promise<string>>(async () => 'jwt.token.value')
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    const client = new WalletClient({ tokenProvider, fetch: fetchImpl })

    await client.accounts()
    await client.accounts()

    expect(tokenProvider).toHaveBeenCalledTimes(1)
  })

  it('builds a portfolio from the accounts response', async () => {
    expect.assertions(3)

    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        available_balance_total_fiat_amount: '150.00',
        available_balance_total_fiat_currency: 'USD',
        accounts: [
          { currency: 'TON', available_balance: '10', available_balance_fiat_amount: '50.00' },
          { currency: 'BTC', available_balance: '0.001', available_balance_fiat_amount: '100.00' },
          { currency: 'ETH', available_balance: '0', available_balance_fiat_amount: '0.00' }
        ]
      })
    )

    const { entries, total, fiatCurrency } = await makeClient(fetchImpl).portfolio()

    expect(entries.map((entry) => entry.currency)).toStrictEqual(['BTC', 'TON'])
    expect(total).toBe(150)
    expect(fiatCurrency).toBe('USD')
  })

  it('unwraps the coins list', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ coins: [{ currency: 'BTC', rate: '62000' }] }))
    const coins = await makeClient(fetchImpl).coins('USD')

    expect(coins[0]?.currency).toBe('BTC')
  })

  it('passes an encoded cursor to the transactions endpoint', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ transactions: [] }))
    await makeClient(fetchImpl).transactions('next/page 2')

    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/api/v1/transactions/?cursor=next%2Fpage%202')
  })

  it('throws on a non-401 error status', async () => {
    expect.assertions(1)

    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ detail: 'boom' }, 500))

    await expect(makeClient(fetchImpl).accounts()).rejects.toThrow('failed (500)')
  })

  it('refreshes on 401 and retries once', async () => {
    expect.assertions(2)

    const tokens = ['stale', 'fresh']
    const tokenProvider = vi.fn<() => Promise<string>>(async () => tokens.shift() ?? 'fresh')
    const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
      const auth = (options?.headers as Record<string, string> | undefined)?.['authorization']
      return auth === 'fresh' ? jsonResponse({ accounts: [] }) : jsonResponse({ code: 'token_corrupted' }, 401)
    })

    await new WalletClient({ tokenProvider, fetch: fetchImpl }).accounts()

    expect(tokenProvider).toHaveBeenCalledTimes(2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('asks the provider once for concurrent requests with no cached token', async () => {
    expect.assertions(2)

    const tokenProvider = vi.fn<() => Promise<string>>(async () => 'jwt.token.value')
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ accounts: [] }))
    const client = new WalletClient({ tokenProvider, fetch: fetchImpl })

    await Promise.all([client.accounts(), client.accounts(), client.accounts()])

    expect(tokenProvider).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('gives up after a single refresh attempt', async () => {
    expect.assertions(2)

    const tokenProvider = vi.fn<() => Promise<string>>(async () => 'always-stale')
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ code: 'token_corrupted' }, 401))
    const client = new WalletClient({ tokenProvider, fetch: fetchImpl })

    await expect(client.accounts()).rejects.toBeInstanceOf(WalletAuthError)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
