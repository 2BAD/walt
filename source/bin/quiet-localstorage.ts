const nodeOptions = (process.env['NODE_OPTIONS'] ?? '').split(/\s+/)
const fileGiven = [...process.execArgv, ...nodeOptions].some((arg) => arg.startsWith('--localstorage-file'))

if (!fileGiven) {
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true })
}
