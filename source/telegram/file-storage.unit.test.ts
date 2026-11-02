import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TokenState } from '~/telegram/auth.ts'
import { defaultTokenPath, fileTokenStorage } from '~/telegram/file-storage.ts'

const state: TokenState = {
  jwt: 'jwt-one',
  refreshToken: 'refresh-one',
  sessionId: 'session-one',
  expiresAt: 1767225900000,
  deviceSerial: 'web:fixed'
}

describe('defaultTokenPath', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('puts one file per session under XDG_CACHE_HOME', () => {
    expect.assertions(4)

    const cacheHome = join(tmpdir(), 'cache')
    vi.stubEnv('XDG_CACHE_HOME', cacheHome)

    expect(dirname(defaultTokenPath('session-a'))).toBe(join(cacheHome, 'walt'))
    expect(basename(defaultTokenPath('session-a'))).toMatch(/^[0-9a-f]{16}\.json$/)
    expect(defaultTokenPath('session-a')).toBe(defaultTokenPath('session-a'))
    expect(defaultTokenPath('session-a')).not.toBe(defaultTokenPath('session-b'))
  })

  it('falls back to ~/.cache without XDG_CACHE_HOME', () => {
    expect.assertions(1)

    vi.stubEnv('XDG_CACHE_HOME', '')

    expect(defaultTokenPath('session-a').startsWith(join(homedir(), '.cache', 'walt'))).toBe(true)
  })

  it('does not put the session itself in the path', () => {
    expect.assertions(1)

    expect(defaultTokenPath('secret-session-string')).not.toContain('secret-session-string')
  })
})

describe('fileTokenStorage', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'walt-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('saves and loads the token', async () => {
    expect.assertions(1)

    const storage = fileTokenStorage(join(dir, 'walt', 'token.json'))
    await storage.save(state)

    expect(await storage.load()).toStrictEqual(state)
  })

  it.skipIf(process.platform === 'win32')('keeps the token file private', async () => {
    expect.assertions(2)

    const path = join(dir, 'walt', 'token.json')
    await fileTokenStorage(path).save(state)

    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(join(dir, 'walt'))).mode & 0o777).toBe(0o700)
  })

  it('replaces an earlier token', async () => {
    expect.assertions(1)

    const storage = fileTokenStorage(join(dir, 'token.json'))
    await storage.save(state)
    await storage.save({ ...state, jwt: 'jwt-two' })

    expect((await storage.load())?.jwt).toBe('jwt-two')
  })

  it('loads nothing when the file is missing', async () => {
    expect.assertions(1)

    expect(await fileTokenStorage(join(dir, 'missing.json')).load()).toBeNull()
  })

  it('loads nothing when the file is not json', async () => {
    expect.assertions(1)

    const path = join(dir, 'token.json')
    await writeFile(path, 'not json')

    expect(await fileTokenStorage(path).load()).toBeNull()
  })

  it('does not throw when the file cannot be written', async () => {
    expect.assertions(2)

    const blocker = join(dir, 'blocker')
    await writeFile(blocker, '')

    await expect(fileTokenStorage(join(blocker, 'token.json')).save(state)).resolves.toBeUndefined()
    expect(await readFile(blocker, 'utf8')).toBe('')
  })
})
