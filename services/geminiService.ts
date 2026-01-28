import { GoogleGenAI } from "@google/genai";
import { SpeedData, AIAnalysisResult, PanelAnalysisResult, NodeStatus } from "../types";

const getAIClient = (apiKey: string) => {
  return new GoogleGenAI({ apiKey });
};

// --- Helper: Local Fallback Analysis (Smart Formula V2) ---
const performLocalAnalysis = (simplifiedData: any[]): PanelAnalysisResult => {
  
  // Heuristic Constants V2 (Adjusted for Real Kbps)
  const IDLE_SPEED_CEILING = 100; // Kbps. (Previously 50, raised as units are now proper bits)
  const GHOST_USER_THRESHOLD = 5; 
  const CRITICAL_SPEED_PER_USER = 10; // Kbps. Anything below 10Kbps per active user is suspicious.
  
  const analyzedNodes: NodeStatus[] = simplifiedData.map(node => {
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    let message = 'Active';

    const speedKbps = node.speedKbps || 0;
    const users = node.users || 0;
    
    // Calculate Bandwidth per User
    const kbpsPerUser = users > 0 ? speedKbps / users : 0;

    // --- SMART FORMULA V2 LOGIC (GFW Aware) ---

    // 1. OFFLINE CHECK
    if (!node.isConnected) {
        status = 'critical';
        message = '🔴 Server Offline / Unreachable';
    }
    // 2. CLEAN IDLE
    else if (users === 0) {
        status = 'healthy';
        message = 'အသုံးပြုသူ မရှိပါ (Idle)';
    } 
    // 3. LOW TRAFFIC / IDLE USERS (The common "false positive" case)
    // If total speed is low, users are likely just idling.
    else if (speedKbps < IDLE_SPEED_CEILING) {
        if (users > GHOST_USER_THRESHOLD) {
             // 5+ users and still low speed? That's suspicious (Ghost connections).
             status = 'warning';
             message = `Low Data Flow (${users} users)`;
        } else {
             // < 5 users, low speed -> Just Idle.
             status = 'healthy'; 
             message = 'Passive / Idle Traffic';
        }
    } 
    // 4. SUSPECTED MASSIVE THROTTLING (Active GFW Speed Limit)
    // GFW often limits Xray connections to ~40-100kbps regardless of user count.
    else if (users >= 3 && kbpsPerUser < 20) {
        // Updated rule: even just 3 users with < 20kbps each is extremely suspicious.
        status = 'critical';
        message = `🚨 GFW Speed Limit Detected (<20Kbps/user)`;
    } 
    // 5. CONGESTION / HEAVY LOAD
    else if (users >= 10 && kbpsPerUser < 50) {
        status = 'warning';
        message = 'High Load (Congestion Risk)';
    }
    // 6. HEALTHY ACTIVE
    else {
        status = 'healthy';
        message = `Active (${Math.round(kbpsPerUser)} Kbps/user)`;
    }

    return {
      name: node.name,
      protocol: 'VLESS/Shadowsocks',
      onlineUsers: users,
      currentSpeedKbps: speedKbps,
      status: status,
      message: message,
      isConnected: node.isConnected,
      averageSpeedKbps: 0 // Default, will be enriched by MonitorView
    };
  });

  const criticalCount = analyzedNodes.filter(n => n.status === 'critical').length;
  const warningCount = analyzedNodes.filter(n => n.status === 'warning').length;
  
  // Dynamic Global Analysis Message
  let globalMsg = "စနစ် ပုံမှန်အလုပ်လုပ်နေပါသည်။ (Monitoring Active)";
  let recommendation = "ပုံမှန်အတိုင်း အသုံးပြုနိုင်ပါသည်။";

  if (criticalCount > 0) {
      globalMsg = `သတိပေးချက်: Node ${criticalCount} ခုတွင် အမှန်တကယ် Block ခံထားရနိုင်သည် (သို့) Speed Limit ထိထားသည်။`;
      recommendation = "Offline ဖြစ်နေသော Node များကို စစ်ဆေးပါ (သို့) Port အသစ်လဲပါ။";
  } else if (warningCount > 0) {
      globalMsg = "Node အချို့တွင် Traffic နည်းပါးနေသည် (Idle Mode)။";
      recommendation = "အသုံးပြုသူများ Data မဖွင့်ထားခြင်း ဖြစ်နိုင်ပါသည်။";
  }

  return {
    nodes: analyzedNodes,
    globalAnalysis: globalMsg,
    recommendation: recommendation
  };
};

const analyzeNetworkPattern = async (
  history: SpeedData[],
  currentStatus: string,
  apiKey?: string
): Promise<AIAnalysisResult> => {
  if (!apiKey) {
    return {
      status: 'warning',
      message: 'AI API Key not configured. Please add your Gemini API Key in settings to enable AI diagnosis.',
      recommendation: 'Use "Manual Analysis" or configure API Key.',
    };
  }

  try {
    const ai = getAIClient(apiKey);
    
    // Format history for the prompt
    const recentData = history.slice(-10).map(h => 
      `Time: ${new Date(h.timestamp).toLocaleTimeString()}, Speed: ${h.downloadSpeedKbps} kbps, Latency: ${h.latencyMs}ms`
    ).join('\n');

    const prompt = `
      You are a Network Security Expert specializing in GFW (Great Firewall) censorship patterns, specifically focused on Xray/Shadowsocks protocol blocking.
      
      Context:
      The user suspects their Xray/VLESS proxy server is being throttled by the GFW (Active Probing or Speed Limiting).
      Currently, GFW is known to limit speeds of suspicious connections to ~100kbps or ~40kbps.
      
      Current Connection Status: ${currentStatus}
      
      Recent Speed Test Data (Last 10 points):
      ${recentData}
      
      Task:
      Analyze this data for signs of "Active Probing", "Pattern Recognition", or "Speed Limiting" by the firewall.
      
      Return a JSON response strictly following this schema (do not use markdown code blocks):
      {
        "status": "safe" | "warning" | "critical",
        "message": "A short analysis in Burmese (Myanmar Language). Explain if this looks like a ban or exposure risk.",
        "recommendation": "Technical advice in Burmese (e.g., Change port, Rotate IP, use CDN)."
      }
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    
    return JSON.parse(text) as AIAnalysisResult;

  } catch (error) {
    console.error("AI Analysis failed", error);
    return {
      status: 'warning',
      message: 'AI Analysis unavailable. Check your API Key or quota.',
      recommendation: 'Check your internet connection.',
    };
  }
};

const analyzePanelData = async (payload: any, apiKey?: string): Promise<PanelAnalysisResult> => {
  
  // 1. Pre-process Data
  const nodes = payload.nodes || [];
  const stats = payload.realtime_stats || [];
  
  const simplifiedData = nodes.map((node: any) => {
    // Find matching stats
    const stat = stats.find((s: any) => s.nodeUuid === node.uuid);
    
    // FIX: Standard Panel APIs return bandwidth in BYTES per second.
    // We must convert to BITS per second to get accurate Kbps/Mbps.
    // 1 Byte = 8 Bits.
    const totalSpeedBytes = stat ? (stat.totalSpeedBps || (stat.incoming + stat.outgoing)) : 0;
    const speedKbps = Math.round((totalSpeedBytes * 8) / 1000);
    
    return {
      name: node.name,
      users: node.usersOnline || node.online_users || 0,
      speedKbps: speedKbps,
      isConnected: node.isConnected || node.connected
    };
  });

  // SKIP AI if key is missing or not requested
  if (!apiKey) {
    return performLocalAnalysis(simplifiedData);
  }

  try {
    const ai = getAIClient(apiKey);

    const prompt = `
      You are a specialized GFW (Great Firewall) Evasion & Network Security Analyst.
      
      Input Data (Real-time Proxy Node Stats in Kbps):
      ${JSON.stringify(simplifiedData, null, 2)}
      
      CORE OBJECTIVE: 
      Analyze the nodes for 1) Active Throttling (Speed Limiting) and 2) Risk of Server Exposure/IP Ban.
      
      CONTEXT:
      GFW is actively banning Xray/VLESS servers by limiting bandwidth to < 100kbps per connection.
      
      CRITICAL RULE FOR "IDLE" vs "BLOCKED":
      - IF (Users > 0 AND Speed is approx 0): likely IDLE.
      - IF (Users > 3 AND Speed < 100kbps): Likely Throttled (Critical).
      - IF (Speed / Users < 10kbps): Critical Throttling (Speed Limit Active).

      INSTRUCTIONS:
      - Distinguish between "Lazy Users" (Idle) and "Blocked Users" (Throttled).
      - Provide a "globalAnalysis" that assesses the overall health of the fleet in Burmese.
      - Provide a "recommendation" focusing on evasion strategies in Burmese.

      Output strictly JSON (no markdown):
      {
        "nodes": [
          {
            "name": "Node Name",
            "protocol": "Xray",
            "onlineUsers": 0,
            "currentSpeedKbps": 0,
            "status": "healthy" | "warning" | "critical",
            "message": "Specific risk assessment in Burmese (Myanmar Language)"
          }
        ],
        "globalAnalysis": "Overall fleet status and risk level in Burmese.",
        "recommendation": "Actionable evasion steps in Burmese."
      }
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    const result = JSON.parse(text) as PanelAnalysisResult;

    // Merge isConnected from simplifiedData back into the result and ensure averageSpeedKbps field exists
    if (result.nodes) {
      result.nodes = result.nodes.map(n => {
        const original = simplifiedData.find((s: any) => s.name === n.name);
        return {
          ...n,
          isConnected: original ? original.isConnected : true,
          averageSpeedKbps: 0 // Default
        };
      });
    }

    return result;

  } catch (error) {
    console.warn("Gemini API failed, falling back to local analysis", error);
    // FALLBACK: If AI fails (quota or network), use local logic
    return performLocalAnalysis(simplifiedData);
  }
};

export const geminiService = {
  analyzeNetworkPattern,
  analyzePanelData,
};