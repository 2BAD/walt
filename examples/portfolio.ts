import { TelegramTokenSource, WalletClient } from '@2bad/wallet'

const session = process.env['WALLET_TG_SESSION']
const apiId = Number(process.env['TG_API_ID'])
const apiHash = process.env['TG_API_HASH']
if (!session || !apiId || !apiHash) {
  console.error('Set WALLET_TG_SESSION, TG_API_ID, TG_API_HASH (run `pnpm login:telegram` once for the session).')
  process.exit(1)
}

const source = new TelegramTokenSource({ session, apiId, apiHash })
const client = new WalletClient({ tokenProvider: () => source.token() })

const { entries, total, fiatCurrency } = await client.portfolio()
for (const entry of entries) {
  console.log(
    `${entry.currency.padEnd(8)} ${entry.amount.padStart(20)}  ${entry.fiatValue.toFixed(2).padStart(12)} ${fiatCurrency}`
  )
}
console.log('-'.repeat(44))
console.log(`${'TOTAL'.padEnd(8)} ${''.padStart(20)}  ${total.toFixed(2).padStart(12)} ${fiatCurrency}`)

await source.disconnect()
process.exit(0)
