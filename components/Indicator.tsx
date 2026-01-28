import React from 'react';
import { ConnectionStatus } from '../types';
import { ShieldAlert, ShieldCheck, Activity, WifiOff } from 'lucide-react';

interface IndicatorProps {
  status: ConnectionStatus;
  currentSpeed: number;
}

const Indicator: React.FC<IndicatorProps> = ({ status, currentSpeed }) => {
  
  const getStatusColor = () => {
    switch (status) {
      case ConnectionStatus.THROTTLED: return 'bg-red-500/10 text-red-500 border-red-500/50';
      case ConnectionStatus.GOOD: return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/50';
      case ConnectionStatus.TESTING: return 'bg-blue-500/10 text-blue-500 border-blue-500/50';
      case ConnectionStatus.OFFLINE: return 'bg-zinc-500/10 text-zinc-500 border-zinc-500/50';
      default: return 'bg-zinc-800/50 text-zinc-400 border-zinc-700';
    }
  };

  const getIcon = () => {
    switch (status) {
      case ConnectionStatus.THROTTLED: return <ShieldAlert className="w-12 h-12 mb-2 animate-pulse" />;
      case ConnectionStatus.GOOD: return <ShieldCheck className="w-12 h-12 mb-2" />;
      case ConnectionStatus.TESTING: return <Activity className="w-12 h-12 mb-2 animate-spin" />;
      case ConnectionStatus.OFFLINE: return <WifiOff className="w-12 h-12 mb-2" />;
      default: return <Activity className="w-12 h-12 mb-2" />;
    }
  };

  const getText = () => {
     switch (status) {
      case ConnectionStatus.THROTTLED: return 'THROTTLING DETECTED';
      case ConnectionStatus.GOOD: return 'CONNECTION HEALTHY';
      case ConnectionStatus.TESTING: return 'ANALYZING TRAFFIC...';
      case ConnectionStatus.OFFLINE: return 'OFFLINE / BLOCKED';
      default: return 'READY TO SCAN';
    }
  }

  return (
    <div className={`flex flex-col items-center justify-center p-8 rounded-xl border-2 transition-all duration-300 ${getStatusColor()}`}>
      {getIcon()}
      <h2 className="text-2xl font-bold tracking-widest font-mono">{getText()}</h2>
      <p className="mt-2 text-sm opacity-80 font-mono">
        {status === ConnectionStatus.THROTTLED 
          ? 'Speed dropped below 100kbps threshold' 
          : status === ConnectionStatus.GOOD 
            ? 'Bandwidth normal'
            : 'Waiting for data stream'}
      </p>
    </div>
  );
};

export default Indicator;
