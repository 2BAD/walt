#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions/index.js'

const rl = createInterface({ input: stdin, output: stdout })
const ask = (question: string) => rl.question(question)

const apiId = Number(process.env['TG_API_ID'] || (await ask('API id (from https://my.telegram.org): ')))
if (!Number.isSafeInteger(apiId) || apiId <= 0) {
  console.error('The API id must be the number shown at https://my.telegram.org')
  process.exit(1)
}
const apiHash = process.env['TG_API_HASH'] || (await ask('API hash: '))

const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 })

await client.start({
  phoneNumber: () => ask('Phone (+country...): '),
  phoneCode: () => ask('Code you received: '),
  password: () => ask('2FA password (blank if none): '),
  onError: (error) => console.error(error)
})

rl.close()
console.log('\nLogged in. Save this as TG_SESSION (keep it secret):\n')
console.log(client.session.save() as unknown as string)
await client.disconnect()
process.exit(0)
