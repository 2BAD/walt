import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TokenState, TokenStorage } from '~/telegram/auth.ts'

export const defaultTokenPath = (session: string): string => {
  const cacheHome = process.env['XDG_CACHE_HOME'] || join(homedir(), '.cache')
  const account = createHash('sha256').update(session).digest('hex').slice(0, 16)
  return join(cacheHome, 'walt', `${account}.json`)
}

export const fileTokenStorage = (path: string): TokenStorage => ({
  load: async () => {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as TokenState
    } catch {
      return null
    }
  },
  save: async (state) => {
    const temp = `${path}.${process.pid}.tmp`
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeFile(temp, JSON.stringify(state), { mode: 0o600 })
      await rename(temp, path)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error)) throw error
    }
  }
})
