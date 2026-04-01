import { Star } from "lucide-react";

export function Stars({
  value,
  total = 5,
  className = "",
}: {
  value: number;
  total?: number;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {Array.from({ length: total }, (_, index) => {
        const fill = Math.max(0, Math.min(1, value - index));
        return (
          <span key={index} className="relative inline-flex h-4 w-4">
            <Star className="absolute h-4 w-4 text-slate-300" />
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fill * 100}%` }}
            >
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            </span>
          </span>
        );
      })}
    </div>
  );
}
