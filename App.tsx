import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, BrainCircuit, RefreshCw, Activity, Globe, Gauge, Zap, Waves, Settings, Sparkles } from 'lucide-react';
import SpeedChart from './components/SpeedChart';
import Indicator from './components/Indicator';
import MonitorView from './components/MonitorView'; // New Import
import { performSpeedTest, performStressTest, performStabilityTest, formatSpeed } from './utils/networkUtils';
import { geminiService } from './services/geminiService';
import { SpeedData, ConnectionStatus, AIAnalysisResult, TestMode } from './types';

// How often to test speed in auto mode (ms)
const TEST_INTERVAL = 1000; // Decreased to 1000ms for faster updates
// Threshold for GFW throttling detection (kbps)
const THROTTLE_THRESHOLD = 100; 
const AI_KEY_STORAGE = 'netguard_probe_ai_key';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'probe' | 'monitor'>('probe');

  // --- Probe State ---
  const [testMode, setTestMode] = useState<TestMode>('STANDARD');
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [speedHistory, setSpeedHistory] = useState<SpeedData[]>([]);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [currentJitter, setCurrentJitter] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.IDLE);
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // AI Config State for Probe
  const [aiApiKey, setAiApiKey] = useState<string>(() => {
    if (typeof window !== 'undefined') {
        return localStorage.getItem(AI_KEY_STORAGE) || '';
    }
    return '';
  });
  const [showProbeSettings, setShowProbeSettings] = useState(false);
  
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRunningTestRef = useRef(false);

  // Save AI Key
  useEffect(() => {
     localStorage.setItem(AI_KEY_STORAGE, aiApiKey);
  }, [aiApiKey]);

  // Helper to run a single test cycle
  const runTestCycle = useCallback(async () => {
    // Prevent overlapping tests
    if (isRunningTestRef.current) return;
    isRunningTestRef.current = true;

    setStatus(ConnectionStatus.TESTING);
    let data: SpeedData;

    try {
        // SELECT STRATEGY BASED ON MODE
        switch (testMode) {
            case 'TURBO':
                data = await performStressTest();
                break;
            case 'STABILITY':
                data = await performStabilityTest();
                break;
            case 'STANDARD':
            default:
                data = await performSpeedTest();
                break;
        }
        
        // Update State
        setSpeedHistory(prev => {
          const updated = [...prev, data];
          return updated.slice(-30); // Keep last 30 points
        });
        setCurrentSpeed(data.downloadSpeedKbps);
        setCurrentJitter(data.jitterMs);

        // Determine Status
        if (data.downloadSpeedKbps === 0) {
          setStatus(ConnectionStatus.OFFLINE);
        } else if (data.downloadSpeedKbps < THROTTLE_THRESHOLD) {
          setStatus(ConnectionStatus.THROTTLED);
        } else if (data.jitterMs && data.jitterMs > 200) {
          // If Jitter is high (only available in Stability mode usually)
          setStatus(ConnectionStatus.UNSTABLE);
        } else {
          setStatus(ConnectionStatus.GOOD);
        }
    } finally {
        isRunningTestRef.current = false;
    }
  }, [testMode]);

  // Effect to handle the monitoring loop (Only if Probe tab is active)
  useEffect(() => {
    if (activeTab === 'probe' && isMonitoring) {
      runTestCycle(); // Run one immediately
      timerRef.current = setInterval(runTestCycle, TEST_INTERVAL);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (activeTab !== 'probe') {
        setIsMonitoring(false); // Stop monitoring if we switch tabs
      }
      setStatus(ConnectionStatus.IDLE);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isMonitoring, activeTab, runTestCycle]);

  // AI Analysis Handler for Probe
  const handleAIAnalysis = async () => {
    if (speedHistory.length < 3) return;
    setIsAnalyzing(true);
    const result = await geminiService.analyzeNetworkPattern(speedHistory, status, aiApiKey);
    setAiResult(result);
    setIsAnalyzing(false);
  };

  const toggleMonitoring = () => {
    setIsMonitoring(!isMonitoring);
    if (!isMonitoring) {
        setSpeedHistory([]);
        setAiResult(null);
        setCurrentJitter(undefined);
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-emerald-500/30">
      
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_#10b981]"></div>
            <h1 className="text-lg font-bold tracking-wider text-emerald-400">NETGUARD <span className="text-zinc-500 font-normal">PROBE</span></h1>
          </div>
          <div className="text-xs text-zinc-500 font-mono hidden sm:block">
             v1.2.0 • GFW DETECTOR
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        
        {/* Navigation Tabs */}
        <div className="flex p-1 bg-zinc-900 rounded-lg border border-zinc-800">
          <button 
            onClick={() => setActiveTab('probe')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-bold transition-all ${
              activeTab === 'probe' ? 'bg-zinc-800 text-emerald-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Activity className="w-4 h-4" /> LOCAL PROBE
          </button>
          <button 
             onClick={() => setActiveTab('monitor')}
             className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-bold transition-all ${
              activeTab === 'monitor' ? 'bg-zinc-800 text-purple-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Globe className="w-4 h-4" /> PANEL MONITOR
          </button>
        </div>

        {/* --- LOCAL PROBE VIEW --- */}
        {activeTab === 'probe' && (
          <div className="animate-in fade-in zoom-in-95 duration-300 space-y-6">
            
            {/* Test Mode Selector */}
            <div className="grid grid-cols-3 gap-2">
                <button 
                    onClick={() => !isMonitoring && setTestMode('STANDARD')}
                    disabled={isMonitoring}
                    className={`p-3 rounded-lg border text-xs font-bold flex flex-col items-center gap-2 transition-all ${
                        testMode === 'STANDARD' 
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' 
                        : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                    } ${isMonitoring ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <Gauge className="w-5 h-5" />
                    STANDARD
                </button>
                <button 
                    onClick={() => !isMonitoring && setTestMode('TURBO')}
                    disabled={isMonitoring}
                    className={`p-3 rounded-lg border text-xs font-bold flex flex-col items-center gap-2 transition-all ${
                        testMode === 'TURBO' 
                        ? 'bg-blue-500/10 border-blue-500 text-blue-400' 
                        : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                    } ${isMonitoring ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <Zap className="w-5 h-5" />
                    TURBO STRESS
                </button>
                <button 
                    onClick={() => !isMonitoring && setTestMode('STABILITY')}
                    disabled={isMonitoring}
                    className={`p-3 rounded-lg border text-xs font-bold flex flex-col items-center gap-2 transition-all ${
                        testMode === 'STABILITY' 
                        ? 'bg-orange-500/10 border-orange-500 text-orange-400' 
                        : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700'
                    } ${isMonitoring ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <Waves className="w-5 h-5" />
                    LATENCY JITTER
                </button>
            </div>
            
            <div className="bg-zinc-900/30 p-3 rounded-lg border border-zinc-800/50 text-center flex flex-col items-center justify-center">
                <p className="text-xs text-zinc-400">
                  {testMode === 'STANDARD' && "Basic single-stream download to detect hard throttling (100kbps limit)."}
                  {testMode === 'TURBO' && "Multi-threaded (4x) concurrent streams. Detects if throttling is per-connection or per-IP."}
                  {testMode === 'STABILITY' && "Rapid sequential probing. High Jitter indicates packet loss or unstable handshake (GFW active probing)."}
                </p>
            </div>

            <Indicator status={status} currentSpeed={currentSpeed} />

            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={toggleMonitoring}
                className={`flex items-center justify-center gap-2 p-4 rounded-lg font-bold transition-all ${
                  isMonitoring 
                  ? 'bg-red-500/10 text-red-500 border border-red-500/50 hover:bg-red-500/20' 
                  : 'bg-emerald-500 text-black hover:bg-emerald-400'
                }`}
              >
                {isMonitoring ? (
                  <><Square className="w-5 h-5" /> STOP TEST</>
                ) : (
                  <><Play className="w-5 h-5" /> START {testMode}</>
                )}
              </button>

              <button 
                onClick={handleAIAnalysis}
                disabled={speedHistory.length === 0 || isAnalyzing}
                className="flex items-center justify-center gap-2 p-4 rounded-lg bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isAnalyzing ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <BrainCircuit className={`w-5 h-5 ${aiApiKey ? 'text-emerald-400' : 'text-zinc-400'}`} />
                )}
                <span>AI DIAGNOSIS</span>
              </button>
            </div>

            {/* AI Key Config Toggle */}
            <div className="flex justify-center">
                 <button 
                    onClick={() => setShowProbeSettings(!showProbeSettings)}
                    className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                 >
                    <Settings className="w-3 h-3" />
                    {showProbeSettings ? 'Hide AI Settings' : 'Configure AI Settings'}
                 </button>
            </div>
            
            {showProbeSettings && (
                 <div className="animate-in fade-in slide-in-from-top-2 bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
                    <label className="block text-xs font-mono text-zinc-400 uppercase mb-2 flex items-center gap-2">
                        <Sparkles className="w-3 h-3 text-yellow-500" />
                        Gemini API Key (Required for Diagnosis)
                    </label>
                    <input 
                        type="password" 
                        placeholder="Enter Google Gemini API Key"
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                        className="w-full bg-black border border-zinc-700 rounded p-2 text-zinc-200 text-sm focus:border-yellow-500 outline-none"
                    />
                    <p className="text-[10px] text-zinc-600 mt-2">
                        Your API key is stored locally in your browser. Get one at <a href="https://aistudio.google.com/" target="_blank" className="text-blue-500 hover:underline">aistudio.google.com</a>.
                    </p>
                 </div>
            )}

            {/* Real-time Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
                <div className="text-zinc-500 text-xs mb-1 uppercase">Current Speed</div>
                <div className={`text-2xl font-mono ${currentSpeed < THROTTLE_THRESHOLD && currentSpeed > 0 ? 'text-red-500' : 'text-white'}`}>
                  {formatSpeed(currentSpeed)}
                </div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
                <div className="text-zinc-500 text-xs mb-1 uppercase">Samples</div>
                <div className="text-2xl font-mono text-white">{speedHistory.length}</div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
                <div className="text-zinc-500 text-xs mb-1 uppercase">Jitter / Stability</div>
                <div className={`text-2xl font-mono ${currentJitter && currentJitter > 100 ? 'text-orange-500' : 'text-white'}`}>
                    {currentJitter ? `${currentJitter} ms` : 'N/A'}
                </div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg">
                <div className="text-zinc-500 text-xs mb-1 uppercase">Avg Latency</div>
                <div className="text-2xl font-mono text-white">
                  {speedHistory.length > 0 
                    ? Math.round(speedHistory.reduce((acc, curr) => acc + curr.latencyMs, 0) / speedHistory.length) 
                    : 0} ms
                </div>
              </div>
            </div>

            <SpeedChart data={speedHistory} />

            {/* AI Result Section */}
            {aiResult && (
              <div className={`p-6 rounded-lg border backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-500 ${
                aiResult.status === 'safe' 
                  ? 'bg-emerald-900/10 border-emerald-500/30' 
                  : 'bg-red-900/10 border-red-500/30'
              }`}>
                <h3 className="flex items-center gap-2 text-lg font-bold mb-4">
                    <BrainCircuit className={`w-5 h-5 ${aiResult.status === 'safe' ? 'text-emerald-500' : 'text-red-500'}`} />
                    AI Network Analysis
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <div className="text-xs text-zinc-500 uppercase mb-1">Analysis (Burmese)</div>
                    <p className="text-zinc-200 leading-relaxed font-sans">{aiResult.message}</p>
                  </div>
                  
                  <div>
                    <div className="text-xs text-zinc-500 uppercase mb-1">Recommendation</div>
                    <p className="text-zinc-300 font-mono text-sm bg-black/20 p-3 rounded border border-white/5">
                      {aiResult.recommendation}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- PANEL MONITOR VIEW --- */}
        {activeTab === 'monitor' && (
          <MonitorView />
        )}

      </main>
    </div>
  );
};

export default App;