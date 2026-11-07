export type CandleRequest = {
  /** `<currency>/USD/SPOT`, or `<base>/USD/PERP_TRADE` for a perps contract. */
  ticker: string
  /** Seen: `5m`, `15m`. */
  resolution: string
  limit: number
}

export type Candle = { o: string; h: string; l: string; c: string; v: string }

export type CandleSeries = {
  ticker: string
  resolution: string
  /** Opening time of the first candle, in ms. */
  start_ts: number
  candles: Candle[]
}
