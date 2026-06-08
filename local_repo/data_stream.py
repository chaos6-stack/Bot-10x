# data_stream.py
"""
Deriv WebSocket Stream Integration Module
Establishes an authenticated connection to the Deriv API using DERIV_API_TOKEN.
Real live tick data only — simulation is explicitly opt-in, never silent.
"""

import json
import time
import threading
import os
import config

# Try importing websocket-client library
try:
    import websocket
    HAS_WEBSOCKET_LIB = True
except ImportError:
    HAS_WEBSOCKET_LIB = False


class DerivDataStream:
    def __init__(self, symbol: str = config.ACTIVE_SYMBOL,
                 on_tick_callback=None, on_candles_callback=None):
        self.raw_symbol = symbol.upper()
        self.symbol = self.raw_symbol

        self.on_tick_callback = on_tick_callback
        self.on_candles_callback = on_candles_callback
        self.ws = None
        self.is_running = False
        self.reconnect_delay = 5

        # Resolve API token: env var takes priority over config
        self.api_token = os.environ.get("DERIV_API_TOKEN", "") or getattr(config, "DERIV_TOKEN", "")

        # use_fallback is NEVER set silently — only when websocket lib is absent
        # OR when FORCE_LIVE_WS is explicitly False (manual offline test mode).
        force_live = getattr(config, "FORCE_LIVE_WS", True)
        if force_live:
            self.use_fallback = False
        else:
            self.use_fallback = not HAS_WEBSOCKET_LIB

        if not HAS_WEBSOCKET_LIB and not self.use_fallback:
            print("[STREAM] WARNING: websocket-client not installed. "
                  "Run: pip install websocket-client")

    # ─────────────────────────────────────────────────────────────────────────
    #  PUBLIC INTERFACE
    # ─────────────────────────────────────────────────────────────────────────

    def start(self):
        """Starts stream on a background thread."""
        self.is_running = True
        force_live = getattr(config, "FORCE_LIVE_WS", True)
        if force_live:
            self.use_fallback = False

        if self.use_fallback:
            print("[STREAM] SIMULATION MODE ACTIVE (FORCE_LIVE_WS=False). "
                  "Data is NOT from Deriv — for offline testing only.")
            threading.Thread(target=self._simulate_stream, daemon=True).start()
        else:
            if not HAS_WEBSOCKET_LIB:
                print("[STREAM] CRITICAL: websocket-client not available and live mode is required. "
                      "Install it: pip install websocket-client")
                return
            threading.Thread(target=self._connect_websocket_loop, daemon=True).start()

    def stop(self):
        """Halts background loops safely."""
        self.is_running = False
        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass

    # ─────────────────────────────────────────────────────────────────────────
    #  WEBSOCKET LOOP
    # ─────────────────────────────────────────────────────────────────────────

    def _connect_websocket_loop(self):
        """Reconnecting supervisor loop."""
        url = f"wss://ws.derivws.com/websockets/v3?app_id={config.APP_ID}"

        while self.is_running:
            try:
                print(f"[STREAM] Connecting to Deriv live feed — symbol: {self.symbol} ...")
                if self.api_token:
                    print("[STREAM] API token found — authenticating with demo account.")
                else:
                    print("[STREAM] No API token set. Connecting as anonymous (tick data only, no account info).")

                self.ws = websocket.WebSocketApp(
                    url,
                    on_open=self._on_open,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close,
                )
                self.ws.run_forever(ping_interval=20, ping_timeout=10)

            except Exception as e:
                print(f"[STREAM] Connection error: {e}")

            if not self.is_running:
                break

            print(f"[STREAM] Disconnected. Retrying in {self.reconnect_delay}s ...")
            time.sleep(self.reconnect_delay)

    def _on_open(self, ws):
        print(f"[STREAM] WebSocket open. Symbol: {self.symbol}")

        # Step 1: authenticate if token available
        if self.api_token:
            ws.send(json.dumps({"authorize": self.api_token}))
        else:
            # No token — go straight to data requests
            self._request_data(ws)

    def _request_data(self, ws):
        """Send history + tick subscription requests."""
        # 120 historical 1-minute candles
        ws.send(json.dumps({
            "ticks_history": self.symbol,
            "adjust_start_time": 1,
            "count": 120,
            "end": "latest",
            "style": "candles",
            "granularity": 60,
        }))
        # Live tick subscription
        ws.send(json.dumps({
            "ticks": self.symbol,
            "subscribe": 1,
        }))
        print(f"[STREAM] Subscribed to {self.symbol} ticks + 120 historical candles.")

    def _on_message(self, ws, msg):
        try:
            data = json.loads(msg)
            msg_type = data.get("msg_type", "")

            # ── Authorization response ────────────────────────────────────
            if msg_type == "authorize" or "authorize" in data:
                auth = data.get("authorize", {})
                if auth:
                    acct = auth.get("loginid", "unknown")
                    balance = auth.get("balance", "?")
                    currency = auth.get("currency", "")
                    print(f"[STREAM] Authenticated as account {acct} | "
                          f"Balance: {balance} {currency}")
                    self._request_data(ws)
                elif "error" in data:
                    err = data["error"].get("message", "Auth error")
                    print(f"[STREAM] Auth failed: {err} — continuing without auth (tick data only).")
                    self._request_data(ws)
                return

            # ── Live tick ─────────────────────────────────────────────────
            if "tick" in data:
                tick_info = data["tick"]
                price = float(tick_info["quote"])
                timestamp = int(tick_info["epoch"])
                if self.on_tick_callback:
                    self.on_tick_callback(price, timestamp)

            # ── Historical candles ────────────────────────────────────────
            elif "candles" in data:
                if self.on_candles_callback:
                    self.on_candles_callback(data["candles"])

            # ── API errors ───────────────────────────────────────────────
            elif "error" in data:
                err_msg = data["error"].get("message", "Unknown error")
                err_code = data["error"].get("code", "")
                print(f"[STREAM] Deriv API error [{err_code}]: {err_msg}")
                # Never silently fall back — log and keep retrying live
                if "invalid symbol" in err_msg.lower():
                    print(f"[STREAM] Symbol '{self.symbol}' rejected by Deriv API. "
                          "Check the symbol name.")
        except Exception as e:
            print(f"[STREAM] Message parse error: {e}")

    def _on_error(self, ws, err):
        print(f"[STREAM] WebSocket error: {err}")

    def _on_close(self, ws, close_status_code, close_msg):
        print(f"[STREAM] Connection closed. Code: {close_status_code} | Msg: {close_msg}")

    # ─────────────────────────────────────────────────────────────────────────
    #  SIMULATION (EXPLICIT OPT-IN ONLY — FORCE_LIVE_WS = False)
    # ─────────────────────────────────────────────────────────────────────────

    def _simulate_stream(self):
        """
        Offline tick simulator. Only runs when FORCE_LIVE_WS=False is explicitly
        set. Produces realistic BOOM/CRASH-like tick series for local testing.
        This data does NOT match Deriv live prices.
        """
        import random
        price = 1000.00
        is_boom = "BOOM" in self.raw_symbol
        drift = -0.05 if is_boom else 0.05
        noise = 0.02
        spike_freq = 1.0 / int(self.raw_symbol.replace("BOOM", "").replace("CRASH", "") or "1000")

        # Seed simulated historical candles first
        if self.on_candles_callback:
            print("[STREAM][SIM] Seeding simulated historical candles...")
            now = int(time.time())
            sim_candles = []
            c_price = price
            for i in range(120):
                c_time = now - (120 - i) * 60
                o = c_price
                high_pt = low_pt = o
                for _ in range(5):
                    dp = drift * 5 + random.uniform(-4.0, 4.0)
                    if random.random() < 0.15:
                        dp += random.uniform(15.0, 30.0) if is_boom else -random.uniform(15.0, 30.0)
                    temp = c_price + dp
                    high_pt = max(high_pt, temp)
                    low_pt = min(low_pt, temp)
                c_price += drift * 5 + random.uniform(-2.0, 2.0)
                if c_price < 10.0:
                    c_price = 10.0
                sim_candles.append({
                    "epoch": c_time, "open": o,
                    "high": high_pt, "low": low_pt, "close": c_price,
                })
            price = c_price
            self.on_candles_callback(sim_candles)

        while self.is_running:
            change = drift + random.uniform(-noise, noise)
            if random.random() < spike_freq:
                spike_size = random.uniform(8.0, 24.0)
                change += spike_size if is_boom else -spike_size
            price += change
            curr_time = int(time.time())
            if self.on_tick_callback:
                self.on_tick_callback(price, curr_time)
            time.sleep(random.uniform(1.2, 1.8))
