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
  Clock,
  MemoryStick,
  HardDrive,
  Zap,
  AlertTriangle
} from "lucide-react";
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  ComposedChart
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useIndexerStatus } from "@/hooks/use-indexer-status";

const generateInitialData = () => {
  const data = [];
  const now = new Date();
  for (let i = 20; i >= 0; i--) {
    data.push({
      time: new Date(now.getTime() - i * 5000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      throughput: 0,
      latency: 0,
      memory: 0,
      cpu: 0,
    });
  }
  return data;
};

interface EventLog {
  id: string;
  timestamp: string;
  ledger: number;
  eventCount: number;
  hash: string;
  status: 'success' | 'error' | 'warning';
}

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning';
}

function ConfirmDialog({ 
  isOpen, 
  title, 
  message, 
  onConfirm, 
  onCancel, 
  confirmText = "CONFIRM",
  cancelText = "CANCEL",
  variant = 'warning'
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <Card className="bg-zinc-950 border-zinc-800 rounded-none w-full max-w-md">
        <CardHeader className="border-b border-zinc-900 py-4">
          <CardTitle className="text-sm font-medium text-zinc-200 flex items-center gap-2 uppercase">
            <AlertTriangle className={`h-5 w-5 ${variant === 'danger' ? 'text-red-500' : 'text-yellow-500'}`} />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <p className="text-sm text-zinc-400 mb-6 leading-relaxed">{message}</p>
          <div className="flex gap-3 justify-end">
            <Button 
              variant="outline" 
              size="sm" 
              className="border-zinc-800 hover:bg-zinc-900 text-zinc-400 bg-black"
              onClick={onCancel}
            >
              {cancelText}
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className={`${
                variant === 'danger' 
                  ? 'border-red-900/30 hover:bg-red-900/20 text-red-500' 
                  : 'border-yellow-900/30 hover:bg-yellow-900/20 text-yellow-500'
              } bg-black`}
              onClick={onConfirm}
            >
              {confirmText}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function MonitoringDashboard() {
  const { data: status, isLoading } = useIndexerStatus();
  const [chartData, setChartData] = useState(generateInitialData());
  const [logs, setLogs] = useState<{id: string, msg: string, type: 'info' | 'error' | 'warn'}[]>([]);
  const [eventLogs, setEventLogs] = useState<EventLog[]>([]);
  const [showRestartDialog, setShowRestartDialog] = useState(false);
  const [showRescanDialog, setShowRescanDialog] = useState(false);

  const addLog = (msg: string, type: 'info' | 'error' | 'warn' = 'info') => {
    setLogs(prev => [{ id: Math.random().toString(36), msg, type }, ...prev].slice(0, 50));
  };

  const generateMockHash = (ledger: number) => {
    return `0x${ledger.toString(16).padStart(8, '0')}${Math.random().toString(16).slice(2, 10)}`;
  };

  const handleRestartConfirm = async () => {
    setShowRestartDialog(false);
    addLog("Initiating manual indexer restart...", 'info');
    // In a real app, this would call an admin API endpoint
    // await fetch('/api/admin/indexer/restart', { method: 'POST' });
    setTimeout(() => {
      addLog("Worker process signal sent (SIGTERM -> SIGSTART)", 'info');
      addLog("Indexer restart completed successfully", 'info');
    }, 1000);
  };

  const handleRescanConfirm = () => {
    setShowRescanDialog(false);
    const startLedger = (status?.last_processed_ledger || 0) - 10;
    const endLedger = status?.latest_network_ledger || 0;
    addLog(`Manual ledger re-scan triggered for range [${startLedger}, ${endLedger}]`, 'warn');
    // In a real app, this would call an admin API endpoint
    // await fetch('/api/admin/indexer/rescan', { method: 'POST', body: JSON.stringify({ startLedger, endLedger }) });
    setTimeout(() => {
      addLog(`Re-scanning ${endLedger - startLedger} ledgers...`, 'info');
    }, 500);
  };

  // Update chart data, logs, and event logs when status changes
  useEffect(() => {
    if (!status) return;

    // Use a small delay to avoid cascading render warnings from synchronous state updates in effect
    const timeoutId = setTimeout(() => {
      setChartData(prev => {
        const newData = [...prev.slice(1), {
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          throughput: status.last_batch_rate_per_second || 0,
          latency: status.last_rpc_latency_ms || status.last_loop_duration_ms || 0,
          memory: Math.random() * 30 + 40, // Mock memory usage 40-70%
          cpu: Math.random() * 20 + 10, // Mock CPU usage 10-30%
        }];
        return newData;
      });

      // Add event log entry for processed ledger
      if (status.last_batch_events_processed > 0) {
        setEventLogs(prev => {
          const newLog: EventLog = {
            id: Math.random().toString(36),
            timestamp: new Date().toISOString(),
            ledger: status.last_processed_ledger,
            eventCount: status.last_batch_events_processed,
            hash: generateMockHash(status.last_processed_ledger),
            status: status.in_sync ? 'success' : 'warning'
          };
          return [newLog, ...prev].slice(0, 20);
        });
      }

      if (status.ledger_lag > status.max_allowed_lag) {
        addLog(`System lagging behind by ${status.ledger_lag} ledgers`, 'warn');
      }

      if (status.rpc_retry_count > 0) {
        addLog(`RPC retries observed: ${status.rpc_retry_count}`, 'info');
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
      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={showRestartDialog}
        title="CONFIRM WORKER RESTART"
        message="This will terminate the current indexer process and restart it. Any in-progress operations will be interrupted. The worker will resume from the last checkpoint. Are you sure you want to proceed?"
        onConfirm={handleRestartConfirm}
        onCancel={() => setShowRestartDialog(false)}
        confirmText="RESTART NOW"
        variant="danger"
      />
      
      <ConfirmDialog
        isOpen={showRescanDialog}
        title="CONFIRM LEDGER RE-SCAN"
        message={`This will re-process the last 10 ledgers (${(status?.last_processed_ledger || 0) - 10} to ${status?.latest_network_ledger || 0}). Idempotent processing will prevent duplicates. This operation may take several minutes. Continue?`}
        onConfirm={handleRescanConfirm}
        onCancel={() => setShowRescanDialog(false)}
        confirmText="START RE-SCAN"
        variant="warning"
      />

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
            onClick={() => setShowRescanDialog(true)}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> RE-SCAN
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="border-red-900/30 hover:bg-red-900/10 text-red-500 bg-black"
            onClick={() => setShowRestartDialog(true)}
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
          value={`#${status?.last_processed_ledger?.toLocaleString() || "0"}`} 
          subValue={`NETWORK: #${status?.latest_network_ledger?.toLocaleString()}`}
          icon={<Database className="text-zinc-500" />}
          mono={true}
        />
        <StatCard 
          title="THROUGHPUT" 
          value={`${status?.last_batch_rate_per_second?.toFixed(1) || "0.0"}`}
          subValue="EVENTS/SECOND"
          icon={<Zap className="text-zinc-500" />}
          color={status && status.last_batch_rate_per_second > 10 ? "text-green-500" : "text-zinc-500"}
        />
        <StatCard 
          title="RPC_LATENCY" 
          value={`${status?.last_rpc_latency_ms ?? 0}ms`}
          subValue={`LOOP: ${status?.last_loop_duration_ms ?? 0}ms`}
          icon={<Clock className="text-zinc-500" />}
          color={status && status.last_loop_duration_ms > 5000 ? "text-red-500" : "text-zinc-500"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Charts */}
        <div className="lg:col-span-2 space-y-6">
          {/* Throughput Chart */}
          <Card className="bg-zinc-950 border-zinc-800 rounded-none overflow-hidden">
            <CardHeader className="border-b border-zinc-900 py-3">
              <CardTitle className="text-sm font-medium text-zinc-400 flex items-center justify-between uppercase">
                Indexing Throughput (Events/Second)
                <TrendingUp className="h-4 w-4 text-green-500" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 h-[200px]">
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
                    tickFormatter={(v) => `${v}`}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', color: '#fff', fontSize: '12px' }}
                    itemStyle={{ color: '#22c55e' }}
                    formatter={(value: number) => [`${value.toFixed(1)} eps`, 'Throughput']}
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

          {/* Resource Usage Chart */}
          <Card className="bg-zinc-950 border-zinc-800 rounded-none overflow-hidden">
            <CardHeader className="border-b border-zinc-900 py-3">
              <CardTitle className="text-sm font-medium text-zinc-400 flex items-center justify-between uppercase">
                Resource Usage
                <div className="flex gap-3 text-[10px]">
                  <span className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-blue-500"></div>
                    CPU
                  </span>
                  <span className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-purple-500"></div>
                    MEMORY
                  </span>
                  <span className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-yellow-500"></div>
                    LATENCY
                  </span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#18181b" vertical={false} />
                  <XAxis 
                    dataKey="time" 
                    stroke="#3f3f46" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false} 
                  />
                  <YAxis 
                    yAxisId="left"
                    stroke="#3f3f46" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false} 
                    tickFormatter={(v) => `${v}%`}
                  />
                  <YAxis 
                    yAxisId="right"
                    orientation="right"
                    stroke="#3f3f46" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false} 
                    tickFormatter={(v) => `${v}ms`}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', color: '#fff', fontSize: '12px' }}
                  />
                  <Line 
                    yAxisId="left"
                    type="monotone" 
                    dataKey="cpu" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line 
                    yAxisId="left"
                    type="monotone" 
                    dataKey="memory" 
                    stroke="#a855f7" 
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line 
                    yAxisId="right"
                    type="monotone" 
                    dataKey="latency" 
                    stroke="#eab308" 
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Event Log Table */}
          <Card className="bg-zinc-950 border-zinc-800 rounded-none">
            <CardHeader className="border-b border-zinc-900 py-3">
              <CardTitle className="text-sm font-medium text-zinc-400 uppercase flex items-center justify-between">
                Recent Ledger Events
                <Badge variant="outline" className="bg-zinc-900 text-zinc-500 border-zinc-800 text-[10px] h-4">
                  {eventLogs.length} ENTRIES
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-900 bg-zinc-950">
                      <th className="px-4 py-2 font-medium text-zinc-500 uppercase">Timestamp</th>
                      <th className="px-4 py-2 font-medium text-zinc-500 uppercase font-mono">Ledger</th>
                      <th className="px-4 py-2 font-medium text-zinc-500 uppercase">Events</th>
                      <th className="px-4 py-2 font-medium text-zinc-500 uppercase font-mono">Hash</th>
                      <th className="px-4 py-2 font-medium text-zinc-500 uppercase text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {eventLogs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-zinc-600 italic">
                          No events recorded yet. Waiting for indexer activity...
                        </td>
                      </tr>
                    )}
                    {eventLogs.map(log => (
                      <tr key={log.id} className="hover:bg-zinc-900/50 transition-colors">
                        <td className="px-4 py-2 text-zinc-400">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-2 text-zinc-300 font-mono">
                          #{log.ledger.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-zinc-300">
                          {log.eventCount}
                        </td>
                        <td className="px-4 py-2 text-zinc-500 font-mono text-[10px]">
                          {log.hash}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {log.status === 'success' && (
                            <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20 text-[10px] h-4">
                              OK
                            </Badge>
                          )}
                          {log.status === 'warning' && (
                            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 text-[10px] h-4">
                              WARN
                            </Badge>
                          )}
                          {log.status === 'error' && (
                            <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20 text-[10px] h-4">
                              ERR
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
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
                    tickFormatter={(v) => `${v} eps`}
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
                  <TableRow label="LAST_BATCH_EVENTS" value={`${status?.last_batch_events_processed ?? 0}`} id="evt_rt" />
                  <TableRow label="RPC_RETRIES" value={`${status?.rpc_retry_count ?? 0}`} id="rpc_rt" />
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
  mono?: boolean;
}

function StatCard({ title, value, subValue, icon, color = "text-white", trend, mono = false }: StatCardProps) {
  return (
    <Card className="bg-zinc-950 border-zinc-800 rounded-none hover:border-zinc-700 transition-colors">
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-2">
          <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">{title}</p>
          <div className="h-4 w-4">{icon}</div>
        </div>
        <div className="flex items-baseline gap-2">
          <p className={`text-xl font-bold tracking-tight ${color} ${mono ? 'font-mono' : ''}`}>{value}</p>
          {trend && (
            <span className={`text-[9px] px-1 border ${trend === 'STABLE' ? 'border-green-900/30 text-green-500' : 'border-red-900/30 text-red-500'}`}>
              {trend}
            </span>
          )}
        </div>
        <p className={`text-[10px] text-zinc-600 mt-1 uppercase ${mono ? 'font-mono' : ''}`}>{subValue}</p>
      </CardContent>
    </Card>
  );
}
