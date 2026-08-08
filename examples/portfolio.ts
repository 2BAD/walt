import { readFile, writeFile } from 'node:fs/promises'
import { type TokenState, TelegramTokenSource, WalletClient } from '@2bad/wallet'

const CACHE_FILE = '.wallet-token.json'

const session = process.env['WALLET_TG_SESSION']
const apiId = Number(process.env['TG_API_ID'])
const apiHash = process.env['TG_API_HASH']
if (!session || !apiId || !apiHash) {
  console.error('Set WALLET_TG_SESSION, TG_API_ID, TG_API_HASH (run `pnpm telegram:login` once for the session).')
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
const client = new WalletClient({ tokenProvider: () => source.token() })

const { entries, entriesTotal, total, staked, fiatCurrency } = await client.portfolio()
for (const entry of entries) {
  console.log(
    `${entry.currency.padEnd(8)} ${entry.amount.padStart(20)}  ${entry.fiatValue.toFixed(2).padStart(12)} ${fiatCurrency}`
  )
}
console.log('-'.repeat(44))
console.log(`${'SPOT'.padEnd(8)} ${''.padStart(20)}  ${entriesTotal.toFixed(2).padStart(12)} ${fiatCurrency}`)

if (Math.abs(staked) >= 0.01) {
  console.log(`${'STAKED'.padEnd(8)} ${''.padStart(20)}  ${staked.toFixed(2).padStart(12)} ${fiatCurrency}`)
  for (const campaign of (await client.earnCampaigns()).campaigns) {
    if (!campaign.account) continue
    console.log(`  ${campaign.name.padEnd(24)} ${campaign.account.balance.padStart(24)} ${campaign.account.currency}`)
  }
}

console.log('-'.repeat(44))
console.log(`${'TOTAL'.padEnd(8)} ${''.padStart(20)}  ${total.toFixed(2).padStart(12)} ${fiatCurrency}`)

await source.disconnect()
process.exit(0)
