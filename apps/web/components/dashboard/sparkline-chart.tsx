"use client";

/**
 * SparklineChart - Minimal line chart for earnings trends
 * 
 * Features:
 * - SVG-based rendering
 * - Smooth curves
 * - Gradient fill
 * - Responsive sizing
 */

export interface SparklineChartProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}

export function SparklineChart({
  data,
  width = 200,
  height = 48,
  className = "",
}: SparklineChartProps) {
  if (data.length === 0) {
    return (
      <div
        className={`sparkline ${className}`}
        style={{ width, height }}
      >
        <svg width={width} height={height}>
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            fill="#71717a"
            fontSize="12"
          >
            No data
          </text>
        </svg>
      </div>
    );
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return { x, y };
  });

  const pathD = points
    .map((point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      
      // Smooth curve using quadratic bezier
      const prevPoint = points[index - 1];
      const midX = (prevPoint.x + point.x) / 2;
      return `Q ${prevPoint.x} ${prevPoint.y}, ${midX} ${(prevPoint.y + point.y) / 2} Q ${point.x} ${point.y}, ${point.x} ${point.y}`;
    })
    .join(" ");

  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  return (
    <div className={`sparkline ${className}`} style={{ width, height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="sparkline-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        
        {/* Area fill */}
        <path d={areaD} className="sparkline-area" />
        
        {/* Line */}
        <path d={pathD} className="sparkline-path" />
      </svg>
    </div>
  );
}
