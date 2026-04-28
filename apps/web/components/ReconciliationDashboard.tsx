"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area,
    CartesianGrid,
} from "recharts";
import { CheckCircle, AlertCircle, RefreshCcw, Play } from "lucide-react";

type ThroughputPoint = { t: string; indexed: number };
type ResourcePoint = { t: string; cpu: number; mem: number };
type EventRow = { id: number; ledger: string; event: string; ts: string };

export default function ReconciliationDashboard(): JSX.Element {
    const [throughput, setThroughput] = useState<ThroughputPoint[]>(() => seedThroughput());
    const [resources, setResources] = useState<ResourcePoint[]>(() => seedResources());
    const [events, setEvents] = useState<EventRow[]>(() => seedEvents());
    const [statusHealthy, setStatusHealthy] = useState(true);
    const [actionMsg, setActionMsg] = useState<string | null>(null);

    useEffect(() => {
        const t = setInterval(() => {
            setThroughput((prev) => {
                const next = [...prev.slice(-29), randomThroughputPoint()];
                return next;
            });

            setResources((prev) => {
                const next = [...prev.slice(-29), randomResourcePoint()];
                return next;
            });

            setEvents((prev) => {
                const now = new Date();
                const nextEvent: EventRow = {
                    id: prev.length + 1,
                    ledger: (Math.floor(Math.random() * 1_000_000) + 100000).toString(),
                    event: Math.random() > 0.8 ? "error_event" : "indexed_event",
                    ts: now.toISOString(),
                };
                const next = [nextEvent, ...prev].slice(0, 20);
                return next;
            });

            // occasionally flip health
            if (Math.random() > 0.97) setStatusHealthy((s) => !s);
        }, 1500);

        return () => clearInterval(t);
    }, []);

    const latestLedger = useMemo(() => throughput[throughput.length - 1]?.indexed ?? 0, [throughput]);

    function onRestart() {
        const ok = window.confirm("Are you sure you want to restart the indexer?");
        if (!ok) return;
        setActionMsg("Restarting indexer...");
        setTimeout(() => setActionMsg("Indexer restarted"), 900);
        setTimeout(() => setActionMsg(null), 1800);
    }

    function onRescan() {
        const ok = window.confirm("Trigger ledger re-scan from checkpoint? This may re-process many ledgers.");
        if (!ok) return;
        setActionMsg("Starting ledger re-scan...");
        setTimeout(() => setActionMsg("Re-scan queued"), 1200);
        setTimeout(() => setActionMsg(null), 2800);
    }

    return (
        <div className="min-h-screen p-6 bg-zinc-950 text-zinc-300 font-sans">
            <div className="max-w-7xl mx-auto">
                <header className="flex items-center justify-between mb-4">
                    <h1 className="text-lg font-semibold">Reconciliation — Monitoring</h1>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            {statusHealthy ? (
                                <CheckCircle className="text-green-400" />
                            ) : (
                                <AlertCircle className="text-rose-500" />
                            )}
                            <span className="text-xs font-mono">{statusHealthy ? "Healthy" : "Degraded"}</span>
                        </div>

                        <button
                            onClick={onRestart}
                            className="inline-flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 text-xs rounded text-zinc-200 hover:bg-zinc-800"
                        >
                            <RefreshCcw className="w-4 h-4" /> Restart
                        </button>

                        <button
                            onClick={onRescan}
                            className="inline-flex items-center gap-2 px-3 py-1 bg-zinc-900 border border-zinc-800 text-xs rounded text-zinc-200 hover:bg-zinc-800"
                        >
                            <Play className="w-4 h-4" /> Rescan
                        </button>
                    </div>
                </header>

                {actionMsg && (
                    <div className="mb-4 p-2 bg-zinc-900 border border-zinc-800 rounded text-sm">{actionMsg}</div>
                )}

                <section className="grid grid-cols-12 gap-4">
                    <div className="col-span-7 bg-zinc-900 border border-zinc-800 rounded p-3">
                        <div className="flex items-baseline justify-between mb-2">
                            <div>
                                <div className="text-xs text-zinc-400">Latest processed ledger</div>
                                <div className="text-2xl font-mono">{latestLedger}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-xs text-zinc-400">Throughput (ledgers/s)</div>
                                <div className="text-sm font-mono">{Math.round(throughput.slice(-5).reduce((s, p) => s + p.indexed, 0) / 5 || 0)}</div>
                            </div>
                        </div>

                        <div className="h-44">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={throughput} margin={{ top: 6, right: 12, left: 0, bottom: 6 }}>
                                    <CartesianGrid stroke="#111827" strokeDasharray="3 3" />
                                    <XAxis dataKey="t" tick={{ fill: "#9CA3AF", fontSize: 10 }} />
                                    <YAxis tick={{ fill: "#9CA3AF", fontSize: 10 }} />
                                    <Tooltip wrapperStyle={{ background: "#0b0b0b", borderRadius: 4 }} />
                                    <Line type="monotone" dataKey="indexed" stroke="#10B981" strokeWidth={2} dot={false} isAnimationActive={true} animationDuration={400} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3">
                            <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-xs">
                                <div className="text-zinc-400 mb-1">Indexer Uptime</div>
                                <div className="font-mono text-sm">3 days 12:34:11</div>
                            </div>
                            <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-xs">
                                <div className="text-zinc-400 mb-1">Last Success</div>
                                <div className="font-mono text-sm">{new Date().toISOString()}</div>
                            </div>
                        </div>
                    </div>

                    <div className="col-span-5 bg-zinc-900 border border-zinc-800 rounded p-3">
                        <div className="text-xs text-zinc-400 mb-2">Resource Usage</div>
                        <div className="h-32 mb-3">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={resources} margin={{ top: 6, right: 6, left: 0, bottom: 6 }}>
                                    <defs>
                                        <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#60A5FA" stopOpacity={0.8} />
                                            <stop offset="100%" stopColor="#60A5FA" stopOpacity={0.02} />
                                        </linearGradient>
                                        <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#F97316" stopOpacity={0.8} />
                                            <stop offset="100%" stopColor="#F97316" stopOpacity={0.02} />
                                        </linearGradient>
                                    </defs>
                                    <XAxis dataKey="t" tick={{ fill: "#9CA3AF", fontSize: 10 }} hide />
                                    <YAxis tick={{ fill: "#9CA3AF", fontSize: 10 }} />
                                    <Tooltip wrapperStyle={{ background: "#0b0b0b", borderRadius: 4 }} />
                                    <Area type="monotone" dataKey="cpu" stroke="#60A5FA" fillOpacity={1} fill="url(#cpuGrad)" isAnimationActive={true} />
                                    <Area type="monotone" dataKey="mem" stroke="#F97316" fillOpacity={1} fill="url(#memGrad)" isAnimationActive={true} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="text-xs text-zinc-400 mb-2">Recent Events</div>
                        <div className="max-h-48 overflow-auto border border-zinc-800 rounded text-xs">
                            <table className="min-w-full table-fixed text-left">
                                <thead className="sticky top-0 bg-zinc-900">
                                    <tr>
                                        <th className="px-2 py-1 w-12">#</th>
                                        <th className="px-2 py-1">Ledger</th>
                                        <th className="px-2 py-1">Event</th>
                                        <th className="px-2 py-1 w-40">Time</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {events.map((e) => (
                                        <tr key={e.id} className="border-t border-zinc-800">
                                            <td className="px-2 py-1 font-mono text-xs">{e.id}</td>
                                            <td className="px-2 py-1 font-mono text-xs">{shortHash(e.ledger)}</td>
                                            <td className={`px-2 py-1 text-xs ${e.event === "error_event" ? "text-rose-400" : "text-zinc-200"}`}>{e.event}</td>
                                            <td className="px-2 py-1 text-xs font-mono">{e.ts.slice(11, 19)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                <footer className="mt-4 text-xs text-zinc-500">Monochrome monitoring · compact technical UI</footer>
            </div>
        </div>
    );
}

// Helpers and mock data generators
function seedThroughput(): ThroughputPoint[] {
    const now = Date.now();
    const pts: ThroughputPoint[] = [];
    for (let i = -29; i <= 0; i++) {
        pts.push({ t: timeLabel(now + i * 1500), indexed: Math.max(0, Math.round(5 + Math.random() * 20)) });
    }
    return pts;
}

function seedResources(): ResourcePoint[] {
    const now = Date.now();
    const pts: ResourcePoint[] = [];
    for (let i = -29; i <= 0; i++) {
        pts.push({ t: timeLabel(now + i * 1500), cpu: Math.random() * 60 + 10, mem: Math.random() * 40 + 10 });
    }
    return pts;
}

function seedEvents(): EventRow[] {
    const now = new Date();
    return Array.from({ length: 8 }).map((_, idx) => ({
        id: idx + 1,
        ledger: (100000 + Math.floor(Math.random() * 900000)).toString(),
        event: Math.random() > 0.9 ? "error_event" : "indexed_event",
        ts: new Date(now.getTime() - idx * 1000).toISOString(),
    }));
}

function timeLabel(ts: number) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function randomThroughputPoint(): ThroughputPoint {
    return { t: timeLabel(Date.now()), indexed: Math.max(0, Math.round(5 + Math.random() * 20)) };
}

function randomResourcePoint(): ResourcePoint {
    return { t: timeLabel(Date.now()), cpu: Math.random() * 60 + 5, mem: Math.random() * 40 + 20 };
}

function shortHash(s: string) {
    if (s.length <= 10) return s;
    return `${s.slice(0, 6)}..${s.slice(-4)}`;
}
