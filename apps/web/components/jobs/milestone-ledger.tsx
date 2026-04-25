import { Milestone } from "@/lib/api";
import { formatUsdc, formatDateTime } from "@/lib/format";
import { CheckCircle2, Clock } from "lucide-react";

interface MilestoneLedgerProps {
  milestones: Milestone[];
}

export function MilestoneLedger({ milestones }: MilestoneLedgerProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-lg font-semibold text-white">Milestone Ledger</h3>
        <span className="text-xs text-zinc-500 font-medium">
          {milestones.length} Phases Total
        </span>
      </div>
      <div className="grid gap-3">
        {milestones.map((m) => (
          <div
            key={m.id}
            className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 transition-all hover:border-zinc-700 hover:bg-zinc-900/50"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                  m.status === 'released' 
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500' 
                    : 'border-zinc-700 bg-zinc-800 text-zinc-500'
                }`}>
                  {m.status === 'released' ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                </div>
                <div>
                  <div className="text-sm font-semibold text-zinc-200">
                    Phase {m.index}: {m.title}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {m.status === 'released' ? `Released on ${formatDateTime(m.released_at!)}` : 'Pending approval'}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-white tabular-nums">
                  {formatUsdc(m.amount_usdc)}
                </div>
                <div className={`text-[10px] font-bold uppercase tracking-widest ${
                  m.status === 'released' ? 'text-emerald-500' : 'text-zinc-600'
                }`}>
                  {m.status}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
