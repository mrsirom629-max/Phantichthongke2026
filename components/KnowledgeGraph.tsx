'use client';
/**
 * Đồ thị tri thức số lô tô — visual theo mô hình WeKnora người dùng gửi:
 * nền tối, node tròn màu sắc theo điểm PageRank, cạnh mờ theo trọng số,
 * nhấp vào một node để xem phân tích chi tiết số đó.
 */
import { useMemo, useState } from 'react';

interface Props {
  scores: number[]; // PageRank — độ dài mảng = số node (100 số lô tô / 55 số Power)
  edges: { a: number; b: number; weight: number }[]; // cạnh đã lọc top (chỉ số 0-based)
  selected: number | null; // chỉ số node đang chọn (0-based)
  onSelect: (n: number) => void;
  /** Nhãn hiển thị của node; mặc định "00".."99" theo chỉ số. */
  labelOf?: (n: number) => string;
  ariaLabel?: string;
}

const W = 640;
const H = 640;
const CX = W / 2;
const CY = H / 2;
const R = 250;

/** Màu node theo phân vị điểm: từ chàm → tím → hồng → cam (như ảnh mẫu). */
function colorFor(t: number): string {
  // t in [0,1]: 0 = điểm thấp nhất, 1 = cao nhất
  const hue = 230 - t * 200; // 230 (chàm) → 30 (cam)
  const sat = 65 + t * 25;
  const lit = 45 + t * 15;
  return `hsl(${hue.toFixed(0)},${sat.toFixed(0)}%,${lit.toFixed(0)}%)`;
}

export default function KnowledgeGraph({ scores, edges, selected, onSelect, labelOf, ariaLabel }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const N = scores.length;

  const nodes = useMemo(() => {
    const order = scores
      .map((s, i) => ({ s, i }))
      .sort((a, b) => a.s - b.s)
      .map((x) => x.i);
    const rankOf = new Array(N).fill(0);
    order.forEach((num, r) => (rankOf[num] = N > 1 ? r / (N - 1) : 0));
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const span = max - min || 1;
    const label = labelOf ?? ((n: number) => String(n).padStart(2, '0'));
    return Array.from({ length: N }, (_, n) => {
      const ang = (n / N) * Math.PI * 2 - Math.PI / 2;
      const t = (scores[n] - min) / span;
      return {
        n,
        x: CX + R * Math.cos(ang),
        y: CY + R * Math.sin(ang),
        r: 9 + t * 17,
        color: colorFor(rankOf[n]),
        label: label(n),
        showLabel: t > 0.35,
      };
    });
  }, [scores, N, labelOf]);

  const maxW = useMemo(
    () => edges.reduce((m, e) => Math.max(m, e.weight), 1),
    [edges],
  );
  const active = hover ?? selected;

  return (
    <div>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
        <span style={{ color: '#34d399' }}>●</span> Nhấp chuột vào một node để xem
        phân tích chi tiết số đó — kích thước &amp; màu sắc thể hiện điểm PageRank.
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', background: '#0b0f1a', borderRadius: 12 }}
        role="img"
        aria-label={ariaLabel ?? 'Đồ thị tri thức các số lô tô'}
      >
        {/* cạnh */}
        {edges.map((e, i) => {
          const a = nodes[e.a];
          const b = nodes[e.b];
          const isActive = active !== null && (e.a === active || e.b === active);
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={isActive ? '#e5e7eb' : '#4b5563'}
              strokeWidth={isActive ? 1.6 : 0.7}
              opacity={isActive ? 0.9 : 0.12 + 0.35 * (e.weight / maxW)}
            />
          );
        })}
        {/* node */}
        {nodes.map((nd) => {
          const isSel = selected === nd.n;
          const isHov = hover === nd.n;
          const dim = active !== null && active !== nd.n;
          return (
            <g
              key={nd.n}
              onClick={() => onSelect(nd.n)}
              onMouseEnter={() => setHover(nd.n)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1 }}
            >
              {(isSel || isHov) && (
                <circle cx={nd.x} cy={nd.y} r={nd.r + 5} fill="none" stroke="#fff" strokeWidth={1.5} opacity={0.8} />
              )}
              <circle cx={nd.x} cy={nd.y} r={nd.r} fill={nd.color} opacity={0.92} />
              {nd.showLabel && (
                <text
                  x={nd.x}
                  y={nd.y + 3.5}
                  textAnchor="middle"
                  fontSize={nd.r > 16 ? 11 : 8.5}
                  fontWeight={700}
                  fill="#0b0f1a"
                  pointerEvents="none"
                >
                  {nd.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
