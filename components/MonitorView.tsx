import React, { useState, useEffect, useRef } from 'react';
import { PanelConfig, PanelAnalysisResult, NodeStatus, TestMode, SpeedData } from '../types';
import { geminiService } from '../services/geminiService';
import { performSpeedTest, performStressTest, performStabilityTest, formatSpeed } from '../utils/networkUtils';
import { Server, Zap, Users, AlertTriangle, CheckCircle, RefreshCw, Key, Globe, Shield, Play, Square, Timer, Send, Bell, Clock, Activity, Info, Loader2, Check, XCircle, Gauge, Waves, Globe2, Sparkles, BarChart3, X, Bot, ShieldAlert, ShieldCheck, Radio, Divide, Settings2 } from 'lucide-react';
import SpeedChart from './SpeedChart';

// Define explicit type for Bot Status to ensure consistency across State, Refs, and Logic
type TelegramBotStatus = 'unknown' | 'checking' | 'connected' | 'failed' | 'forbidden';

const MonitorView: React.FC = () => {
  const STORAGE_KEY = 'netguard_panel_config_v5';

  // Config State with Persistence
  const [config, setConfig] = useState<PanelConfig>(() => {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try { return JSON.parse(saved); } catch(e) { console.error(e); }
        }
    }
    // Default Fallback
    return {
        apiUrl: 'https://rempanel.yamoe.xyz/', 
        apiToken: '', // Default empty to force user entry
        telegramBotToken: '8386063491:AAFAJcThVM-B3it6EuPwrBz7JdpQCIyw2jE',
        telegramChatId: '532666374',
        useCorsProxy: true, // Default to true for better browser compatibility
        customProxyUrl: '', // Allow user to override
        geminiApiKey: ''
    };
  });
  
  const configRef = useRef(config);
  
  useEffect(() => {
      configRef.current = config;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const [isLoading, setIsLoading] = useState(false);
  const [checkingNode, setCheckingNode] = useState<string | null>(null);
  const [nodeFeedback, setNodeFeedback] = useState<Record<string, 'active' | 'idle' | null>>({});
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(Date.now());
  const [latestAnalysis, setLatestAnalysis] = useState<PanelAnalysisResult | null>(null);
  const latestAnalysisRef = useRef<PanelAnalysisResult | null>(null);
  
  // Sync Ref for Polling Access
  useEffect(() => {
      latestAnalysisRef.current = latestAnalysis;
  }, [latestAnalysis]);
  
  // Charting & History State
  const [selectedNodeForChart, setSelectedNodeForChart] = useState<string | null>(null);
  // nodeHistory for Chart (last 50 points)
  const [nodeHistory, setNodeHistory] = useState<Record<string, SpeedData[]>>({});
  
  // Long-term history for Average calculation (Store only necessary data: timestamp, speed)
  // Ref is better for high frequency updates without re-renders, but we need re-render to show avg
  const longTermHistoryRef = useRef<Record<string, {t: number, v: number}[]>>({});

  // Probe State
  const [probeMode, setProbeMode] = useState<TestMode>('STANDARD');
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<SpeedData | null>(null);
  
  // Enhanced Error State
  const [error, setError] = useState<{ title: string; message: string; tip?: string } | null>(null);
  const [result, setResult] = useState<PanelAnalysisResult | null>(null);
  
  // SCAN INTERVAL STATE
  // 0 = Manual, 1000 = Live (1s), 5000 = Eco (5s)
  const [scanInterval, setScanInterval] = useState<number>(0); 
  
  const [showTelegramSettings, setShowTelegramSettings] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  
  // Telegram Status State - Using Explicit Type
  const [botStatus, setBotStatus] = useState<TelegramBotStatus>('unknown');
  const [botError, setBotError] = useState<string | null>(null);
  const [botName, setBotName] = useState<string>('');
  const [lastPollTime, setLastPollTime] = useState<number>(0);
  
  // Auto Detect Chat ID
  const [isDetectingChatId, setIsDetectingChatId] = useState(false);
  const isDetectingChatIdRef = useRef(false);
  useEffect(() => { isDetectingChatIdRef.current = isDetectingChatId; }, [isDetectingChatId]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Telegram Polling Refs
  const telegramLoopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPollingRef = useRef(false);
  // Ref to track status inside async loop - Using Explicit Type
  const botStatusRef = useRef<TelegramBotStatus>(botStatus); 
  
  // Sync botStatus ref
  useEffect(() => {
    botStatusRef.current = botStatus;
  }, [botStatus]);

  const lastNotificationTimeRef = useRef<number>(0);
  const isFetchingRef = useRef(false);

  // --- Telegram Logic ---

  // Enhanced Telegram API Caller with Error Throwing
  const callTelegramApi = async (method: string, params: Record<string, any> = {}) => {
      const currentConfig = configRef.current;
      if (!currentConfig.telegramBotToken) throw new Error("Bot Token missing");

      const buildUrl = (useProxy: boolean) => {
          let url = `https://api.telegram.org/bot${currentConfig.telegramBotToken}/${method}`;
          const searchParams = new URLSearchParams();
          Object.keys(params).forEach(key => searchParams.append(key, String(params[key])));
          
          // CRITICAL FIX: Add Cache Buster to prevent proxy/browser caching
          searchParams.append('_cb', Date.now().toString());

          if (searchParams.toString()) url += `?${searchParams.toString()}`;
          
          if (useProxy) {
              const proxyBase = currentConfig.customProxyUrl || 'https://corsproxy.io/?';
              return `${proxyBase}${encodeURIComponent(url)}`;
          }
          return url;
      };

      const doFetch = async (targetUrl: string) => {
         const res = await fetch(targetUrl);
         const contentType = res.headers.get("content-type");
         if (contentType && contentType.indexOf("application/json") !== -1) {
             const json = await res.json();
             return { ok: res.ok, status: res.status, json };
         }
         const text = await res.text();
         throw new Error(`Proxy/Network Error: ${res.status} ${text.substring(0, 50)}`);
      };

      try {
          // Determine if we should start with proxy
          let useProxy = currentConfig.useCorsProxy !== false; // Default to true if undefined
          let url = buildUrl(useProxy);
          
          let response;
          try {
             response = await doFetch(url);
          } catch (e: any) {
             // Only retry if it's a network error, NOT if it's a 403/401
             if (!useProxy && !e.message.includes("403") && !e.message.includes("401")) {
                 console.log("Retrying with Proxy...");
                 setConfig(prev => ({ ...prev, useCorsProxy: true })); // Save preference
                 url = buildUrl(true);
                 response = await doFetch(url);
             } else {
                 throw e;
             }
          }

          if (response.json && response.json.ok) {
              return response.json;
          } else {
              // Extract telegram-specific error
              const errMsg = response.json?.description || `Telegram API Error ${response.status}`;
              throw new Error(errMsg);
          }
      } catch (e: any) {
          throw e;
      }
  };

  const verifyBotConnection = async () => {
    if (!config.telegramBotToken) return;
    setBotStatus('checking');
    setBotError(null);
    
    try {
        const data = await callTelegramApi('getMe');
        if (data && data.ok) {
            setBotStatus('connected');
            setBotName(data.result.first_name);
            setBotError(null);
            
            // Ensure loop is running if connected
            if (!isPollingRef.current) {
                runTelegramPoll();
            }
        }
    } catch (e: any) {
        setBotStatus('failed');
        setBotError(e.message);
        setBotName('');
    }
  };

  const sendTelegramNotification = async (message: string, force = false, targetChatId?: string) => {
    const currentConfig = configRef.current;
    const chatId = targetChatId || currentConfig.telegramChatId;
    
    // Stop trying if we are forbidden
    if (botStatusRef.current === 'forbidden') {
        console.warn("Telegram notification skipped: Bot is forbidden.");
        return;
    }
    
    if (!currentConfig.telegramBotToken || !chatId) {
        setBotError("Missing Token or Chat ID");
        return;
    }

    const now = Date.now();
    if (!force && now - lastNotificationTimeRef.current < 5 * 60 * 1000) {
      console.log("Notification skipped due to rate limit.");
      return;
    }

    try {
      try {
        await callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });
      } catch (err: any) {
        if (err.message && (err.message.includes("400") || err.message.includes("Bad Request"))) {
            console.warn("Markdown send failed, retrying with plain text...");
            await callTelegramApi('sendMessage', {
                chat_id: chatId,
                text: message.replace(/\*/g, '').replace(/`/g, ''),
            });
        } else {
            throw err;
        }
      }

      if (!force) lastNotificationTimeRef.current = now;
      if (botStatus !== 'connected') setBotStatus('connected');
    } catch (e: any) {
      console.error("Send Error:", e);
      let errorMsg = e.message;
      if (errorMsg.includes("403") || errorMsg.includes("Forbidden")) {
          setBotStatus('forbidden');
          setBotError("Bot was blocked by user or kicked from group (403).");
          return;
      }
      if (errorMsg.includes("chat not found")) {
          errorMsg = "Chat not found. Start the bot and send /start.";
      }
      setBotError(`Send Failed: ${errorMsg}`);
    }
  };

  const handleTestNotification = async () => {
    setIsSendingTest(true);
    setBotError(null);
    try {
        await verifyBotConnection(); 
        await sendTelegramNotification("✅ **NetGuard Test**\n\nYour Telegram configuration is working correctly.", true);
    } catch (e: any) {
         let errorMsg = e.message;
         if (errorMsg.includes("chat not found")) {
            errorMsg = "Chat not found. Please click 'Auto-Detect' and send /start to your bot.";
         }
        setBotError(errorMsg);
    } finally {
        setIsSendingTest(false);
    }
  };

  // --- Telegram Polling Loop ---
  const runTelegramPoll = async () => {
      // STOP if forbidden to prevent spamming logs
      if ((botStatusRef.current as TelegramBotStatus) === 'forbidden') return;
      if (!configRef.current.telegramBotToken) return;
      if (isPollingRef.current) return;
      
      isPollingRef.current = true;

      try {
          const currentConfig = configRef.current;
          const offset = (currentConfig.lastTelegramUpdateId || 0) + 1;
          
          const data = await callTelegramApi('getUpdates', {
              offset: offset,
              timeout: 0, 
              limit: 5
          });
          
          setLastPollTime(Date.now());

          if (botStatusRef.current === 'failed') {
               setBotStatus('connected');
               setBotError(null);
          }

          if (data && data.result.length > 0) {
              let maxId = currentConfig.lastTelegramUpdateId || 0;
              
              for (const update of data.result) {
                  if (update.update_id > maxId) maxId = update.update_id;
                  
                  const message = update.message;
                  if (message && message.text) {
                      const text = message.text.toLowerCase().trim();
                      const chatId = message.chat.id;
                      
                      if (isDetectingChatIdRef.current) {
                          setConfig(prev => ({ ...prev, telegramChatId: String(chatId) }));
                          setIsDetectingChatId(false);
                          await callTelegramApi('sendMessage', {
                              chat_id: chatId,
                              text: `✅ **NetGuard Configured!**\n\nChat ID \`${chatId}\` has been saved.`,
                              parse_mode: 'Markdown'
                          });
                          continue;
                      }

                      if (text === '/start' || text === '/help') {
                          const helpMsg = `🛡️ *NetGuard Bot Commands*\n\n` +
                                          `🔍 /scan - Force immediate network scan\n` +
                                          `📊 /status - View global system summary\n` +
                                          `🌐 /nodes - List nodes (sorted by status)\n` +
                                          `🏓 /ping - Check bot connectivity`;
                          await sendTelegramNotification(helpMsg, true, String(chatId));
                      } 
                      
                      else if (text === '/scan') {
                           await sendTelegramNotification("🔄 *Scanning Network...*", true, String(chatId));
                           const freshResult = await fetchAndAnalyze(false);
                           if (freshResult) {
                               const criticalCount = freshResult.nodes.filter(n => n.status === 'critical').length;
                               const warningCount = freshResult.nodes.filter(n => n.status === 'warning').length;
                               const statusIcon = criticalCount > 0 ? '🚨' : warningCount > 0 ? '⚠️' : '✅';
                               
                               let summary = `*Global Status:* ${freshResult.globalAnalysis}\n\n`;
                               
                               if (criticalCount > 0) {
                                   summary += `🔴 *Critical Issues Detected on ${criticalCount} nodes.*\nUse /nodes to view details.`;
                               } else if (warningCount > 0) {
                                   summary += `⚠️ *Warnings on ${warningCount} nodes.*\nUse /nodes to view details.`;
                               } else {
                                   summary += `✨ All nodes are operating normally.`;
                               }

                               await sendTelegramNotification(
                                   `${statusIcon} *Scan Complete*\n\n${summary}`, 
                                   true, 
                                   String(chatId)
                               );
                           } else {
                               await sendTelegramNotification("❌ Scan Failed. Check Panel URL/Token.", true, String(chatId));
                           }
                      }

                      else if (text === '/status') {
                          const analysis = latestAnalysisRef.current;
                          if (analysis) {
                              const activeNodes = analysis.nodes.filter(n => n.onlineUsers > 0).length;
                              const criticalNodes = analysis.nodes.filter(n => n.status === 'critical').length;
                              const totalUsers = analysis.nodes.reduce((acc, curr) => acc + curr.onlineUsers, 0);
                              
                              const reply = `📊 *System Status Report*\n\n` +
                                            `⚡ *Overall Health*: ${criticalNodes > 0 ? 'Critical' : 'Nominal'}\n` +
                                            `🟢 Active Nodes: \`${activeNodes}\`\n` +
                                            `👥 Total Users: \`${totalUsers}\`\n` +
                                            `🔴 Critical Issues: \`${criticalNodes}\`\n\n` +
                                            `_Last Updated: ${new Date(analysisRefTimestamp()).toLocaleTimeString()}_`;
                              
                              await sendTelegramNotification(reply, true, String(chatId));
                          } else {
                              await sendTelegramNotification("⚠️ No data. Use /scan to fetch first.", true, String(chatId));
                          }
                      }

                      else if (text === '/nodes') {
                          const analysis = latestAnalysisRef.current;
                          if (analysis && analysis.nodes.length > 0) {
                              let message = `🌐 *Node Connections*\n`;
                              const sortedNodes = [...analysis.nodes].sort((a, b) => {
                                  const statusScore = (s: string) => s === 'critical' ? 3 : s === 'warning' ? 2 : 1;
                                  const scoreA = statusScore(a.status);
                                  const scoreB = statusScore(b.status);
                                  if (scoreA !== scoreB) return scoreB - scoreA;
                                  return b.onlineUsers - a.onlineUsers;
                              });

                              const chunk = sortedNodes.slice(0, 15);
                              chunk.forEach(n => {
                                  const icon = n.status === 'critical' ? '🔴' : n.status === 'warning' ? '⚠️' : '🟢';
                                  const speed = n.currentSpeedKbps > 1000 
                                    ? `${(n.currentSpeedKbps/1000).toFixed(1)}M` 
                                    : `${Math.round(n.currentSpeedKbps)}K`;
                                  const cleanName = n.name.replace(/[_*`]/g, ' ');
                                  const extra = n.status === 'critical' ? `\n   ⚠️ _${n.message}_` : '';

                                  message += `\n${icon} *${cleanName}*\n` +
                                             `   └ 👥 ${n.onlineUsers}  |  ⚡ ${speed}bps${extra}`;
                              });

                              if (sortedNodes.length > 15) {
                                  message += `\n\n_...and ${sortedNodes.length - 15} more nodes_`;
                              }
                              await sendTelegramNotification(message, true, String(chatId));
                          } else {
                              await sendTelegramNotification("⚠️ No node data. Use /scan first.", true, String(chatId));
                          }
                      }

                      else if (text === '/ping') {
                          await sendTelegramNotification("🏓 Pong!", true, String(chatId));
                      }
                  }
              }

              if (maxId > (configRef.current.lastTelegramUpdateId || 0)) {
                   setConfig(prev => ({ ...prev, lastTelegramUpdateId: maxId }));
              }
          }
      } catch (e: any) {
          // DO NOT LOG if forbidden, just silence it
          if (e.message.includes("403") || e.message.includes("Forbidden")) {
              setBotStatus('forbidden');
              setBotError("Access Denied (403). Bot blocked or removed.");
              isPollingRef.current = false;
              return; // STOP LOOP
          }
          
          if (e.message.includes("401") || e.message.includes("Unauthorized")) {
              setBotStatus('failed');
              setBotError("Invalid Bot Token.");
              isPollingRef.current = false;
              return; // STOP LOOP
          } 

          // Network glitches are fine, just warn
          console.warn("Poll Warning:", e.message);
          if (botStatusRef.current === 'connected') {
               setBotError(`Polling Error: ${e.message.substring(0, 30)}...`);
          }
      } finally {
          isPollingRef.current = false;
          // Only reschedule if NOT forbidden
          if (configRef.current.telegramBotToken && botStatusRef.current !== 'forbidden') {
              const delay = botStatusRef.current === 'connected' ? 2000 : 10000;
              telegramLoopTimeoutRef.current = setTimeout(runTelegramPoll, delay);
          }
      }
  };

  const analysisRefTimestamp = () => Date.now();

  const checkAndNotify = (analysis: PanelAnalysisResult) => {
    const criticalNodes = analysis.nodes.filter(n => n.status === 'critical');
    const warningNodes = analysis.nodes.filter(n => n.status === 'warning');
    const highLoadNodes = analysis.nodes.filter(n => n.onlineUsers > 50);

    let messageParts: string[] = [];

    if (criticalNodes.length > 0) {
      const nodeList = criticalNodes.slice(0, 5).map(n => 
        `- *${n.name.replace(/[_*]/g, ' ')}*: ${n.onlineUsers} users, ${n.currentSpeedKbps} kbps`
      ).join('\n');
      
      let header = `🚨 **GFW Throttling Alert**\n\nDetected ${criticalNodes.length} node(s) with likely speed limits:\n${nodeList}`;
      if (criticalNodes.length > 5) {
          header += `\n...and ${criticalNodes.length - 5} more.`;
      }
      messageParts.push(header);
    }

    if (highLoadNodes.length > 0 && criticalNodes.length === 0) {
      const loadList = highLoadNodes.slice(0, 5).map(n => `- *${n.name.replace(/[_*]/g, ' ')}*: ${n.onlineUsers} users`).join('\n');
      messageParts.push(`🔥 **High Load Alert**\n\n${highLoadNodes.length} node(s) have >50 active users:\n${loadList}`);
    }

    if (messageParts.length > 0) {
      const combinedMessage = messageParts.join('\n\n----------------\n\n') + `\n\n⚠️ Advice: ${analysis.recommendation}`;
      sendTelegramNotification(combinedMessage);
    }
  };

  // --- Client Probe Logic ---
  const runProbe = async () => {
    setIsProbing(true);
    setProbeResult(null);
    let data: SpeedData;
    
    try {
        if (probeMode === 'TURBO') {
            data = await performStressTest();
        } else if (probeMode === 'STABILITY') {
            data = await performStabilityTest();
        } else {
            data = await performSpeedTest();
        }
        setProbeResult(data);
    } catch (e) {
        console.error("Probe failed", e);
    } finally {
        setIsProbing(false);
    }
  };

  // --- Main Fetch Logic ---
  
  // Resilient Fetch with Auto-Proxy Fallback
  const smartFetch = async (url: string, headers: HeadersInit) => {
      const currentConfig = configRef.current;
      const separator = url.includes('?') ? '&' : '?';
      const urlWithCache = `${url}${separator}_t=${Date.now()}`;
      
      const getProxyUrl = (u: string) => {
        const proxyBase = currentConfig.customProxyUrl || 'https://corsproxy.io/?';
        return `${proxyBase}${encodeURIComponent(u)}`;
      };
      
      let fetchUrl = currentConfig.useCorsProxy ? getProxyUrl(urlWithCache) : urlWithCache;
      
      try {
          // Explicitly set mode to cors to ensure browser handles it correctly
          const response = await fetch(fetchUrl, { method: 'GET', headers, mode: 'cors' });
          return response;
      } catch (error) {
          if (!currentConfig.useCorsProxy) {
              console.log("Direct fetch failed. Retrying with CORS Proxy...");
              try {
                  const proxyUrl = getProxyUrl(urlWithCache);
                  const proxyResponse = await fetch(proxyUrl, { method: 'GET', headers, mode: 'cors' });
                  setConfig(prev => ({ ...prev, useCorsProxy: true }));
                  return proxyResponse;
              } catch (retryError) {
                  throw retryError;
              }
          }
          throw error;
      }
  };

  const fetchAndAnalyze = async (showLoadingState = true) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    const currentConfig = configRef.current;
    
    setError(null);

    if (!currentConfig.apiUrl) {
      setError({
        title: "Configuration Missing",
        message: "Panel Domain URL is required.",
        tip: "Please enter your Remnawave Panel URL above."
      });
      isFetchingRef.current = false;
      return;
    }

    if (!currentConfig.apiToken) {
        setError({
            title: "Authentication Required",
            message: "Please enter your Admin API Token.",
            tip: "An API Token is required to fetch node status. Check your panel settings."
        });
        isFetchingRef.current = false;
        if (showLoadingState) setIsLoading(false);
        return;
    }
    
    if (showLoadingState) setIsLoading(true);

    let baseUrl = currentConfig.apiUrl.trim().replace(/\/$/, "");
    if (!/^https?:\/\//i.test(baseUrl)) {
      baseUrl = `https://${baseUrl}`;
    }

    const nodesEndpoint = `${baseUrl}/api/nodes`;
    const statsEndpoint = `${baseUrl}/api/bandwidth-stats/nodes/realtime`;

    try {
      const headers: HeadersInit = { 'Accept': 'application/json' };
      // Robust Token Handling: Remove duplicate 'Bearer' if user pasted it
      const cleanToken = currentConfig.apiToken.trim().replace(/^Bearer\s+/i, '');
      headers['Authorization'] = `Bearer ${cleanToken}`;

      const [nodesRes, statsRes] = await Promise.all([
        smartFetch(nodesEndpoint, headers).catch(e => ({ ok: false, status: 0, statusText: e.message })),
        smartFetch(statsEndpoint, headers).catch(e => ({ ok: false, status: 0, statusText: e.message }))
      ]);

      if ('status' in nodesRes && !nodesRes.ok) {
        const status = nodesRes.status;
        if (status === 0) throw new Error("CORS_ERROR");
        if (status === 401 || status === 403) throw new Error("AUTH_ERROR");
        if (status === 404) throw new Error("NOT_FOUND");
        if (status >= 500) throw new Error("SERVER_ERROR");
        throw new Error(`HTTP_${status}`);
      }

      // @ts-ignore
      const nodesData = await nodesRes.json();
      let statsData = { response: [] };
      
      // @ts-ignore
      if (statsRes.ok) {
         try {
             // @ts-ignore
             statsData = await statsRes.json();
         } catch(e) { console.warn("Stats parse error", e); }
      }
      
      const combinedPayload = {
        nodes: nodesData.response || nodesData, 
        realtime_stats: statsData.response || statsData
      };

      const aiKey = currentConfig.geminiApiKey;
      const analysis = await geminiService.analyzePanelData(combinedPayload, aiKey);
      
      // --- AVG CALCULATION LOGIC ---
      const now = Date.now();
      const ONE_HOUR = 3600 * 1000;
      
      // Update History
      const nextHistory = { ...longTermHistoryRef.current };
      
      analysis.nodes.forEach(node => {
         if (!nextHistory[node.name]) nextHistory[node.name] = [];
         
         // Add point
         nextHistory[node.name].push({ t: now, v: node.currentSpeedKbps });
         
         // Prune old
         nextHistory[node.name] = nextHistory[node.name].filter(p => now - p.t < ONE_HOUR);
         
         // Calculate Avg
         const count = nextHistory[node.name].length;
         if (count > 0) {
             const sum = nextHistory[node.name].reduce((acc, curr) => acc + curr.v, 0);
             node.averageSpeedKbps = Math.round(sum / count);
         } else {
             node.averageSpeedKbps = 0;
         }
      });
      
      longTermHistoryRef.current = nextHistory;
      // -----------------------------

      setResult(analysis);
      setLatestAnalysis(analysis); 
      setLastUpdateTime(Date.now());

      setNodeHistory(prev => {
        const next = { ...prev };
        analysis.nodes.forEach(node => {
          const point: SpeedData = {
            timestamp: now,
            downloadSpeedKbps: node.currentSpeedKbps,
            latencyMs: 0 
          };
          const history = next[node.name] || [];
          next[node.name] = [...history, point].slice(-50); 
        });
        return next;
      });

      if (scanInterval > 0) {
        checkAndNotify(analysis);
      }
      
      return analysis; 

    } catch (err: any) {
      console.error("Fetch Error:", err);
      
      let errorState = {
        title: "Connection Failed",
        message: err.message || "Unknown error occurred.",
        tip: "Check your internet connection and try again."
      };

      if (err.message === 'CORS_ERROR' || err.message === 'Failed to fetch' || err.message.includes('NetworkError') || err.message === 'CORS_0') {
          errorState = {
              title: "Network or CORS Error",
              message: "Failed to connect to Panel API. The CORS Proxy might be failing.",
              tip: "1. Ensure Panel URL is correct.\n2. Try enabling/disabling CORS Proxy.\n3. Check 'Advanced Settings' to try a different proxy."
          };
          // Switch to ECO mode if network is bad, instead of stopping completely, unless it's a hard fail
          if (scanInterval === 1000) setScanInterval(5000); 
      } else if (err.message === 'AUTH_ERROR') {
          errorState = {
              title: "Authentication Failed",
              message: "API Token rejected (401/403). Auto-Scan stopped.",
              tip: "1. Check your API Token.\n2. If using CORS Proxy, it might be stripping headers. Try disabling it or use a browser extension for CORS."
          };
          // STOP SCANNING ON AUTH ERROR
          if (scanInterval > 0) setScanInterval(0);
      } else if (err.message === 'NOT_FOUND') {
          errorState = {
              title: "Panel Not Found",
              message: "API endpoint returned 404 Not Found.",
              tip: "Check your Domain URL. It should just be the domain (e.g. https://panel.example.com) without any paths."
          };
          if (scanInterval > 0) setScanInterval(0);
      } else if (err.message === 'SERVER_ERROR') {
          errorState = {
              title: "Server Error",
              message: "The remote Panel server returned a 500 error.",
              tip: "Check the panel logs on your VPS. The service might be crashing."
          };
      }

      setError(errorState);
      return null;
      
    } finally {
      isFetchingRef.current = false;
      if (showLoadingState) setIsLoading(false);
    }
  };

  // --- EFFECT: Data Scanning Loop ---
  useEffect(() => {
    if (scanInterval > 0) {
      fetchAndAnalyze(true);
      timerRef.current = setInterval(() => {
        fetchAndAnalyze(false);
      }, scanInterval); 
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [scanInterval]); 

  // --- EFFECT: Telegram Bot Polling Loop (Decoupled) ---
  useEffect(() => {
      if (config.telegramBotToken) {
          runTelegramPoll();
      }
      return () => {
          if (telegramLoopTimeoutRef.current) {
              clearTimeout(telegramLoopTimeoutRef.current);
          }
      };
  }, [config.telegramBotToken]);

  const handleActiveNodeCheck = async (nodeName: string) => {
    if (checkingNode || isLoading) return; 
    setCheckingNode(nodeName);
    const newResult = await fetchAndAnalyze(true); 
    setCheckingNode(null);

    if (newResult) {
        const updatedNode = newResult.nodes.find(n => n.name === nodeName);
        let feedbackStatus: 'idle' | 'active' = 'active';

        if (updatedNode) {
            if (updatedNode.onlineUsers === 0 || (updatedNode.onlineUsers < 3 && updatedNode.currentSpeedKbps < 20)) {
                feedbackStatus = 'idle';
            }
        }
        setNodeFeedback(prev => ({...prev, [nodeName]: feedbackStatus}));
        setTimeout(() => {
             setNodeFeedback(prev => {
                 const newState = {...prev};
                 delete newState[nodeName];
                 return newState;
             });
        }, 3000);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
      
      {/* Chart Modal */}
      {selectedNodeForChart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-2xl p-6 relative shadow-2xl">
                <button 
                    onClick={() => setSelectedNodeForChart(null)}
                    className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors"
                >
                    <X className="w-6 h-6" />
                </button>
                
                <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-purple-500" />
                    {selectedNodeForChart}
                </h3>
                <p className="text-xs text-zinc-500 mb-6 font-mono tracking-wider">REAL-TIME TRAFFIC MONITOR</p>
                
                <div className="bg-black/20 rounded-lg p-2 border border-zinc-800/50">
                    <SpeedChart data={nodeHistory[selectedNodeForChart] || []} />
                </div>

                {scanInterval === 0 && (
                    <div className="mt-4 flex items-center gap-2 text-xs text-yellow-500 bg-yellow-900/10 p-3 rounded border border-yellow-500/20">
                        <Info className="w-4 h-4" />
                        <span><strong>Note:</strong> Enable "Auto-Scan" in settings above to see live updates on this chart.</span>
                    </div>
                )}
            </div>
        </div>
      )}

      {/* Configuration Card */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
        <h2 className="text-lg font-bold text-zinc-200 mb-4 flex items-center gap-2">
          <Server className="w-5 h-5 text-purple-500" />
          Remnawave / Panel Config
        </h2>
        
        <div className="grid gap-4">
          <div>
            <label className="block text-xs font-mono text-zinc-500 uppercase mb-1">Panel Domain URL</label>
            <div className="relative">
                <Globe className="absolute left-3 top-3 w-4 h-4 text-zinc-600" />
                <input 
                type="text" 
                placeholder="e.g., https://rempanel.yamoe.xyz"
                value={config.apiUrl}
                onChange={(e) => setConfig({...config, apiUrl: e.target.value})}
                className="w-full bg-black border border-zinc-700 rounded p-3 pl-10 text-zinc-200 text-sm focus:border-purple-500 outline-none transition-colors"
                />
            </div>
            {/* CORS Toggle */}
            <div className="flex items-center gap-2 mt-2">
                 <div className="relative inline-block w-8 h-4 align-middle select-none transition duration-200 ease-in">
                    <input 
                        type="checkbox" 
                        name="cors-toggle" 
                        id="cors-toggle" 
                        checked={config.useCorsProxy || false}
                        onChange={(e) => setConfig({...config, useCorsProxy: e.target.checked})}
                        className="toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-4 appearance-none cursor-pointer checked:right-0 checked:bg-purple-500"
                    />
                    <label htmlFor="cors-toggle" className="toggle-label block overflow-hidden h-4 rounded-full bg-zinc-700 cursor-pointer"></label>
                 </div>
                 <label htmlFor="cors-toggle" className="text-xs text-zinc-400 cursor-pointer select-none flex items-center gap-1">
                     <Globe2 className="w-3 h-3 text-blue-400" />
                     Enable CORS Proxy <span className="text-zinc-600">(Fixes Fetch Errors)</span>
                 </label>
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-mono text-zinc-500 uppercase mb-1">Admin API Token</label>
            <div className={`relative ${error?.title === 'Authentication Failed' ? 'animate-pulse' : ''}`}>
              <Key className={`absolute left-3 top-3 w-4 h-4 ${error?.title === 'Authentication Failed' ? 'text-red-500' : 'text-zinc-600'}`} />
              <input 
                type="password" 
                placeholder="Bearer Token"
                value={config.apiToken}
                onChange={(e) => setConfig({...config, apiToken: e.target.value})}
                className={`w-full bg-black border rounded p-3 pl-10 text-zinc-200 text-sm outline-none transition-colors ${
                    error?.title === 'Authentication Failed' ? 'border-red-500 focus:border-red-500' : 'border-zinc-700 focus:border-purple-500'
                }`}
              />
            </div>
          </div>
          
          {/* Advanced Settings */}
          <div>
             <button 
               onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
               className="flex items-center gap-2 text-xs font-bold text-zinc-500 hover:text-white transition-colors mb-2"
             >
               <Settings2 className="w-3 h-3" />
               ADVANCED SETTINGS
             </button>
             
             {showAdvancedSettings && (
                 <div className="grid gap-4 bg-black/20 p-4 rounded border border-white/5 animate-in fade-in slide-in-from-top-1">
                     <div>
                        <label className="block text-xs font-mono text-zinc-500 uppercase mb-1">Custom CORS Proxy URL</label>
                        <input 
                            type="text" 
                            placeholder="Default: https://corsproxy.io/?"
                            value={config.customProxyUrl || ''}
                            onChange={(e) => setConfig({...config, customProxyUrl: e.target.value})}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-300 text-xs focus:border-blue-500 outline-none"
                        />
                        <p className="text-[10px] text-zinc-600 mt-1">Must end with query/param. Example: <code>https://api.allorigins.win/raw?url=</code></p>
                     </div>
                     
                     <div>
                        <label className="block text-xs font-mono text-zinc-500 uppercase mb-1 flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-yellow-500" />
                            Gemini API Key (Optional)
                        </label>
                        <input 
                            type="password" 
                            placeholder="Enter Google Gemini API Key"
                            value={config.geminiApiKey || ''}
                            onChange={(e) => setConfig({...config, geminiApiKey: e.target.value})}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-300 text-xs focus:border-yellow-500 outline-none"
                        />
                     </div>
                 </div>
             )}
          </div>

          <div className="pt-2 border-t border-zinc-800">
            <button 
              onClick={() => setShowTelegramSettings(!showTelegramSettings)}
              className="flex items-center gap-2 text-xs font-bold text-zinc-400 hover:text-white transition-colors"
            >
              <Bell className="w-3 h-3" />
              {showTelegramSettings ? 'HIDE NOTIFICATION SETTINGS' : 'SETUP TELEGRAM NOTIFICATIONS'}
            </button>

            {showTelegramSettings && (
              <div className="mt-4 grid gap-3 animate-in fade-in slide-in-from-top-2">
                 <div>
                    <label className="block text-xs font-mono text-zinc-500 uppercase mb-1">Telegram Bot Token</label>
                    <input 
                      type="text" 
                      placeholder="e.g. 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                      value={config.telegramBotToken || ''}
                      onChange={(e) => setConfig({...config, telegramBotToken: e.target.value})}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-300 text-xs focus:border-blue-500 outline-none"
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-mono text-zinc-500 uppercase mb-1">Chat ID</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                          <input 
                            type="text" 
                            placeholder="e.g. 123456789"
                            value={config.telegramChatId || ''}
                            onChange={(e) => setConfig({...config, telegramChatId: e.target.value})}
                            className={`w-full bg-zinc-950 border rounded p-2 text-zinc-300 text-xs focus:border-blue-500 outline-none ${
                                isDetectingChatId ? 'border-blue-500 animate-pulse' : 'border-zinc-800'
                            }`}
                          />
                          {isDetectingChatId && (
                              <span className="absolute right-2 top-2 text-[10px] text-blue-400 bg-blue-900/30 px-2 rounded animate-pulse">
                                  Listening...
                              </span>
                          )}
                      </div>
                      
                      <button 
                        onClick={() => {
                            setIsDetectingChatId(!isDetectingChatId);
                            setBotError(null);
                        }}
                        disabled={!config.telegramBotToken || botStatus !== 'connected'}
                        className={`px-3 rounded text-xs font-bold disabled:opacity-50 flex items-center gap-2 border transition-all ${
                            isDetectingChatId 
                            ? 'bg-red-900/30 text-red-400 border-red-500/50 hover:bg-red-900/50' 
                            : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white'
                        }`}
                        title="Auto-Detect Chat ID from next message"
                      >
                         {isDetectingChatId ? <X className="w-3 h-3" /> : <Radio className="w-3 h-3" />}
                         {isDetectingChatId ? 'CANCEL' : 'AUTO-DETECT'}
                      </button>

                      <button 
                        onClick={handleTestNotification}
                        disabled={!config.telegramBotToken || !config.telegramChatId || isSendingTest}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-3 rounded text-xs font-bold disabled:opacity-50 flex items-center gap-2"
                        title="Send Test Message"
                      >
                         {isSendingTest ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                         TEST
                      </button>
                    </div>
                    
                    <div className={`mt-3 flex items-start gap-2 text-[10px] p-2 rounded transition-colors ${
                        botError ? 'bg-red-900/20 border border-red-500/30' : 'bg-zinc-800/30'
                    }`}>
                        <Bot className={`w-4 h-4 shrink-0 mt-0.5 ${botError ? 'text-red-400' : 'text-purple-400'}`} />
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <strong className="text-zinc-400">Bot Status:</strong> 
                                {botStatus === 'checking' && <span className="text-yellow-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin"/> Connecting...</span>}
                                {botStatus === 'connected' && <span className="text-emerald-500 flex items-center gap-1"><Check className="w-3 h-3"/> Online: @{botName || 'Bot'}</span>}
                                {botStatus === 'failed' && <span className="text-red-500 flex items-center gap-1"><XCircle className="w-3 h-3"/> Connection Failed</span>}
                                {botStatus === 'forbidden' && <span className="text-red-500 flex items-center gap-1"><ShieldAlert className="w-3 h-3"/> Forbidden (403)</span>}
                                {botStatus === 'unknown' && <span className="text-zinc-600">Waiting...</span>}
                                
                                <button 
                                    onClick={verifyBotConnection}
                                    className="ml-auto bg-zinc-700 hover:bg-zinc-600 px-2 py-0.5 rounded text-[9px] text-white"
                                >
                                    RECONNECT
                                </button>
                            </div>
                            
                            {botError && (
                                <div className="mt-1 text-red-400 font-mono break-all">
                                    Error: {botError}
                                </div>
                            )}
                        </div>
                    </div>
                 </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
            <div>
                 <label className="block text-xs font-mono text-zinc-500 uppercase mb-1">Monitoring Mode</label>
                 <select 
                    value={scanInterval}
                    onChange={(e) => setScanInterval(Number(e.target.value))}
                    className="w-full bg-zinc-800 border border-zinc-700 text-white rounded p-3 text-sm focus:border-purple-500 outline-none"
                 >
                    <option value={0}>Manual Mode (On Demand)</option>
                    <option value={1000}>⚡ Realtime (1s)</option>
                    <option value={5000}>Eco Mode (5s)</option>
                 </select>
            </div>
            
            <div className="flex items-end">
                <button 
                onClick={() => fetchAndAnalyze(true)}
                disabled={isLoading}
                className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {scanInterval > 0 ? 'SCAN NOW' : 'FETCH STATUS'}
                </button>
            </div>
          </div>
          
          {scanInterval > 0 && (
             <div className="flex items-center justify-center gap-2 text-xs text-purple-400 animate-pulse mt-2">
                <Timer className="w-3 h-3" /> 
                {scanInterval === 1000 ? 'Realtime Monitoring Active' : 'Eco Monitoring Active'}
             </div>
          )}
        </div>

        {error && (
            <div className="mt-4 p-4 bg-red-900/10 border border-red-500/30 rounded-lg animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center gap-2 text-red-400 font-bold mb-2">
                    <AlertTriangle className="w-5 h-5" />
                    <span>{error.title}</span>
                </div>
                <p className="text-sm text-zinc-300 mb-3 font-medium">
                    {error.message}
                </p>
                {error.tip && (
                    <div className="text-xs bg-black/40 p-3 rounded text-zinc-500 font-mono border border-red-500/10">
                        <strong className="text-zinc-400 block mb-1 flex items-center gap-1">
                            <Info className="w-3 h-3" /> TROUBLESHOOTING:
                        </strong>
                        <div className="whitespace-pre-line">{error.tip}</div>
                    </div>
                )}
            </div>
        )}
      </div>

      {/* Client Probe Section (unchanged logic, just layout) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
        <div className="flex justify-between items-start mb-4">
            <h3 className="font-bold text-zinc-200 flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-500" />
                Client-Side Connection Probe
            </h3>
            <span className="text-[10px] font-mono text-zinc-500 border border-zinc-700 px-2 py-0.5 rounded">
                Test YOUR current connection
            </span>
        </div>
        
        <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
                 <div className="flex gap-2">
                    <button 
                        onClick={() => !isProbing && setProbeMode('STANDARD')}
                        className={`flex-1 py-2 rounded text-xs font-bold border transition-colors ${
                            probeMode === 'STANDARD' 
                            ? 'bg-emerald-900/30 text-emerald-400 border-emerald-500/50' 
                            : 'bg-zinc-950 text-zinc-500 border-zinc-800 hover:border-zinc-700'
                        }`}
                    >
                        STANDARD
                    </button>
                    <button 
                        onClick={() => !isProbing && setProbeMode('TURBO')}
                        className={`flex-1 py-2 rounded text-xs font-bold border transition-colors ${
                            probeMode === 'TURBO' 
                            ? 'bg-blue-900/30 text-blue-400 border-blue-500/50' 
                            : 'bg-zinc-950 text-zinc-500 border-zinc-800 hover:border-zinc-700'
                        }`}
                    >
                        TURBO
                    </button>
                    <button 
                        onClick={() => !isProbing && setProbeMode('STABILITY')}
                        className={`flex-1 py-2 rounded text-xs font-bold border transition-colors ${
                            probeMode === 'STABILITY' 
                            ? 'bg-orange-900/30 text-orange-400 border-orange-500/50' 
                            : 'bg-zinc-950 text-zinc-500 border-zinc-800 hover:border-zinc-700'
                        }`}
                    >
                        STABILITY
                    </button>
                 </div>
                 
                 <button 
                    onClick={runProbe}
                    disabled={isProbing}
                    className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                 >
                    {isProbing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    START PROBE
                 </button>
            </div>
            
            <div className="bg-black/40 rounded border border-white/5 p-4 flex flex-col justify-center items-center">
                {!probeResult && !isProbing && (
                    <div className="text-zinc-600 text-xs text-center">
                        Select a mode and click Start to test your local connection bandwidth.
                    </div>
                )}
                
                {isProbing && (
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                        <Gauge className="w-8 h-8 animate-pulse text-zinc-600" />
                        <span className="text-xs font-mono animate-pulse">MEASURING...</span>
                    </div>
                )}

                {probeResult && !isProbing && (
                    <div className="w-full space-y-3 animate-in fade-in zoom-in-95">
                        <div className="flex justify-between items-center border-b border-white/5 pb-2">
                             <span className="text-xs text-zinc-500 uppercase">Download Speed</span>
                             <span className={`text-xl font-mono ${probeResult.downloadSpeedKbps < 100 ? 'text-red-500' : 'text-emerald-400'}`}>
                                {formatSpeed(probeResult.downloadSpeedKbps)}
                             </span>
                        </div>
                        <div className="flex justify-between items-center">
                             <span className="text-xs text-zinc-500 uppercase">Latency / Jitter</span>
                             <div className="text-right">
                                <div className="text-sm text-zinc-300 font-mono">{probeResult.latencyMs} ms</div>
                                {probeResult.jitterMs !== undefined && (
                                    <div className={`text-[10px] font-mono ${probeResult.jitterMs > 100 ? 'text-orange-500' : 'text-zinc-500'}`}>
                                        ±{probeResult.jitterMs} ms
                                    </div>
                                )}
                             </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
      </div>

      {/* Analysis Results */}
      {result && (
        <div className="space-y-6">
            
          {/* New: Overall Status Indicator */}
          {(() => {
              const criticalCount = result.nodes.filter(n => n.status === 'critical').length;
              const warningCount = result.nodes.filter(n => n.status === 'warning').length;
              
              let status: 'CRITICAL' | 'WARNING' | 'NOMINAL' = 'NOMINAL';
              if (criticalCount > 0) status = 'CRITICAL';
              else if (warningCount > 0) status = 'WARNING';
              
              return (
                  <div className={`rounded-xl p-8 border-2 flex flex-col items-center justify-center gap-3 text-center transition-all animate-in fade-in zoom-in-95 ${
                      status === 'CRITICAL' ? 'bg-red-950/20 border-red-500/50 text-red-500' :
                      status === 'WARNING' ? 'bg-orange-950/20 border-orange-500/50 text-orange-500' :
                      'bg-emerald-950/20 border-emerald-500/50 text-emerald-500'
                  }`}>
                      {status === 'CRITICAL' ? <ShieldAlert className="w-16 h-16 animate-pulse" /> :
                       status === 'WARNING' ? <AlertTriangle className="w-16 h-16" /> :
                       <ShieldCheck className="w-16 h-16" />}
                       
                      <div>
                          <h2 className="text-3xl font-bold tracking-tight">
                              {status === 'CRITICAL' ? 'CRITICAL SYSTEM FAILURE' :
                               status === 'WARNING' ? 'MINOR ISSUES DETECTED' :
                               'ALL SYSTEMS NOMINAL'}
                          </h2>
                          <p className={`mt-2 font-mono text-sm uppercase tracking-wide opacity-80 ${
                             status === 'CRITICAL' ? 'text-red-400' :
                             status === 'WARNING' ? 'text-orange-400' :
                             'text-emerald-400' 
                          }`}>
                               {status === 'CRITICAL' ? `${criticalCount} Node(s) Unresponsive or Throttled by GFW` :
                                status === 'WARNING' ? `${warningCount} Node(s) Showing Performance Degradation` :
                                'Network Traffic Flowing Normally'}
                          </p>
                      </div>
                  </div>
              );
          })()}
          
          {/* Global Summary */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
             <div className="flex justify-between items-start mb-2">
                 <h3 className="font-bold text-zinc-200 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-purple-400" />
                    System Diagnosis
                 </h3>
                 <span className="text-[10px] font-mono text-zinc-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Updated: {new Date(lastUpdateTime).toLocaleTimeString()}
                 </span>
             </div>
             <p className="text-sm text-zinc-400 leading-relaxed font-sans">{result.globalAnalysis}</p>
             {result.recommendation && (
                <div className="mt-2 text-xs font-mono text-emerald-400 bg-emerald-900/10 border border-emerald-900/30 p-2 rounded">
                ADVICE: {result.recommendation}
                </div>
             )}
          </div>

          {/* Nodes Grid */}
          <div className="grid gap-4 md:grid-cols-2">
            {result.nodes.map((node, idx) => {
              const isUpdatedRecently = checkingNode === node.name || nodeFeedback[node.name];
              const feedback = nodeFeedback[node.name];
              const kbpsPerUser = node.onlineUsers > 0 ? Math.round(node.currentSpeedKbps / node.onlineUsers) : 0;
              const hasAvg = node.averageSpeedKbps !== undefined && node.averageSpeedKbps > 0;

              return (
              <div 
                key={idx} 
                className={`p-4 rounded-lg border flex flex-col justify-between gap-4 transition-all duration-300 ${
                  isUpdatedRecently ? 'scale-[1.02] shadow-[0_0_15px_rgba(168,85,247,0.15)]' : ''
                } ${
                  node.status === 'critical' 
                    ? 'bg-red-950/10 border-red-500/40' 
                    : node.status === 'warning'
                    ? 'bg-yellow-900/10 border-yellow-600/30'
                    : 'bg-zinc-900/50 border-zinc-800'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                        <h4 className="font-bold text-zinc-200">{node.name || 'Unknown Node'}</h4>
                        <div className={`w-2 h-2 rounded-full animate-pulse ${node.isConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                    </div>
                    <span className="text-xs text-zinc-500 font-mono uppercase">{node.protocol}</span>
                  </div>
                  <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setSelectedNodeForChart(node.name)}
                        className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-purple-400 transition-colors"
                        title="View Live Chart"
                      >
                         <BarChart3 className="w-4 h-4" />
                      </button>
                      
                      {node.status === 'critical' ? (
                        <AlertTriangle className="w-5 h-5 text-red-500 animate-pulse" />
                      ) : node.status === 'warning' ? (
                        <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                      ) : (
                        <CheckCircle className="w-5 h-5 text-emerald-600" />
                      )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="bg-black/30 p-2 rounded col-span-1">
                    <div className="text-zinc-500 text-[10px] uppercase">Active Users</div>
                    <div className="font-mono text-white flex items-center gap-1">
                      <Users className="w-3 h-3" /> {node.onlineUsers}
                    </div>
                  </div>
                  <div className="bg-black/30 p-2 rounded col-span-2">
                    <div className="flex justify-between items-center">
                        <span className="text-zinc-500 text-[10px] uppercase">Realtime</span>
                        <span className="text-zinc-500 text-[10px] uppercase">1H Avg</span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                        <span className={`font-mono ${node.currentSpeedKbps < 100 && node.onlineUsers > 2 ? 'text-red-400' : 'text-emerald-400'}`}>
                          {formatSpeed(node.currentSpeedKbps)}
                        </span>
                        <span className="font-mono text-zinc-400 text-xs flex items-center gap-1 border-l border-zinc-700 pl-2">
                          <Activity className="w-3 h-3 text-blue-400" /> 
                          {hasAvg ? formatSpeed(node.averageSpeedKbps!) : 'Wait...'}
                        </span>
                    </div>
                  </div>
                </div>

                {node.message && (
                  <div className={`text-xs px-2 py-1 rounded ${
                    node.status === 'critical' 
                        ? 'text-red-400 bg-red-900/20' 
                        : node.status === 'warning'
                            ? 'text-yellow-500 bg-yellow-900/20'
                            : 'text-zinc-500 bg-zinc-800/50'
                  }`}>
                    {node.message}
                  </div>
                )}
                
                <div className="pt-2 mt-2 border-t border-white/5 flex gap-2">
                    <button 
                        onClick={() => handleActiveNodeCheck(node.name)}
                        disabled={checkingNode === node.name || isLoading || !!feedback}
                        className={`flex-1 text-xs py-2 rounded font-bold flex items-center justify-center gap-1 transition-all duration-300 ${
                            feedback === 'active' 
                                ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' 
                            : feedback === 'idle'
                                ? 'bg-yellow-600/20 text-yellow-400 border border-yellow-500/30'
                            : checkingNode === node.name
                                ? 'bg-purple-600 text-white opacity-90'
                                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                        }`}
                    >
                        {checkingNode === node.name ? (
                            <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                PROBING...
                            </>
                        ) : feedback === 'active' ? (
                            <>
                                <Check className="w-3 h-3" />
                                TRAFFIC DETECTED
                            </>
                        ) : feedback === 'idle' ? (
                            <>
                                <XCircle className="w-3 h-3" />
                                CONFIRMED IDLE
                            </>
                        ) : (
                            <>
                                <Activity className="w-3 h-3" />
                                CHECK HEALTH
                            </>
                        )}
                    </button>
                </div>
              </div>
            )})}
          </div>
        </div>
      )}
    </div>
  );
};

export default MonitorView;
