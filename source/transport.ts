import { BROWSER_HEADERS, SENTRY_PUBLIC_KEY, SENTRY_RELEASE } from '~/browser.ts'

export class WaltAuthError extends Error {}

export class WaltRequestError extends Error {
  /** HTTP status, or `0` when the request never got a response. */
  readonly status: number
  /** From a `retry-after` given in seconds. */
  readonly retryAfterMs: number | null
  /** The response body, parsed when it is JSON, such as `{ code: 'market_order_max_limit_error', detail }`. */
  readonly body: unknown

  constructor(message: string, status: number, retryAfterMs: number | null, body: unknown, options?: ErrorOptions) {
    super(message, options)
    this.status = status
    this.retryAfterMs = retryAfterMs
    this.body = body
  }
}

const RETRYABLE_STATUS = new Set([0, 429, 502, 503, 504])
const BEARER_SERVICES = ['/emporos/', '/portmone/', '/kandelabr/']

const MAX_RETRY_DELAY_MS = 30_000

const hex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const parseBody = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const retryAfterOf = (response: Response): number | null => {
  const header = response.headers.get('retry-after')
  return header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) * 1000 : null
}

const telegramUserIdOf = (token: string): number | null => {
  try {
    const payload = (token.split('.')[1] ?? '').replaceAll('-', '+').replaceAll('_', '/')
    const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as {
      web_view_init_data?: { user?: { id?: unknown } }
    }
    const id = claims.web_view_init_data?.user?.id
    return typeof id === 'number' ? id : null
  } catch {
    return null
  }
}

export class Transport {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly tokenProvider: (rejected?: string) => Promise<string>
  private readonly traceId = hex(16)
  private readonly baggage: string
  private readonly retries: number
  private readonly retryDelayMs: number
  private readonly maxConcurrent: number
  private token: string | null = null
  private pending: Promise<string> | null = null
  private active = 0
  private readonly waiting: (() => void)[] = []

  constructor(options: {
    tokenProvider: (rejected?: string) => Promise<string>
    baseUrl: string
    fetch: typeof fetch
    retries: number
    retryDelayMs: number
    maxConcurrent: number
  }) {
    this.tokenProvider = options.tokenProvider
    this.baseUrl = options.baseUrl
    this.fetchImpl = options.fetch
    this.retries = options.retries
    this.retryDelayMs = options.retryDelayMs
    this.maxConcurrent = options.maxConcurrent
    this.baggage = [
      'sentry-environment=production',
      `sentry-release=${SENTRY_RELEASE}`,
      `sentry-public_key=${SENTRY_PUBLIC_KEY}`,
      `sentry-trace_id=${this.traceId}`,
      'sentry-transaction=%2Fwv',
      'sentry-sampled=false',
      `sentry-sample_rand=${Math.random()}`,
      'sentry-sample_rate=0.01'
    ].join(',')
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, undefined, this.retries)
  }

  post<T>(path: string, body: unknown, retries = this.retries): Promise<T> {
    return this.request<T>(path, body, retries)
  }

  private async ensureToken(rejected?: string): Promise<string> {
    if (this.token) return this.token
    this.pending ??= this.mintToken(rejected)
    try {
      return await this.pending
    } finally {
      this.pending = null
    }
  }

  private async mintToken(rejected?: string): Promise<string> {
    const token = await this.tokenProvider(rejected)
    this.token = token
    return token
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++
      return
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active++
        resolve()
      })
    })
  }

  private release(): void {
    this.active--
    this.waiting.shift()?.()
  }

  private async send<T>(path: string, body: unknown, rejected?: string): Promise<T> {
    const token = await this.ensureToken(rejected)
    const method = body === undefined ? 'GET' : 'POST'
    const jwt = token.replace(/^Bearer\s+/i, '')
    const userId = telegramUserIdOf(jwt)
    const headers: Record<string, string> = {
      ...BROWSER_HEADERS,
      accept: 'application/json',
      authorization: BEARER_SERVICES.some((prefix) => path.startsWith(prefix)) ? `Bearer ${jwt}` : jwt,
      referer: `${this.baseUrl}/main?ep=menu${userId === null ? '' : `&tgWebAppUserId=${userId}`}`,
      baggage: this.baggage,
      'sentry-trace': `${this.traceId}-${hex(8)}-0`,
      traceparent: `00-${hex(16)}-${hex(8)}-01`
    }
    if (method === 'POST') {
      headers['content-type'] = 'application/json'
      headers['origin'] = this.baseUrl
    }
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(body) : null
      })
    } catch (cause) {
      throw new WaltRequestError(`${method} ${path} failed (no response)`, 0, null, null, { cause })
    }
    if (response.status === 401) {
      if (rejected !== undefined) throw new WaltAuthError('token rejected after refresh')
      if (this.token === token) this.token = null
      return this.send<T>(path, body, token)
    }
    let text: string
    try {
      text = await response.text()
    } catch (cause) {
      throw new WaltRequestError(`${method} ${path} failed (body not received)`, 0, null, null, { cause })
    }
    if (!response.ok) {
      throw new WaltRequestError(
        `${method} ${path} failed (${response.status})`,
        response.status,
        retryAfterOf(response),
        parseBody(text)
      )
    }
    try {
      return JSON.parse(text) as T
    } catch (cause) {
      throw new WaltRequestError(
        `${method} ${path} returned a body that is not JSON (${response.status})`,
        response.status,
        null,
        text,
        { cause }
      )
    }
  }

  private async request<T>(path: string, body: unknown, retries: number): Promise<T> {
    await this.acquire()
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.send<T>(path, body)
        } catch (error) {
          const transient = error instanceof WaltRequestError && RETRYABLE_STATUS.has(error.status)
          if (!transient || attempt >= retries) throw error
          const backoff = Math.min(MAX_RETRY_DELAY_MS, this.retryDelayMs * 2 ** attempt)
          await sleep(error.retryAfterMs ?? backoff / 2 + Math.random() * (backoff / 2))
        }
      }
    } finally {
      this.release()
    }
  }
}
