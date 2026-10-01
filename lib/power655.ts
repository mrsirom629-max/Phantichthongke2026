/**
 * Mô hình phân tích nâng cao cho Power 6/55.
 *
 * NGUYÊN TẮC TRUNG THỰC: các kỳ quay là độc lập ngẫu nhiên — mọi mô hình ở
 * đây là MÔ TẢ & KIỂM ĐỊNH thống kê (đo "tính ngẫu nhiên", so với lý thuyết),
 * không phải dự đoán. Điểm số không phải xác suất trúng.
 */
import type { PowerDraw } from './vietlott';

export const N55 = 55;
const DRAWN = 6;

/* ── Tần suất & gan ─────────────────────────────────────────── */

export interface Freq55 {
  main: number[]; // số kỳ xuất hiện (6 số chính), index 0..54 cho số 1..55
  bonus: number[]; // số kỳ xuất hiện ở vị trí số đặc biệt
  gap: (number | null)[]; // số kỳ vắng mặt gần nhất (null = chưa từng về)
  draws: number;
}

export function freq55(draws: PowerDraw[]): Freq55 {
  const main = new Array(N55).fill(0);
  const bonus = new Array(N55).fill(0);
  // Sắp xếp cũ -> mới để tính gan chắc chắn đúng mọi thứ tự đầu vào
  const key = (s: string) => s.split('-').reverse().join('');
  const chrono = draws.slice().sort((a, b) => (key(a.date) < key(b.date) ? -1 : 1));
  for (const d of chrono) {
    for (const n of d.numbers) main[n - 1]++;
    bonus[d.bonus - 1]++;
  }
  const lastSeen = new Array(N55).fill(-1);
  chrono.forEach((d, i) => {
    for (const n of d.numbers) lastSeen[n - 1] = i;
  });
  const gap: (number | null)[] = lastSeen.map((ls) =>
    ls < 0 ? null : chrono.length - 1 - ls,
  );
  return { main, bonus, gap, draws: draws.length };
}

/* ── Kiểm định chi-square tính đồng đều ─────────────────────── */

/** Gamma logarit (Lanczos) — phục vụ tính p-value chi-square. */
function gammaln(x: number): number {
  const c = [76.18009172947146, -86.50532032961677, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) { y += 1; ser += c[j] / y; }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/** P(a,x): gamma incomplete chuẩn hóa (dưới) — Numerical Recipes. */
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 1; n <= 200; n++) {
      ap++; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
  }
  // continued fraction cho Q rồi lấy 1-Q
  let b = x + 1 - a, c = 1e-300, d = 1 / b, h = d;
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
  return 1 - q;
}

export interface ChiSquareResult {
  chi2: number;
  df: number;
  pValue: number; // P(χ² ≥ quan sát | H0 đồng đều)
  expected: number; // tần suất kỳ vọng mỗi số
  verdict: 'uniform' | 'suspect'; // p>=0.05: không bác bỏ đồng đều
}

/**
 * Kiểm định H0: 55 số xuất hiện đồng đều ở 6 số chính.
 * p-value lớn (>=0.05) nghĩa là KHÔNG có bằng chứng lệch — đúng kỳ vọng
 * của quay ngẫu nhiên. p-value nhỏ mới đáng ngờ.
 */
export function chiSquareUniformity(draws: PowerDraw[]): ChiSquareResult {
  const n = draws.length;
  const expected = (n * DRAWN) / N55;
  const { main } = freq55(draws);
  let chi2 = 0;
  for (const o of main) chi2 += ((o - expected) ** 2) / expected;
  const df = N55 - 1;
  const pValue = 1 - gammaP(df / 2, chi2 / 2);
  return { chi2, df, pValue, expected, verdict: pValue >= 0.05 ? 'uniform' : 'suspect' };
}

/* ── Order statistics: vị trí sắp xếp so với lý thuyết ──────── */

export interface OrderStat {
  pos: number; // 1..6 (số nhỏ nhất -> lớn nhất)
  empirical: number; // trung bình thực tế
  theoretical: number; // E[X_(k)] = k*(55+1)/7
}

/** Kỳ vọng vị trí thứ k (1-indexed) khi rút 6 số từ 1..55. */
export function orderStatTheory(k: number): number {
  return (k * (N55 + 1)) / (DRAWN + 1);
}

export function orderStats(draws: PowerDraw[]): OrderStat[] {
  const sums = new Array(DRAWN).fill(0);
  for (const d of draws) {
    const s = d.numbers.slice().sort((a, b) => a - b);
    for (let k = 0; k < DRAWN; k++) sums[k] += s[k];
  }
  return sums.map((sum, k) => ({
    pos: k + 1,
    empirical: draws.length > 0 ? sum / draws.length : 0,
    theoretical: orderStatTheory(k + 1),
  }));
}

/* ── Hồ sơ tổ hợp (combinatorial profile) ───────────────────── */

export interface ComboRow {
  ky: string;
  date: string;
  odd: number; // số lượng số lẻ (lý thuyết: HG(55,28,6), TB=3.05)
  low: number; // số lượng số 1..27 (lý thuyết: HG(55,27,6), TB=2.95)
  sum: number; // tổng 6 số (lý thuyết TB=168)
  consec: number; // cặp liên tiếp (vd 13,14)
}

export function comboProfile(draws: PowerDraw[]): ComboRow[] {
  return draws.map((d) => {
    const s = d.numbers.slice().sort((a, b) => a - b);
    let consec = 0;
    for (let i = 1; i < s.length; i++) if (s[i] === s[i - 1] + 1) consec++;
    return {
      ky: d.ky,
      date: d.date,
      odd: s.filter((n) => n % 2 === 1).length,
      low: s.filter((n) => n <= 27).length,
      sum: s.reduce((a, b) => a + b, 0),
      consec,
    };
  });
}

/** P(X=k) siêu bội Hypergeometric(N=55, K, n=6). */
export function hypergeometric(k: number, K: number): number {
  const comb = (n: number, r: number): number => {
    if (r < 0 || r > n) return 0;
    r = Math.min(r, n - r);
    let c = 1;
    for (let i = 0; i < r; i++) c = (c * (n - i)) / (i + 1);
    return c;
  };
  return (comb(K, k) * comb(N55 - K, DRAWN - k)) / comb(N55, DRAWN);
}

/* ── PMI cặp số ─────────────────────────────────────────────── */

export interface PairPMI {
  a: number;
  b: number;
  co: number; // số kỳ cùng xuất hiện
  pmi: number; // ln(P(a,b) / P(a)P(b))
}

/**
 * Pointwise Mutual Information của các cặp số (6 số chính).
 * PMI>0: về cùng nhau nhiều hơn độc lập; PMI≈0: độc lập.
 * Chỉ xét cặp có co >= minCo để tránh nhiễu mẫu nhỏ.
 */
export function pairPMI(draws: PowerDraw[], minCo = 3, top = 20): PairPMI[] {
  const D = draws.length;
  if (D === 0) return [];
  const freq = new Array(N55).fill(0);
  const co = new Map<string, number>();
  for (const d of draws) {
    const s = d.numbers.slice().sort((a, b) => a - b);
    for (const n of s) freq[n - 1]++;
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++) {
        const k = `${s[i]}-${s[j]}`;
        co.set(k, (co.get(k) ?? 0) + 1);
      }
  }
  const out: PairPMI[] = [];
  co.forEach((c, k) => {
    if (c < minCo) return;
    const [a, b] = k.split('-').map(Number);
    const pab = c / D;
    const pa = freq[a - 1] / D;
    const pb = freq[b - 1] / D;
    if (pa === 0 || pb === 0) return;
    out.push({ a, b, co: c, pmi: Math.log(pab / (pa * pb)) });
  });
  return out.sort((x, y) => y.pmi - x.pmi).slice(0, top);
}

/* ── Đồ thị đồng xuất hiện 55 node + PageRank ───────────────── */

export interface Graph55 {
  adj: Map<number, Map<number, number>>; // 1..55
  days: number;
  freq: number[];
}

export function buildGraph55(draws: PowerDraw[]): Graph55 {
  const adj = new Map<number, Map<number, number>>();
  for (let n = 1; n <= N55; n++) adj.set(n, new Map());
  const freq = new Array(N55).fill(0);
  for (const d of draws) {
    const s = d.numbers;
    for (const n of s) freq[n - 1]++;
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++) {
        const a = s[i], b = s[j];
        adj.get(a)!.set(b, (adj.get(a)!.get(b) ?? 0) + 1);
        adj.get(b)!.set(a, (adj.get(b)!.get(a) ?? 0) + 1);
      }
  }
  return { adj, days: draws.length, freq };
}

/** PageRank viết tay cho đồ thị 55 node (tổng điểm = 1). */
export function pageRank55(graph: Graph55, damping = 0.85, iters = 60): number[] {
  const N = N55;
  const { adj } = graph;
  const outW = new Array(N + 1).fill(0);
  for (let i = 1; i <= N; i++) {
    let s = 0;
    adj.get(i)!.forEach((w) => (s += w));
    outW[i] = s;
  }
  let pr = new Array(N + 1).fill(1 / N);
  for (let it = 0; it < iters; it++) {
    const next = new Array(N + 1).fill((1 - damping) / N);
    let dangling = 0;
    for (let i = 1; i <= N; i++) if (outW[i] === 0) dangling += pr[i];
    for (let i = 1; i <= N; i++) {
      next[i] += (damping * dangling) / N;
      adj.get(i)!.forEach((w, j) => {
        next[j] += (damping * pr[i] * w) / outW[i];
      });
    }
    pr = next;
  }
  const out: number[] = [];
  for (let i = 1; i <= N; i++) out.push(pr[i]);
  return out;
}

export interface Edge55 {
  a: number;
  b: number;
  weight: number;
}

export function topEdges55(graph: Graph55, limit: number): Edge55[] {
  const edges: Edge55[] = [];
  graph.adj.forEach((m, a) => {
    m.forEach((w, b) => {
      if (b > a) edges.push({ a, b, weight: w });
    });
  });
  return edges.sort((x, y) => y.weight - x.weight).slice(0, limit);
}

export function fmtVND(v: number): string {
  return v.toLocaleString('vi-VN') + 'đ';
}
