import { readFile, writeFile } from 'node:fs/promises'
import { type TokenState, TelegramTokenSource, WaltClient } from '@2bad/walt'

const CACHE_FILE = '.walt-token.json'

const session = process.env['TG_SESSION']
const apiId = Number(process.env['TG_API_ID'])
const apiHash = process.env['TG_API_HASH']
if (!session || !apiId || !apiHash) {
  console.error('Set TG_SESSION, TG_API_ID, TG_API_HASH (run `npx -p @2bad/walt telegram-login` once for the session).')
  process.exit(1)
}

const storage = {
  load: async (): Promise<TokenState | null> => {
    try {
      return JSON.parse(await readFile(CACHE_FILE, 'utf8')) as TokenState
    } catch {
      return null
    }
  },
  save: (state: TokenState): Promise<void> => writeFile(CACHE_FILE, JSON.stringify(state), { mode: 0o600 })
}

const source = new TelegramTokenSource({ session, apiId, apiHash, storage })
const client = new WaltClient({ tokenProvider: () => source.token() })

const { entries, entriesTotal, total, staked, fiatCurrency } = await client.portfolio()
const line = (label: string, amount: string, value: number): void =>
  console.log(`${label.padEnd(8)} ${amount.padStart(20)}  ${value.toFixed(2).padStart(12)} ${fiatCurrency}`)

for (const entry of entries) line(entry.currency, entry.amount, entry.fiatValue)
line('SPOT', '', entriesTotal)
if (Math.abs(staked) >= 0.01) line('STAKED', '', staked)
line('TOTAL', '', total)

await source.disconnect()
process.exit(0)
