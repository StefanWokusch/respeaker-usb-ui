import { useCallback, useEffect, useRef, useState } from "react";

const MIN_DB = -72;
const MAX_DB = 0;

type MonitorStatus = "idle" | "requesting" | "running" | "error";

interface InputMonitorState {
  status: MonitorStatus;
  inputLabel: string;
  rmsDb: number | null;
  peakDb: number | null;
  noiseFloorDb: number | null;
  clipping: boolean;
  monitorEnabled: boolean;
  monitorGain: number;
  error: string | null;
}

interface UseInputMonitorResult extends InputMonitorState {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  setMonitorEnabled: (enabled: boolean) => void;
  setMonitorGain: (gain: number) => void;
  resetPeak: () => void;
}

const INITIAL_STATE: InputMonitorState = {
  status: "idle",
  inputLabel: "Windows default input",
  rmsDb: null,
  peakDb: null,
  noiseFloorDb: null,
  clipping: false,
  monitorEnabled: false,
  monitorGain: 1,
  error: null
};

function clampDb(value: number) {
  if (!Number.isFinite(value)) {
    return MIN_DB;
  }

  return Math.max(MIN_DB, Math.min(MAX_DB, value));
}

function amplitudeToDb(value: number) {
  return clampDb(20 * Math.log10(Math.max(value, 0.000001)));
}

function formatMonitorError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Microphone access was denied.";
    }

    if (error.name === "NotFoundError") {
      return "No recording device is available.";
    }

    return error.message || error.name;
  }

  return error instanceof Error ? error.message : String(error);
}

export function meterPercent(db: number | null) {
  if (db === null || Number.isNaN(db)) {
    return 0;
  }

  return Math.max(0, Math.min(1, (db - MIN_DB) / (MAX_DB - MIN_DB)));
}

export function formatDb(db: number | null) {
  if (db === null || Number.isNaN(db)) {
    return "—";
  }

  return `${db.toFixed(1)} dBFS`;
}

export default function useInputMonitor(): UseInputMonitorResult {
  const [state, setState] = useState<InputMonitorState>(INITIAL_STATE);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const monitorGainNodeRef = useRef<GainNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const sampleBufferRef = useRef<Float32Array | null>(null);
  const peakHoldRef = useRef<number | null>(null);
  const noiseFloorRef = useRef<number | null>(null);

  const updateMonitorGain = useCallback((enabled: boolean, gain: number) => {
    const context = audioContextRef.current;
    const gainNode = monitorGainNodeRef.current;
    if (!context || !gainNode) {
      return;
    }

    gainNode.gain.cancelScheduledValues(context.currentTime);
    gainNode.gain.setTargetAtTime(
      enabled ? gain : 0,
      context.currentTime,
      0.025
    );
  }, []);

  const cleanup = useCallback(async () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    try {
      sourceNodeRef.current?.disconnect();
    } catch {
      // ignore disconnect races
    }

    try {
      analyserNodeRef.current?.disconnect();
    } catch {
      // ignore disconnect races
    }

    try {
      monitorGainNodeRef.current?.disconnect();
    } catch {
      // ignore disconnect races
    }

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    sourceNodeRef.current = null;
    analyserNodeRef.current = null;
    monitorGainNodeRef.current = null;
    sampleBufferRef.current = null;
    peakHoldRef.current = null;
    noiseFloorRef.current = null;

    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch {
        // ignore close races
      }
      audioContextRef.current = null;
    }
  }, []);

  const stop = useCallback(async () => {
    await cleanup();
    setState((current) => ({
      ...current,
      status: "idle",
      rmsDb: null,
      peakDb: null,
      noiseFloorDb: null,
      clipping: false,
      error: null
    }));
  }, [cleanup]);

  const start = useCallback(async () => {
    if (state.status === "requesting" || state.status === "running") {
      return;
    }

    setState((current) => ({
      ...current,
      status: "requesting",
      error: null
    }));

    try {
      await cleanup();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false
        }
      });

      const AudioContextCtor =
        window.AudioContext ||
        (
          window as Window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

      if (!AudioContextCtor) {
        throw new Error("Web Audio API is not available in this build.");
      }

      const context = new AudioContextCtor();
      if (context.state === "suspended") {
        await context.resume();
      }

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;

      const monitorGain = context.createGain();
      monitorGain.gain.value = 0;

      source.connect(analyser);
      source.connect(monitorGain);
      monitorGain.connect(context.destination);

      audioContextRef.current = context;
      mediaStreamRef.current = stream;
      sourceNodeRef.current = source;
      analyserNodeRef.current = analyser;
      monitorGainNodeRef.current = monitorGain;
      sampleBufferRef.current = new Float32Array(analyser.fftSize);
      peakHoldRef.current = MIN_DB;
      noiseFloorRef.current = MIN_DB;

      const trackLabel =
        stream.getAudioTracks()[0]?.label?.trim() || "Windows default input";

      updateMonitorGain(state.monitorEnabled, state.monitorGain);

      const sample = () => {
        const analyserNode = analyserNodeRef.current;
        const sampleBuffer = sampleBufferRef.current;

        if (!analyserNode || !sampleBuffer) {
          return;
        }

        analyserNode.getFloatTimeDomainData(sampleBuffer);

        let peak = 0;
        let sumSquares = 0;
        for (const value of sampleBuffer) {
          const absolute = Math.abs(value);
          if (absolute > peak) {
            peak = absolute;
          }
          sumSquares += value * value;
        }

        const rms = Math.sqrt(sumSquares / sampleBuffer.length);
        const rmsDb = amplitudeToDb(rms);
        const peakDbInstant = amplitudeToDb(peak);

        peakHoldRef.current =
          peakHoldRef.current === null
            ? peakDbInstant
            : Math.max(peakDbInstant, peakHoldRef.current - 0.35);

        noiseFloorRef.current =
          noiseFloorRef.current === null
            ? rmsDb
            : rmsDb < noiseFloorRef.current
              ? noiseFloorRef.current + (rmsDb - noiseFloorRef.current) * 0.32
              : noiseFloorRef.current + (rmsDb - noiseFloorRef.current) * 0.015;

        setState((current) => ({
          ...current,
          status: "running",
          inputLabel: trackLabel,
          rmsDb,
          peakDb: peakHoldRef.current,
          noiseFloorDb: noiseFloorRef.current,
          clipping: peak >= 0.98,
          error: null
        }));

        frameRef.current = window.requestAnimationFrame(sample);
      };

      frameRef.current = window.requestAnimationFrame(sample);

      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          void stop();
        };
      });
    } catch (error) {
      await cleanup();
      setState((current) => ({
        ...current,
        status: "error",
        rmsDb: null,
        peakDb: null,
        noiseFloorDb: null,
        clipping: false,
        error: formatMonitorError(error)
      }));
    }
  }, [cleanup, state.monitorEnabled, state.monitorGain, state.status, stop, updateMonitorGain]);

  const setMonitorEnabled = useCallback(
    (enabled: boolean) => {
      setState((current) => ({
        ...current,
        monitorEnabled: enabled
      }));
      updateMonitorGain(enabled, state.monitorGain);
    },
    [state.monitorGain, updateMonitorGain]
  );

  const setMonitorGain = useCallback(
    (gain: number) => {
      const boundedGain = Math.max(0, Math.min(gain, 2));
      setState((current) => ({
        ...current,
        monitorGain: boundedGain
      }));
      updateMonitorGain(state.monitorEnabled, boundedGain);
    },
    [state.monitorEnabled, updateMonitorGain]
  );

  const resetPeak = useCallback(() => {
    peakHoldRef.current = state.rmsDb ?? MIN_DB;
    setState((current) => ({
      ...current,
      peakDb: peakHoldRef.current
    }));
  }, [state.rmsDb]);

  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  return {
    ...state,
    start,
    stop,
    setMonitorEnabled,
    setMonitorGain,
    resetPeak
  };
}
