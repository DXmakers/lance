'use client';

import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { AlertCircle, CheckCircle, RefreshCw, Play, RotateCcw } from 'lucide-react';

interface HealthStatus {
  status: 'ok' | 'lagging' | 'degraded';
  current_ledger: number | null;
  processed_ledger: number | null;
  lag: number | null;
  max_allowed_lag: number;
  in_sync: boolean;
}

interface MetricsData {
  timestamp: string;
  eventProcessingRate: number;
  errorCount: number;
  lag: number;
  processingDuration: number;
}

export function IndexerMonitoringDashboard() {
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<MetricsData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [showRescanConfirm, setShowRescanConfirm] = useState(false);
  const [rescanRange, setRescanRange] = useState({ start: '', end: '' });

  // Fetch health status
  const fetchHealthStatus = async () => {
    try {
      const response = await fetch('/api/health/sync');
      if (!response.ok) throw new Error('Failed to fetch health status');
      const data = await response.json();
      setHealthStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  // Fetch metrics
  const fetchMetrics = async () => {
    try {
      const response = await fetch('/api/metrics');
      if (!response.ok) throw new Error('Failed to fetch metrics');
      const text = await response.text();
      
      // Parse Prometheus text format
      const lines = text.split('\n');
      const metrics: Record<string, number> = {};
      
      lines.forEach(line => {
        if (!line.startsWith('#') && line.trim()) {
          const [key, value] = line.split(' ');
          if (key && value) {
            metrics[key] = parseFloat(value);
          }
        }
      });

      // Add to history
      const newDataPoint: MetricsData = {
        timestamp: new Date().toLocaleTimeString(),
        eventProcessingRate: metrics['indexer_events_processed_total'] || 0,
        errorCount: metrics['indexer_error_total'] || 0,
        lag: metrics['indexer_current_lag'] || 0,
        processingDuration: metrics['indexer_last_processing_duration_ms'] || 0,
      };

      setMetricsHistory(prev => {
        const updated = [...prev, newDataPoint];
        // Keep last 60 data points
        return updated.slice(-60);
      });
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
    }
  };

  // Initial load and setup auto-refresh
  useEffect(() => {
    fetchHealthStatus();
    fetchMetrics();
    setLoading(false);

    if (autoRefresh) {
      const interval = setInterval(() => {
        fetchHealthStatus();
        fetchMetrics();
      }, 5000); // Refresh every 5 seconds

      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  // Handle restart indexer
  const handleRestartIndexer = async () => {
    try {
      const response = await fetch('/api/indexer/restart', { method: 'POST' });
      if (!response.ok) throw new Error('Failed to restart indexer');
      setShowRestartConfirm(false);
      // Refresh status after restart
      setTimeout(() => {
        fetchHealthStatus();
        fetchMetrics();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart');
    }
  };

  // Handle re-scan ledger range
  const handleRescanLedgers = async () => {
    if (!rescanRange.start || !rescanRange.end) {
      setError('Please enter both start and end ledger numbers');
      return;
    }

    try {
      const response = await fetch('/api/indexer/rescan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_ledger: parseInt(rescanRange.start),
          end_ledger: parseInt(rescanRange.end),
        }),
      });
      if (!response.ok) throw new Error('Failed to start re-scan');
      setShowRescanConfirm(false);
      setRescanRange({ start: '', end: '' });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-scan');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const statusColor = healthStatus?.in_sync ? 'text-green-600' : 'text-red-600';
  const statusBgColor = healthStatus?.in_sync ? 'bg-green-50' : 'bg-red-50';
  const statusIcon = healthStatus?.in_sync ? (
    <CheckCircle className="w-6 h-6 text-green-600" />
  ) : (
    <AlertCircle className="w-6 h-6 text-red-600" />
  );

  return (
    <div className="w-full bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Indexer Monitoring Dashboard</h1>
          <div className="flex gap-2">
            <button
              onClick={() => {
                fetchHealthStatus();
                fetchMetrics();
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <label className="flex items-center gap-2 px-4 py-2 bg-white border rounded">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh
            </label>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded text-red-700">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Health Status Card */}
        <div className={`mb-6 p-6 rounded-lg border-2 ${statusBgColor}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {statusIcon}
              <div>
                <h2 className="text-xl font-semibold">
                  {healthStatus?.in_sync ? 'Indexer Synced' : 'Indexer Lagging'}
                </h2>
                <p className={`text-sm ${statusColor}`}>
                  Status: {healthStatus?.status}
                </p>
              </div>
            </div>
            <div className="text-right font-mono">
              <div className="text-sm text-gray-600">Current Ledger</div>
              <div className="text-2xl font-bold">{healthStatus?.current_ledger || 'N/A'}</div>
              <div className="text-sm text-gray-600 mt-2">Processed Ledger</div>
              <div className="text-2xl font-bold">{healthStatus?.processed_ledger || 'N/A'}</div>
              <div className="text-sm text-gray-600 mt-2">Lag</div>
              <div className={`text-2xl font-bold ${healthStatus?.lag! > healthStatus?.max_allowed_lag! ? 'text-red-600' : 'text-green-600'}`}>
                {healthStatus?.lag || 'N/A'} / {healthStatus?.max_allowed_lag}
              </div>
            </div>
          </div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Event Processing Rate */}
          <div className="bg-white p-6 rounded-lg border">
            <h3 className="text-lg font-semibold mb-4">Event Processing Rate</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={metricsHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="eventProcessingRate"
                  stroke="#3b82f6"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Error Count */}
          <div className="bg-white p-6 rounded-lg border">
            <h3 className="text-lg font-semibold mb-4">Error Count</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={metricsHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="errorCount" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Ledger Lag Over Time */}
          <div className="bg-white p-6 rounded-lg border">
            <h3 className="text-lg font-semibold mb-4">Ledger Lag Over Time</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={metricsHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="lag"
                  fill="#10b981"
                  stroke="#059669"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Processing Duration */}
          <div className="bg-white p-6 rounded-lg border">
            <h3 className="text-lg font-semibold mb-4">Processing Duration (ms)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={metricsHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="processingDuration"
                  stroke="#f59e0b"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Restart Indexer */}
          <div className="bg-white p-6 rounded-lg border">
            <h3 className="text-lg font-semibold mb-4">Restart Indexer</h3>
            <p className="text-sm text-gray-600 mb-4">
              Restart the indexer worker. This will gracefully shutdown and restart the service.
            </p>
            <button
              onClick={() => setShowRestartConfirm(true)}
              className="w-full px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4" />
              Restart Indexer
            </button>

            {showRestartConfirm && (
              <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
                <p className="text-sm font-semibold mb-3">Confirm restart?</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleRestartIndexer}
                    className="flex-1 px-3 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 text-sm"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setShowRestartConfirm(false)}
                    className="flex-1 px-3 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Re-scan Ledger Range */}
          <div className="bg-white p-6 rounded-lg border">
            <h3 className="text-lg font-semibold mb-4">Re-scan Ledger Range</h3>
            <p className="text-sm text-gray-600 mb-4">
              Re-process events from a specific ledger range. Useful for recovery.
            </p>

            {!showRescanConfirm ? (
              <button
                onClick={() => setShowRescanConfirm(true)}
                className="w-full px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Re-scan Ledgers
              </button>
            ) : (
              <div className="space-y-3">
                <input
                  type="number"
                  placeholder="Start Ledger"
                  value={rescanRange.start}
                  onChange={(e) => setRescanRange({ ...rescanRange, start: e.target.value })}
                  className="w-full px-3 py-2 border rounded font-mono text-sm"
                />
                <input
                  type="number"
                  placeholder="End Ledger"
                  value={rescanRange.end}
                  onChange={(e) => setRescanRange({ ...rescanRange, end: e.target.value })}
                  className="w-full px-3 py-2 border rounded font-mono text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleRescanLedgers}
                    className="flex-1 px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 text-sm"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => {
                      setShowRescanConfirm(false);
                      setRescanRange({ start: '', end: '' });
                    }}
                    className="flex-1 px-3 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Metrics Summary */}
        <div className="mt-6 bg-white p-6 rounded-lg border">
          <h3 className="text-lg font-semibold mb-4">Metrics Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-sm">
            <div className="p-3 bg-gray-50 rounded">
              <div className="text-gray-600">Current Ledger</div>
              <div className="text-xl font-bold">{healthStatus?.current_ledger || 'N/A'}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded">
              <div className="text-gray-600">Processed Ledger</div>
              <div className="text-xl font-bold">{healthStatus?.processed_ledger || 'N/A'}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded">
              <div className="text-gray-600">Lag</div>
              <div className="text-xl font-bold">{healthStatus?.lag || 'N/A'}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded">
              <div className="text-gray-600">Status</div>
              <div className={`text-xl font-bold ${statusColor}`}>
                {healthStatus?.status || 'N/A'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
