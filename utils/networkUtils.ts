import { SpeedData } from '../types';

// Large file for bandwidth testing
const TEST_FILE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js'; 
// Small file for latency/handshake testing
const PING_FILE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js'; // Using same file but will abort early or use small chunks if possible, but for CORS safety we just download it.

export const performSpeedTest = async (): Promise<SpeedData> => {
  const start = performance.now();
  let sizeLoaded = 0;

  try {
    const response = await fetch(`${TEST_FILE_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Network response was not ok");
    
    const blob = await response.blob();
    sizeLoaded = blob.size;
    
    const end = performance.now();
    const durationSeconds = (end - start) / 1000;
    
    const bitsLoaded = sizeLoaded * 8;
    const bps = bitsLoaded / durationSeconds;
    const kbps = bps / 1000;

    return {
      timestamp: Date.now(),
      downloadSpeedKbps: Math.round(kbps),
      latencyMs: Math.round(durationSeconds * 1000), 
    };
  } catch (error) {
    return {
      timestamp: Date.now(),
      downloadSpeedKbps: 0,
      latencyMs: 0,
    };
  }
};

// Mode 2: TURBO (Stress Test)
// Opens 4 parallel connections to see if aggregate speed > single connection speed
export const performStressTest = async (): Promise<SpeedData> => {
  const start = performance.now();
  const CONCURRENCY = 4;
  
  try {
    const promises = Array(CONCURRENCY).fill(0).map(async (_, i) => {
      const tStart = performance.now();
      const res = await fetch(`${TEST_FILE_URL}?stress=${i}&t=${Date.now()}`, { cache: "no-store" });
      const blob = await res.blob();
      return blob.size;
    });

    const sizes = await Promise.all(promises);
    const totalSize = sizes.reduce((a, b) => a + b, 0);
    const end = performance.now();
    
    const durationSeconds = (end - start) / 1000;
    const kbps = ((totalSize * 8) / durationSeconds) / 1000;

    return {
      timestamp: Date.now(),
      downloadSpeedKbps: Math.round(kbps),
      latencyMs: Math.round(durationSeconds * 1000), // Note: Latency here is "Time to complete all 4"
    };

  } catch (error) {
    return {
      timestamp: Date.now(),
      downloadSpeedKbps: 0,
      latencyMs: 0,
    };
  }
};

// Mode 3: STABILITY (Jitter Test)
// Performs 5 quick sequential fetches to measure consistency
export const performStabilityTest = async (): Promise<SpeedData> => {
  const ITERATIONS = 5;
  const latencies: number[] = [];
  let totalSize = 0;
  let totalDuration = 0;

  try {
    for (let i = 0; i < ITERATIONS; i++) {
      const tStart = performance.now();
      // We purposefully don't await blob() to save bandwidth, we just want headers/first byte mainly, 
      // but to be accurate on "speed" we grab body. 
      // To keep it fast, we might use a smaller file if we had one, but we use the existing one for consistency.
      const res = await fetch(`${TEST_FILE_URL}?jit=${i}&t=${Date.now()}`, { cache: "no-store" });
      const blob = await res.blob();
      const tEnd = performance.now();
      
      latencies.push(tEnd - tStart);
      totalSize += blob.size;
      totalDuration += (tEnd - tStart);
    }

    // Calculate Jitter (Standard Deviation of latency)
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const variance = latencies.reduce((a, b) => a + Math.pow(b - avgLatency, 2), 0) / latencies.length;
    const jitter = Math.sqrt(variance);

    const kbps = ((totalSize * 8) / (totalDuration / 1000)) / 1000;

    return {
      timestamp: Date.now(),
      downloadSpeedKbps: Math.round(kbps),
      latencyMs: Math.round(avgLatency),
      jitterMs: Math.round(jitter)
    };

  } catch (error) {
     return {
      timestamp: Date.now(),
      downloadSpeedKbps: 0,
      latencyMs: 0,
      jitterMs: 0
    };
  }
}

export const formatSpeed = (kbps: number): string => {
  if (kbps >= 1000) {
    return `${(kbps / 1000).toFixed(2)} Mbps`;
  }
  return `${Math.round(kbps)} Kbps`;
};