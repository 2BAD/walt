import { WalletClient } from '@2bad/wallet'

const token = process.env['WALLET_TOKEN']
if (!token) {
  console.error('Set WALLET_TOKEN to the Authorization header value from an authenticated Wallet session.')
  process.exit(1)
}

const client = new WalletClient({ token })
const { entries, total, fiatCurrency } = await client.portfolio()

for (const entry of entries) {
  const amount = entry.amount.padStart(20)
  const value = entry.fiatValue.toFixed(2).padStart(12)
  console.log(`${entry.currency.padEnd(8)} ${amount}  ${value} ${fiatCurrency}`)
}
console.log('-'.repeat(44))
console.log(`${'TOTAL'.padEnd(8)} ${''.padStart(20)}  ${total.toFixed(2).padStart(12)} ${fiatCurrency}`)
