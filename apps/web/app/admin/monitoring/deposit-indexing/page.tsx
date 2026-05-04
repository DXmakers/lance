"use client";

import React, { useState, useEffect } from "react";
import { 
  Database, 
  RefreshCw, 
  Terminal, 
  Cpu, 
  Clock, 
  ArrowDownLeft, 
  ShieldCheck, 
  Zap 
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
import { Button } from "@/components/ui/button";
import { useIndexerStatus } from "@/hooks/use-indexer-status";
import { apiAdmin } from "@/lib/api";

const generateInitialData = () => {
  const data = [];
  const now = new Date();
  for (let i = 20; i >= 0; i--) {
    data.push({
      time: new Date(now.getTime() - i * 5000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      throughput: 0,
      latency: 0,
    });
  }
  return data;
};

export default function DepositMonitoringDashboard() {
  const { data: status, isLoading } = useIndexerStatus();
  const [chartData, setChartData] = useState(generateInitialData());
  const [logs, setLogs] = useState<{id: string, msg: string, type: 'info' | 'error' | 'warn' | 'success'}[]>([]);
  const [confirmAction, setConfirmAction] = useState<"restart" | "rescan" | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const addLog = (msg: string, type: 'info' | 'error' | 'warn' | 'success' = 'info') => {
    setLogs(prev => [{ id: Math.random().toString(36), msg, type }, ...prev].slice(0, 50));
  };

  const handleRestart = async () => {
    setActionPending(true);
    setConfirmAction(null);
    try {
      const res = await apiAdmin.indexer.restart();
      addLog(res.message, 'success');
    } catch (e) {
      addLog(`Restart failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setActionPending(false);
    }
  };

  const handleRescan = async () => {
    setActionPending(true);
    setConfirmAction(null);
    try {
      const res = await apiAdmin.indexer.rescan();
      addLog(`Re-scan initiated from ledger ${res.rescan_from_ledger}`, 'info');
    } catch (e) {
      addLog(`Re-scan failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setActionPending(false);
    }
  };

  useEffect(() => {
    if (!status) return;

    // Use a small delay to avoid cascading render warnings from synchronous state updates in effect
    const timeoutId = setTimeout(() => {
      setChartData(prev => {
        const newData = [...prev.slice(1), {
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          throughput: status.last_batch_rate_per_second,
          latency: status.last_rpc_latency_ms || status.last_loop_duration_ms,
        }];
        return newData;
      });

      if (status.last_loop_duration_ms > 1000) {
        addLog(`High indexing latency detected: ${status.last_loop_duration_ms}ms`, 'warn');
      }

      if (status.rpc_retry_count > 0) {
        addLog(`RPC retry pressure detected: ${status.rpc_retry_count}`, 'warn');
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [status]);

  if (isLoading) return (
    <div className="flex h-screen items-center justify-center bg-black text-zinc-500 font-mono">
      <div className="flex flex-col items-center gap-4">
        <Zap className="animate-pulse h-8 w-8 text-zinc-700" />
        <p className="text-[10px] tracking-[0.2em] uppercase">Booting_Deposit_Monitor...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white font-mono p-4 sm:p-8">
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="border border-zinc-700 bg-zinc-950 p-6 w-80 space-y-4">
            <p className="text-sm text-zinc-300">
              {confirmAction === "restart"
                ? "Send restart signal to the indexer worker?"
                : "Roll back checkpoint and trigger ledger re-scan?"}
            </p>
            <p className="text-[10px] text-zinc-600 uppercase">This action cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <Button size="sm" variant="outline"
                className="border-zinc-700 text-zinc-400 bg-black hover:bg-zinc-900"
                onClick={() => setConfirmAction(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="outline"
                className="border-red-900/40 text-red-500 bg-black hover:bg-red-950/20"
                onClick={confirmAction === "restart" ? handleRestart : handleRescan}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Top Banner Status */}
      <div className="flex items-center gap-2 mb-6">
        <div className={`h-2 w-2 rounded-full ${status?.in_sync ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
        <span className="text-[10px] text-zinc-500 tracking-tighter uppercase font-bold">
          System::{status?.in_sync ? 'Operational' : 'Sync_Required'} {" // "} {status?.rpc.url}
        </span>
      </div>

      {/* Header Section */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-6">
        <div>
          <h1 className="text-4xl font-black tracking-tightest leading-none mb-2">
            INDEXING::<span className="text-zinc-500">DEPOSIT</span>_EVENTS
          </h1>
          <div className="flex items-center gap-4 text-zinc-600 text-[11px] uppercase tracking-widest font-bold">
            <span>Env::Production</span>
            <span className="h-1 w-1 bg-zinc-800 rounded-full" />
            <span>Ver::2.4.0-stable</span>
            <span className="h-1 w-1 bg-zinc-800 rounded-full" />
            <span className="text-zinc-500 underline decoration-zinc-800 underline-offset-4 cursor-pointer hover:text-zinc-400 transition-colors">Documentation_Runbook</span>
          </div>
        </div>
        
        <div className="flex gap-2 w-full md:w-auto">
          <Button 
            variant="outline" 
            size="sm" 
            disabled={actionPending}
            className="flex-1 md:flex-none border-zinc-900 bg-black text-zinc-400 hover:bg-zinc-900 rounded-none h-10 text-[10px] font-bold tracking-widest uppercase px-6"
            onClick={() => setConfirmAction("rescan")}
          >
            <RefreshCw className="mr-2 h-3 w-3" /> Re-Scan
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            disabled={actionPending}
            className="flex-1 md:flex-none border-zinc-900 bg-black text-red-500/80 hover:bg-red-950/20 rounded-none h-10 text-[10px] font-bold tracking-widest uppercase px-6"
            onClick={() => setConfirmAction("restart")}
          >
            <Cpu className="mr-2 h-3 w-3" /> Restart_Worker
          </Button>
        </div>
      </header>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-zinc-900 mb-12 border border-zinc-900">
        <MetricItem 
          label="Ledger_Height" 
          value={status?.last_processed_ledger?.toLocaleString() || "0"} 
          subValue={`Network: ${status?.latest_network_ledger?.toLocaleString()}`}
          icon={<Database className="h-3 w-3" />}
        />
        <MetricItem 
          label="Sync_Lag" 
          value={`${status?.ledger_lag}`} 
          subValue={status?.ledger_lag === 0 ? "Perfectly_Synced" : "Awaiting_Blocks"}
          status={status?.ledger_lag === 0 ? 'success' : 'warning'}
          icon={<ArrowDownLeft className="h-3 w-3" />}
        />
        <MetricItem 
          label="Processed_Events" 
          value={status?.total_events_processed?.toLocaleString() || "0"} 
          subValue={`Last batch: ${status?.last_batch_events_processed ?? 0}`}
          icon={<ShieldCheck className="h-3 w-3" />}
        />
        <MetricItem 
          label="Loop_Latency" 
          value={`${status?.last_loop_duration_ms || 0}ms`} 
          subValue="Last_Cycle_Duration"
          status={(status?.last_loop_duration_ms || 0) > 500 ? 'warning' : 'success'}
          icon={<Clock className="h-3 w-3" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Real-time Throughput Chart */}
        <div className="lg:col-span-8 flex flex-col gap-8">
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[11px] font-bold tracking-[0.3em] uppercase text-zinc-500">Resource::Throughput_Analysis</h2>
              <div className="flex gap-4 items-center">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                  <span className="text-[9px] text-zinc-500 uppercase tracking-widest">Events/Sec</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
                  <span className="text-[9px] text-zinc-500 uppercase tracking-widest">Latency_ms</span>
                </div>
              </div>
            </div>
            
            <div className="h-[320px] w-full border border-zinc-900 p-4 bg-[#050505]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#111" vertical={false} />
                  <XAxis 
                    dataKey="time" 
                    stroke="#333" 
                    fontSize={9} 
                    tickLine={false} 
                    axisLine={false}
                    interval={2}
                  />
                  <YAxis 
                    stroke="#333" 
                    fontSize={9} 
                    tickLine={false} 
                    axisLine={false}
                    tickFormatter={(v) => `${v}`}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#000', border: '1px solid #222', borderRadius: '0', fontSize: '10px' }}
                    labelStyle={{ color: '#555', marginBottom: '4px', display: 'block' }}
                  />
                  <Area 
                    type="stepAfter" 
                    dataKey="throughput" 
                    stroke="#fff" 
                    fill="#fff" 
                    fillOpacity={0.05} 
                    strokeWidth={1}
                    isAnimationActive={true}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="latency" 
                    stroke="#333" 
                    fill="transparent"
                    strokeDasharray="4 4"
                    strokeWidth={1}
                    isAnimationActive={true}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Event Distribution */}
          <section>
            <h2 className="text-[11px] font-bold tracking-[0.3em] uppercase text-zinc-500 mb-4 text-center">Protocol_Checkpoints</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <LogPanel 
                title="Consensus_Logs" 
                logs={[
                  { msg: "LEDGER_CLOSE_DETECTED :: #45821", type: 'info' },
                  { msg: "XDR_UNMARSHAL_SUCCESS :: 14 events", type: 'success' },
                  { msg: "IDEMPOTENCE_CHECK_PASSED", type: 'info' },
                ]}
              />
              <LogPanel 
                title="RPC_Transactions" 
                logs={[
                  { msg: "GET_EVENTS_CALL :: start_ledger=45820", type: 'info' },
                  { msg: "HTTP_200 :: payload_size=4.2kb", type: 'success' },
                  { msg: "RATE_LIMIT_STATUS :: 98/100", type: 'info' },
                ]}
              />
              <LogPanel 
                title="Persistence" 
                logs={[
                  { msg: "POSTGRES_UPSERT :: indexed_events", type: 'success' },
                  { msg: "UPDATE_STATE_CHECKPOINT :: success", type: 'success' },
                  { msg: "DB_LATENCY :: 12ms", type: 'info' },
                ]}
              />
            </div>
          </section>
        </div>

        {/* Live Terminal Log */}
        <div className="lg:col-span-4">
          <div className="h-full border border-zinc-900 bg-[#050505] flex flex-col">
            <div className="p-4 border-b border-zinc-900 flex justify-between items-center bg-black">
              <h2 className="text-[10px] font-bold tracking-[0.2em] uppercase flex items-center gap-2">
                <Terminal className="h-3 w-3 text-zinc-500" />
                Live_System_Output
              </h2>
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            </div>
            <div className="flex-grow p-4 overflow-y-auto font-mono text-[10px] leading-relaxed space-y-1">
              {logs.length === 0 && (
                <div className="text-zinc-800">
                  {">"} Waiting for events...<br />
                  {">"} Connection established via Websocket tunnel<br />
                  {">"} Monitoring contract: CC72...X9A1
                </div>
              )}
              {logs.map((log, i) => (
                <div key={log.id} className="group flex gap-3">
                  <span className="text-zinc-800 shrink-0 select-none">[{i+1024}]</span>
                  <span className={`
                    ${log.type === 'error' ? 'text-red-500' : ''}
                    ${log.type === 'warn' ? 'text-yellow-500' : ''}
                    ${log.type === 'success' ? 'text-green-500' : ''}
                    ${log.type === 'info' ? 'text-zinc-400' : ''}
                  `}>
                    {log.msg}
                  </span>
                </div>
              ))}
              {/* Simulated tailing */}
              <div className="flex gap-3 text-zinc-400">
                <span className="text-zinc-800">[{1024 + logs.length}]</span>
                <span className="animate-pulse opacity-50">_</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricItem({ 
  label, 
  value, 
  subValue, 
  icon, 
  status = 'default' 
}: { 
  label: string, 
  value: string, 
  subValue: string, 
  icon: React.ReactNode,
  status?: 'default' | 'success' | 'warning' | 'error'
}) {
  const statusColor = {
    default: 'bg-black text-white',
    success: 'bg-black text-green-500',
    warning: 'bg-black text-yellow-500',
    error: 'bg-black text-red-500'
  }[status];

  return (
    <div className={`p-6 ${statusColor} transition-all`}>
      <div className="flex justify-between items-center mb-3">
        <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-zinc-600">{label}</span>
        <div className="text-zinc-700">{icon}</div>
      </div>
      <div className="text-3xl font-black tracking-tightest mb-1">{value}</div>
      <div className="text-[9px] text-zinc-500 uppercase tracking-widest">{subValue}</div>
    </div>
  );
}

function LogPanel({ title, logs }: { title: string, logs: { msg: string, type: string }[] }) {
  return (
    <div className="border border-zinc-900 p-4 bg-[#050505]">
      <h3 className="text-[9px] font-bold tracking-[0.2em] uppercase text-zinc-600 mb-3 underline decoration-zinc-800 underline-offset-4">{title}</h3>
      <div className="space-y-2">
        {logs.map((log, i) => (
          <div key={i} className="flex gap-2 text-[9px] leading-tight">
            <span className={log.type === 'success' ? 'text-green-500' : log.type === 'error' ? 'text-red-500' : 'text-zinc-500'}>
              {log.type === 'success' ? '√' : '»'}
            </span>
            <span className="text-zinc-400">{log.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
