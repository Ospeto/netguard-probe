export interface SpeedData {
  timestamp: number;
  downloadSpeedKbps: number; // Kilobits per second
  latencyMs: number;
  jitterMs?: number; // New: Variation in latency
  packetLoss?: number; // Simulated packet loss score (0-100)
}

export enum ConnectionStatus {
  IDLE = 'IDLE',
  TESTING = 'TESTING',
  GOOD = 'GOOD',
  THROTTLED = 'THROTTLED', // The < 100kbps state
  OFFLINE = 'OFFLINE',
  UNSTABLE = 'UNSTABLE' // New status for high jitter
}

export type TestMode = 'STANDARD' | 'TURBO' | 'STABILITY';

export interface AIAnalysisResult {
  status: 'safe' | 'warning' | 'critical';
  message: string;
  recommendation: string;
}

// --- New Types for Panel Monitor ---

export interface PanelConfig {
  apiUrl: string;
  apiToken: string;
  // Telegram Additions
  telegramBotToken?: string;
  telegramChatId?: string;
  lastTelegramUpdateId?: number; // New: Track processed messages
  useCorsProxy?: boolean; // New: Toggle to fix CORS errors
  customProxyUrl?: string; // New: Allow user to override proxy
  geminiApiKey?: string; // New: Optional custom API Key for AI features
}

export interface NodeStatus {
  name: string;
  protocol: string;
  onlineUsers: number;
  currentSpeedKbps: number; // Combined Up/Down
  averageSpeedKbps?: number; // New: 1-Hour Rolling Average
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  isConnected?: boolean;
}

export interface PanelAnalysisResult {
  nodes: NodeStatus[];
  globalAnalysis: string;
  recommendation: string;
}