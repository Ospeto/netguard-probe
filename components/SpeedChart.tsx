import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { SpeedData } from '../types';

interface SpeedChartProps {
  data: SpeedData[];
}

const SpeedChart: React.FC<SpeedChartProps> = ({ data }) => {
  const chartData = data.map(d => ({
    ...d,
    timeStr: new Date(d.timestamp).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })
  }));

  return (
    <div className="w-full h-64 bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
      <h3 className="text-zinc-400 text-sm mb-4 font-mono uppercase tracking-wider">Bandwidth History (Kbps)</h3>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis 
            dataKey="timeStr" 
            stroke="#71717a" 
            fontSize={12}
            tick={{fill: '#71717a'}}
          />
          <YAxis 
            stroke="#71717a" 
            fontSize={12}
            tick={{fill: '#71717a'}}
          />
          <Tooltip 
            contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', color: '#fff' }}
            itemStyle={{ color: '#22c55e' }}
          />
          {/* Critical Threshold Line at 100kbps */}
          <ReferenceLine y={100} label="GFW Limit (100kbps)" stroke="#ef4444" strokeDasharray="3 3" />
          
          <Line 
            type="monotone" 
            dataKey="downloadSpeedKbps" 
            stroke="#22c55e" 
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#fff' }}
            animationDuration={300}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default SpeedChart;
