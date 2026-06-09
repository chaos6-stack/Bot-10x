// useAudioAlert.ts
// Browser-native Web Audio API alert system.
// No external files — all sounds are synthesised from oscillators.
// Safe to call even when alerts are muted (the hook checks internally).

import { useRef, useCallback } from "react";

type OscType = OscillatorType;

interface Note {
  freq:   number;
  delay:  number;   // ms
  dur:    number;   // seconds
  vol?:   number;   // 0–1, default 0.25
  type?:  OscType;  // default "sine"
}

export function useAudioAlert() {
  const ctxRef     = useRef<AudioContext | null>(null);
  const enabledRef = useRef<boolean>(true);   // mirrors the React state toggle

  // Create (or reuse) the AudioContext lazily — browsers require a user gesture first.
  const getCtx = useCallback((): AudioContext | null => {
    try {
      if (!ctxRef.current) {
        ctxRef.current = new (window.AudioContext ||
          (window as any).webkitAudioContext)();
      }
      // Resume if suspended (Chrome policy)
      if (ctxRef.current.state === "suspended") {
        ctxRef.current.resume();
      }
      return ctxRef.current;
    } catch {
      return null;
    }
  }, []);

  const playTone = useCallback((
    freq: number, durSec: number,
    type: OscType = "sine", vol = 0.25, delayMs = 0
  ) => {
    if (!enabledRef.current) return;
    setTimeout(() => {
      const ac = getCtx();
      if (!ac) return;
      try {
        const osc  = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.type            = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(vol, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + durSec);
        osc.start(ac.currentTime);
        osc.stop(ac.currentTime + durSec + 0.02);
      } catch { /* ignore AudioContext edge cases */ }
    }, delayMs);
  }, [getCtx]);

  const playSequence = useCallback((notes: Note[]) => {
    notes.forEach(({ freq, delay, dur, vol = 0.25, type = "sine" }) => {
      playTone(freq, dur, type, vol, delay);
    });
  }, [playTone]);

  // ── ALERT: Probability threshold crossed (pre-entry warning) ──────────────
  // Two ascending tones — "heads up, something is about to happen"
  const alertThresholdCrossed = useCallback(() => {
    playSequence([
      { freq: 880,  delay: 0,   dur: 0.12, vol: 0.18, type: "sine" },
      { freq: 1320, delay: 130, dur: 0.22, vol: 0.22, type: "sine" },
    ]);
  }, [playSequence]);

  // ── ALERT: Trade opened ───────────────────────────────────────────────────
  // BUY  → rising C-E-G arpeggio (optimistic)
  // SELL → falling G-E-C arpeggio (downward thesis)
  const alertTradeOpened = useCallback((direction: "BUY" | "SELL" = "BUY") => {
    if (direction === "BUY") {
      playSequence([
        { freq: 523,  delay: 0,   dur: 0.10, vol: 0.20 },
        { freq: 659,  delay: 100, dur: 0.10, vol: 0.22 },
        { freq: 784,  delay: 200, dur: 0.22, vol: 0.28 },
      ]);
    } else {
      playSequence([
        { freq: 784,  delay: 0,   dur: 0.10, vol: 0.20 },
        { freq: 659,  delay: 100, dur: 0.10, vol: 0.22 },
        { freq: 523,  delay: 200, dur: 0.22, vol: 0.28 },
      ]);
    }
  }, [playSequence]);

  // ── ALERT: Trade closed ───────────────────────────────────────────────────
  // WIN  → four-note rising fanfare  (bright sine)
  // LOSS → two-note descending buzz  (muted square)
  const alertTradeClosed = useCallback((win: boolean) => {
    if (win) {
      playSequence([
        { freq: 523,  delay: 0,   dur: 0.09, vol: 0.20 },
        { freq: 659,  delay: 80,  dur: 0.09, vol: 0.22 },
        { freq: 784,  delay: 160, dur: 0.09, vol: 0.22 },
        { freq: 1047, delay: 240, dur: 0.30, vol: 0.28 },
      ]);
    } else {
      playSequence([
        { freq: 440, delay: 0,   dur: 0.20, vol: 0.14, type: "square" },
        { freq: 330, delay: 230, dur: 0.28, vol: 0.10, type: "square" },
      ]);
    }
  }, [playSequence]);

  // ── ALERT: Spike detected (in-direction) ─────────────────────────────────
  // Sharp high ping — "spike just fired, we're in profit"
  const alertSpikeDetected = useCallback(() => {
    playSequence([
      { freq: 1760, delay: 0,  dur: 0.07, vol: 0.18, type: "triangle" },
      { freq: 2093, delay: 75, dur: 0.18, vol: 0.22, type: "triangle" },
    ]);
  }, [playSequence]);

  // ── TEST: Single beep to confirm audio is working ─────────────────────────
  const alertTest = useCallback(() => {
    playSequence([
      { freq: 660,  delay: 0,   dur: 0.12, vol: 0.25 },
      { freq: 880,  delay: 130, dur: 0.12, vol: 0.25 },
      { freq: 1100, delay: 260, dur: 0.20, vol: 0.25 },
    ]);
  }, [playSequence]);

  // Expose ref setter so the parent can toggle without re-render loops
  const setEnabled = useCallback((on: boolean) => {
    enabledRef.current = on;
  }, []);

  return {
    alertThresholdCrossed,
    alertTradeOpened,
    alertTradeClosed,
    alertSpikeDetected,
    alertTest,
    setEnabled,
  };
}
