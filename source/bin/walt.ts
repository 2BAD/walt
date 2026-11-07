#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { TelegramClient } from 'teleproto'
import { StringSession } from 'teleproto/sessions/index.js'
import { COMMANDS, run, UsageError } from '~/cli/run.ts'
import { WaltClient } from '~/client.ts'
import { TelegramTokenSource } from '~/telegram/auth.ts'
import { WaltAuthError, WaltRequestError } from '~/transport.ts'

/**
 * Signs in to Telegram interactively and prints the session string to save as `TG_SESSION`.
 *
 * @returns The process exit code.
 */
const login = async (): Promise<number> => {
  const rl = createInterface({ input: stdin, output: stdout })
  const ask = (question: string) => rl.question(question)

  const apiId = Number(process.env['TG_API_ID'] || (await ask('API id (from https://my.telegram.org): ')))
  if (!Number.isSafeInteger(apiId) || apiId <= 0) {
    rl.close()
    console.error('The API id must be the number shown at https://my.telegram.org')
    return 1
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
  return 0
}

const USAGE = `Usage: walt <command> [options]

${COMMANDS}
  login                     sign in to Telegram and print TG_SESSION

Options:
  --json                    print JSON instead of a table
  --fiat CODE               currency for values (default USD)
  --env-file PATH           read TG_API_ID, TG_API_HASH and TG_SESSION from a file
  -h, --help                show this help
  -v, --version             show the version

Needs TG_API_ID and TG_API_HASH from https://my.telegram.org and TG_SESSION from \`walt login\`.
Every command is read-only.`

const fail = (message: string, code: number): never => {
  console.error(`walt: ${message}`)
  process.exit(code)
}

const parse = () => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        json: { type: 'boolean' },
        fiat: { type: 'string' },
        'env-file': { type: 'string' },
        asset: { type: 'string' },
        limit: { type: 'string' },
        from: { type: 'string' },
        monthly: { type: 'boolean' },
        all: { type: 'boolean' },
        closed: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' }
      }
    })
  } catch (error) {
    return fail(`${(error as Error).message}\nRun \`walt --help\` for usage.`, 2)
  }
}

const { values, positionals } = parse()
const [command, ...args] = positionals

if (values.version) {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
  console.log(manifest.version)
  process.exit(0)
}
if (values.help || command === undefined) {
  console.log(USAGE)
  process.exit(command === undefined && !values.help ? 2 : 0)
}

if (values['env-file'] !== undefined) {
  try {
    process.loadEnvFile(values['env-file'])
  } catch (error) {
    fail(`cannot read ${values['env-file']}: ${(error as Error).message}`, 2)
  }
}

if (command === 'login') process.exit(await login())

const session = process.env['TG_SESSION']
const apiId = Number(process.env['TG_API_ID'])
const apiHash = process.env['TG_API_HASH']
if (!session || !apiId || !apiHash) {
  fail('set TG_API_ID, TG_API_HASH and TG_SESSION first (run `walt login` for the session)', 2)
}

const source = new TelegramTokenSource({ session: session ?? '', apiId, apiHash: apiHash ?? '' })
const client = new WaltClient({ tokenProvider: (rejected) => source.token(rejected) })

let exitCode = 0
try {
  console.log(await run(client, command, args, values))
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`walt: ${error.message}\nRun \`walt --help\` for usage.`)
    exitCode = 2
  } else if (error instanceof WaltRequestError) {
    const code = (error.body as { code?: unknown; detail?: unknown } | null)?.code
    console.error(`walt: ${error.message}${typeof code === 'string' ? ` (${code})` : ''}`)
    exitCode = 1
  } else if (error instanceof WaltAuthError) {
    console.error(`walt: sign-in failed: ${error.message}`)
    exitCode = 1
  } else {
    console.error(`walt: ${error instanceof Error ? error.message : String(error)}`)
    exitCode = 1
  }
} finally {
  await source.disconnect()
}
process.exit(exitCode)
