# Command line

```sh
npx @2bad/walt balances
```

```text
ASSET  KIND     AMOUNT  VALUE USD  SHARE
TON    spot      120.5     381.20  30.5%
USDT   orders      200     199.80  16.0%
SOL    earn        1.2     180.10  14.4%
total 1250.40 USD
```

Every command is read-only. None of them can exchange, order or move funds.

## Signing in

```sh
npx @2bad/walt login
```

It asks for the API id and hash from [my.telegram.org](https://my.telegram.org), your phone number and the code.
It prints a session string.

```sh
export TG_API_ID=12345
export TG_API_HASH=API_HASH
export TG_SESSION=SESSION_STRING
```

`--env-file .env` reads the same variables from a file. The session string grants full access to the account.

## Commands

```sh
walt balances                         # spot, staked and held by limit orders
walt history                          # balance and P/L per day, last 30 days
walt history --monthly --from 2026-01-01
walt transactions --asset TON --limit 50
walt price BTC TON                    # price and change over 24h, 7d and 30d
walt quote USDT BTC 100               # what 100 USDT buys right now, fees included
walt orders                           # open limit orders, --all for every order
walt perps                            # open perpetual positions, --closed for history
walt earn                             # your stakes, --all for every active campaign
```

## Options

```sh
walt balances --json            # JSON rows instead of a table
walt balances --fiat EUR        # values in EUR, default USD
walt balances --env-file .env   # credentials from a file
```

## Output

`--json` prints an array with one object per table row.

```sh
walt balances --json | jq '.[] | select(.kind == "spot") | .asset'
```

`history` shows P/L as Walt reports it.

Exit codes are `0` on success, `1` when a request fails and `2` on a usage error.
