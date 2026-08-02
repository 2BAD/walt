import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'

const apiId = Number(process.env.TG_API_ID)
const apiHash = process.env.TG_API_HASH
if (!apiId || !apiHash) {
  console.error('Set TG_API_ID and TG_API_HASH (create them at https://my.telegram.org).')
  process.exit(1)
}

const rl = createInterface({ input: stdin, output: stdout })
const ask = (q: string) => rl.question(q)

const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 })

await client.start({
  phoneNumber: () => ask('Phone (+country...): '),
  phoneCode: () => ask('Code you received: '),
  password: () => ask('2FA password (blank if none): '),
  onError: (err) => console.error(err)
})

rl.close()
console.log('\nLogged in. Save this as WALLET_TG_SESSION (keep it secret):\n')
console.log((client.session.save() as unknown as string) ?? '')
await client.disconnect()
process.exit(0)
