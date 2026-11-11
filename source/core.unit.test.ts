import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = resolve(import.meta.dirname)
const BUILD = resolve(SOURCE, '..', 'build')
const SPECIFIER = /(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
const NODE_GLOBALS = /\b(?:Buffer|process|require|__dirname|__filename)\b/

const resolveSpecifier = (from: string, specifier: string): string | null => {
  if (specifier.startsWith('~/')) return join(SOURCE, specifier.slice(2))
  if (specifier.startsWith('.')) return join(dirname(from), specifier)
  return null
}

const importGraph = async (entry: string) => {
  const files = new Set<string>()
  const external = new Set<string>()
  const globals = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (files.has(file)) continue
    files.add(file)
    const code = await readFile(file, 'utf8')
    if (NODE_GLOBALS.test(code)) globals.add(file)
    for (const match of code.matchAll(SPECIFIER)) {
      const specifier = (match[1] ?? match[2]) as string
      const local = resolveSpecifier(file, specifier)
      if (local) queue.push(local)
      else external.add(specifier)
    }
  }
  return { files, external, globals }
}

describe('client entry point', () => {
  it('imports no node module, no package and no node global', async () => {
    expect.assertions(4)

    const { files, external, globals } = await importGraph(join(SOURCE, 'core.ts'))

    expect(files.size).toBeGreaterThan(3)
    expect(files).not.toContain(join(SOURCE, 'telegram', 'auth.ts'))
    expect([...external]).toStrictEqual([])
    expect([...globals]).toStrictEqual([])
  })

  it.skipIf(!existsSync(join(BUILD, 'core.js')))(
    'keeps the built entry free of node modules and packages',
    async () => {
      expect.assertions(3)

      const { files, external, globals } = await importGraph(join(BUILD, 'core.js'))

      expect(files).not.toContain(join(BUILD, 'telegram', 'auth.js'))
      expect([...external]).toStrictEqual([])
      expect([...globals]).toStrictEqual([])
    }
  )

  it('reaches teleproto from the main entry, so the walk follows imports', async () => {
    expect.assertions(1)

    const { external } = await importGraph(join(SOURCE, 'index.ts'))

    expect([...external]).toContain('teleproto')
  })

  it('exports the refresh-only token source but not the telegram one', async () => {
    expect.assertions(2)

    const entry = await import('~/core.ts')

    expect(entry.RefreshTokenSource).toBeTypeOf('function')
    expect('TelegramTokenSource' in entry).toBe(false)
  })
})
