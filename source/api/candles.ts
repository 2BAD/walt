export type CandleRequest = {
  /** `<currency>/USD/SPOT`, or `<base>/USD/PERP_TRADE` for a perps contract. */
  ticker: string
  /** Accepted: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`, `1w`, `1mo`. */
  resolution: string
  /** At least 1. The whole batch may ask for 3000 candles at most. */
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
