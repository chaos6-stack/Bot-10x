---
name: Deriv WebSocket auth pattern
description: How to authenticate with Deriv API and the no-silent-fallback rule.
---

## Auth Flow
1. Connect to `wss://ws.derivws.com/websockets/v3?app_id=1089`
2. Send `{"authorize": "<DERIV_API_TOKEN>"}` immediately on open
3. On authorize response: log loginid + balance, then send ticks_history + ticks subscribe
4. On auth error: log it, continue without auth (tick data still works anonymously)

## No Silent Fallback Rule
`FORCE_LIVE_WS=True` (the default) means simulation is NEVER used silently.
Simulation only runs when `FORCE_LIVE_WS=False` is explicitly set in config.
If websocket-client isn't installed AND live mode required → print hard error, do not silently fall back.

## NixOS pip issue
Replit NixOS blocks `pip install` without `--break-system-packages`.
Use: `python3 -m pip install websocket-client --break-system-packages`
websocket-client is the sync library (not websockets async) — required by DerivDataStream.

**Why:** User explicitly required "never silent simulation fallback" — this is the core data integrity guarantee of the system.
