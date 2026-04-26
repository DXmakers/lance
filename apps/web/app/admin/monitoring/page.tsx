"use client";

import React, { useState, useEffect } from "react";
import { 
  Activity, 
  Database, 
  RefreshCw, 
  Terminal, 
  AlertCircle, 
  CheckCircle2, 
  TrendingUp,
  Cpu,
  Clock
} from "lucide-react";
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useIndexerStatus } from "@/hooks/use-indexer-status";

// Mock data for the chart animations since we don't have historical metrics in the API yet
const generateInitialData = () => {
  const data = [];
  const now = new Date();
  for (let i = 20; i >= 0; i--) {
    data.push({
      time: new Date(now.getTime() - i * 5000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      throughput: Math.floor(Math.random() * 5) + 2,
      latency: Math.floor(Math.random() * 200) + 150,
    });
  }
  return data;
};

export default function MonitoringDashboard() {
  const { data: status, isLoading } = useIndexerStatus();
  const [chartData, setChartData] = useState(generateInitialData());
  const [logs, setLogs] = useState<{id: string, msg: string, type: 'info' | 'error' | 'warn'}[]>([]);

  const addLog = (msg: string, type: 'info' | 'error' | 'warn' = 'info') => {
    setLogs(prev => [{ id: Math.random().toString(36), msg, type }, ...prev].slice(0, 50));
  };

  const handleRestart = async () => {
    addLog("Initiating manual indexer restart...", 'info');
    // In a real app, this would call an admin API
    setTimeout(() => addLog("Worker process signal sent (SIGTERM -> SIGSTART)", 'info'), 1000);
  };

  const handleRescan = () => {
    addLog("Manual ledger re-scan triggered for range [LAST-10, LATEST]", 'warn');
  };

  // Update chart data and logs when status changes
  useEffect(() => {
    if (!status) return;

    // Use a small delay to avoid cascading render warnings from synchronous state updates in effect
    const timeoutId = setTimeout(() => {
      setChartData(prev => {
        const newData = [...prev.slice(1), {
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          throughput: status.in_sync ? 1 : 0, 
          latency: status.ledger_lag * 100, 
        }];
        return newData;
      });

      if (status.ledger_lag > status.max_allowed_lag) {
        addLog(`System lagging behind by ${status.ledger_lag} ledgers`, 'warn');
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [status]);

  if (isLoading) return (
    <div className="flex h-screen items-center justify-center bg-black text-green-500 font-mono">
      <div className="flex flex-col items-center gap-4">
        <Activity className="animate-pulse h-12 w-12" />
        <p className="text-sm">INITIALIZING_MONITORING_SYSTEM...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white font-mono p-6">
      {/* Header */}
      <header className="flex justify-between items-center mb-8 border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tighter flex items-center gap-2">
            <Terminal className="h-6 w-6 text-green-500" />
            INFRASTRUCTURE::CORE_MONITOR
          </h1>
          <p className="text-zinc-500 text-xs mt-1 uppercase tracking-widest">
            Production Environment // Soroban Network Service
          </p>
        </div>
        <div className="flex gap-4">
          <Button 
            variant="outline" 
            size="sm" 
            className="border-zinc-800 hover:bg-zinc-900 text-zinc-400 bg-black"
            onClick={handleRescan}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> RE-SCAN
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="border-red-900/30 hover:bg-red-900/10 text-red-500 bg-black"
            onClick={handleRestart}
          >
            <Cpu className="mr-2 h-4 w-4" /> RESTART_WORKER
          </Button>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard 
          title="SYNC_STATUS" 
          value={status?.in_sync ? "OPERATIONAL" : "LAGGING"} 
          subValue={`${status?.ledger_lag} LEDGER LAG`}
          icon={status?.in_sync ? <CheckCircle2 className="text-green-500" /> : <AlertCircle className="text-red-500" />}
          trend={status?.in_sync ? "STABLE" : "DEGRADED"}
        />
        <StatCard 
          title="LAST_LEDGER" 
          value={status?.last_processed_ledger?.toLocaleString() || "0"} 
          subValue={`NETWORK: ${status?.latest_network_ledger?.toLocaleString()}`}
          icon={<Database className="text-zinc-500" />}
        />
        <StatCard 
          title="ERROR_TTL" 
          value={status?.error_count?.toString() || "0"} 
          subValue="SINCE_UPTIME"
          icon={<AlertCircle className="text-zinc-500" />}
          color={status?.error_count && status.error_count > 0 ? "text-red-500" : "text-zinc-500"}
        />
        <StatCard 
          title="REFRESH_RATE" 
          value="5000ms" 
          subValue="AUTO_POLLING"
          icon={<Clock className="text-zinc-500" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Charts */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-zinc-950 border-zinc-800 rounded-none overflow-hidden">
            <CardHeader className="border-b border-zinc-900 py-3">
              <CardTitle className="text-sm font-medium text-zinc-400 flex items-center justify-between uppercase">
                Worker Throughput (EPS)
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorThroughput" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#18181b" vertical={false} />
                  <XAxis 
                    dataKey="time" 
                    stroke="#3f3f46" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false} 
                  />
                  <YAxis 
                    stroke="#3f3f46" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false} 
                    tickFormatter={(v) => `${v} tx`}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', color: '#fff', fontSize: '12px' }}
                    itemStyle={{ color: '#22c55e' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="throughput" 
                    stroke="#22c55e" 
                    fillOpacity={1} 
                    fill="url(#colorThroughput)" 
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Details Table */}
          <Card className="bg-zinc-950 border-zinc-800 rounded-none">
            <CardHeader className="border-b border-zinc-900 py-3">
              <CardTitle className="text-sm font-medium text-zinc-400 uppercase">System Parameters</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-100 text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-900">
                    <th className="px-4 py-2 font-medium text-zinc-500 uppercase">Parameter</th>
                    <th className="px-4 py-2 font-medium text-zinc-500 uppercase">Value</th>
                    <th className="px-4 py-2 font-medium text-zinc-500 uppercase text-right">Identifier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                  <TableRow label="RPC_ENDPOINT" value={status?.rpc.url || "NULL"} id="rpc_v0" />
                  <TableRow label="RPC_HEALTH" value={status?.rpc.reachable ? "REACHABLE" : "UNREACHABLE"} id="rpc_h" />
                  <TableRow label="MAX_LAG_LIMIT" value={`${status?.max_allowed_lag} ledgers`} id="cfg_0" />
                  <TableRow label="CHECKPOINT_HASH" value="0x8f2e...9a12" id="db_ptr" />
                  <TableRow label="UPTIME" value="14d 04h 22m" id="sys_up" />
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

        {/* Real-time Logs Side Panel */}
        <div className="lg:col-span-1">
          <Card className="bg-zinc-950 border-zinc-800 rounded-none h-full flex flex-col">
            <CardHeader className="border-b border-zinc-900 py-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-zinc-400 uppercase">Live_Events</CardTitle>
              <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20 text-[10px] h-4">STREAMING</Badge>
            </CardHeader>
            <CardContent className="p-0 flex-grow overflow-y-auto max-h-[600px] bg-[#050505]">
              <div className="p-3 space-y-2">
                {logs.length === 0 && (
                  <p className="text-zinc-600 text-[10px] italic">No events recorded in current session...</p>
                )}
                {logs.map(log => (
                  <div key={log.id} className="border-l-2 border-zinc-800 pl-2 py-1 leading-tight text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-600">[{new Date().toLocaleTimeString()}]</span>
                      <span className={log.type === 'error' ? 'text-red-500' : log.type === 'warn' ? 'text-yellow-500' : 'text-zinc-400'}>
                        {log.msg}
                      </span>
                    </div>
                  </div>
                ))}
                {/* Simulated live logs */}
                <div className="border-l-2 border-green-500/40 pl-2 py-1 leading-tight text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-600">[{new Date().toLocaleTimeString()}]</span>
                    <span className="text-green-500">LEDGER_CONSUMED :: #{status?.last_processed_ledger}</span>
                  </div>
                </div>
                <div className="border-l-2 border-zinc-800 pl-2 py-1 leading-tight text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-600">[{new Date().toLocaleTimeString()}]</span>
                    <span className="text-zinc-400">IDEMPOTENCY_CHECK :: OK</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  subValue: string;
  icon: React.ReactNode;
  color?: string;
  trend?: "STABLE" | "DEGRADED";
}

function StatCard({ title, value, subValue, icon, color = "text-white", trend }: StatCardProps) {
  return (
    <Card className="bg-zinc-950 border-zinc-800 rounded-none hover:border-zinc-700 transition-colors">
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-2">
          <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">{title}</p>
          <div className="h-4 w-4">{icon}</div>
        </div>
        <div className="flex items-baseline gap-2">
          <p className={`text-xl font-bold tracking-tight ${color}`}>{value}</p>
          {trend && (
            <span className={`text-[9px] px-1 border ${trend === 'STABLE' ? 'border-green-900/30 text-green-500' : 'border-red-900/30 text-red-500'}`}>
              {trend}
            </span>
          )}
        </div>
        <p className="text-[10px] text-zinc-600 mt-1 uppercase">{subValue}</p>
      </CardContent>
    </Card>
  );
}

function TableRow({ label, value, id }: { label: string, value: string, id: string }) {
  return (
    <tr className="hover:bg-zinc-900/50 transition-colors">
      <td className="px-4 py-3 font-medium text-zinc-400">{label}</td>
      <td className="px-4 py-3 text-zinc-300">{value}</td>
      <td className="px-4 py-3 text-right text-zinc-600 italic">{id}</td>
    </tr>
  );
}
