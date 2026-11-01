import { TelegramTokenSource, WaltClient } from '@2bad/walt'

const session = process.env['TG_SESSION']
const apiId = Number(process.env['TG_API_ID'])
const apiHash = process.env['TG_API_HASH']
if (!session || !apiId || !apiHash) {
  console.error('Set TG_SESSION, TG_API_ID, TG_API_HASH (run `npx -p @2bad/walt telegram-login` once for the session).')
  process.exit(1)
}

const source = new TelegramTokenSource({ session, apiId, apiHash })
const client = new WaltClient({ tokenProvider: (rejected) => source.token(rejected) })

const { entries, entriesTotal, total, staked, fiatCurrency } = await client.portfolio()
const line = (label: string, amount: string, value: number): void =>
  console.log(`${label.padEnd(8)} ${amount.padStart(20)}  ${value.toFixed(2).padStart(12)} ${fiatCurrency}`)

for (const entry of entries) line(entry.currency, entry.amount, entry.fiatValue)
line('SPOT', '', entriesTotal)
if (Math.abs(staked) >= 0.01) line('STAKED', '', staked)
line('TOTAL', '', total)

await source.disconnect()
process.exit(0)
