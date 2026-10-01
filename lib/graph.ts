/**
 * Đồ thị tri thức số lô tô (Knowledge Graph) — theo mô hình WeKnora mà người
 * dùng gửi: node là các số 00–99, cạnh là quan hệ "hay về cùng nhau".
 *
 * - buildCooccurrenceGraph: với mỗi ngày, lấy tập lô tô phân biệt trong ngày;
 *   mỗi cặp số cùng xuất hiện được +1 trọng số cạnh (vô hướng).
 * - pageRank: PageRank viết tay trên đồ thị có trọng số — số nào "trung tâm"
 *   (đồng xuất hiện với nhiều số trung tâm khác) thì điểm cao.
 * - Thuật toán thuần túy, chạy được cả client & server, không dependency.
 *
 * TRUNG THỰC: đây chỉ là một cách xếp hạng thống kê trên dữ liệu quá khứ.
 * Các kỳ quay độc lập ngẫu nhiên — đồ thị KHÔNG dự đoán được tương lai.
 */
import type { DayResult } from './types';
import { cmpDate, lotoOf } from './stats';

export interface GraphEdge {
  a: number; // 0..99
  b: number; // 0..99
  weight: number; // số ngày hai số cùng xuất hiện
}

export interface LotoGraph {
  /** Trọng số cạnh kề: adj[i] = Map(j -> weight), vô hướng (đối xứng). */
  adj: Map<number, Map<number, number>>;
  /** Số ngày đã dùng để xây đồ thị. */
  days: number;
  /** Tần suất thô mỗi số (số ngày xuất hiện) — để đối chiếu với PageRank. */
  freq: number[];
}

/** Tập lô tô phân biệt (00–99) của một ngày, dạng số nguyên. */
export function dayLotoSet(day: DayResult): Set<number> {
  const s = new Set<number>();
  for (const p of day.provinces) {
    for (const n of lotoOf(p.prizes)) s.add(parseInt(n, 10));
  }
  return s;
}

/**
 * Xây đồ thị đồng xuất hiện từ danh sách ngày (đã sắp xếp tăng dần).
 * Chỉ dùng các ngày trong tập train — KHÔNG để lọt dữ liệu test/tương lai.
 */
export function buildCooccurrenceGraph(days: DayResult[]): LotoGraph {
  const adj = new Map<number, Map<number, number>>();
  const freq = new Array(100).fill(0);
  const get = (i: number): Map<number, number> => {
    let m = adj.get(i);
    if (!m) {
      m = new Map();
      adj.set(i, m);
    }
    return m;
  };
  for (const day of days) {
    const set = Array.from(dayLotoSet(day));
    for (const n of set) freq[n]++;
    for (let x = 0; x < set.length; x++) {
      for (let y = x + 1; y < set.length; y++) {
        const a = set[x];
        const b = set[y];
        get(a).set(b, (get(a).get(b) ?? 0) + 1);
        get(b).set(a, (get(b).get(a) ?? 0) + 1);
      }
    }
  }
  return { adj, days: days.length, freq };
}

/**
 * PageRank trên đồ thị vô hướng có trọng số.
 * score[i] = (1-d)/N + d * Σ_j (w_ji / out_j * score[j])
 * Node không có cạnh (out=0) phân phối đều cho mọi node (tránh rank sink).
 */
export function pageRank(
  graph: LotoGraph,
  damping = 0.85,
  iters = 60,
): number[] {
  const N = 100;
  const { adj } = graph;
  const outW = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    let s = 0;
    adj.get(i)?.forEach((w) => (s += w));
    outW[i] = s;
  }
  let score = new Array(N).fill(1 / N);
  const base = (1 - damping) / N;
  for (let it = 0; it < iters; it++) {
    const next = new Array(N).fill(base);
    let dangling = 0;
    for (let j = 0; j < N; j++) {
      if (outW[j] === 0) {
        dangling += score[j];
        continue;
      }
      const contrib = (damping * score[j]) / outW[j];
      adj.get(j)?.forEach((w, i) => {
        next[i] += contrib * w;
      });
    }
    const dShare = (damping * dangling) / N;
    for (let i = 0; i < N; i++) next[i] += dShare;
    score = next;
  }
  return score;
}

/** Top-k số theo điểm PageRank (trả về "00".."99"). */
export function graphTopK(days: DayResult[], k: number): string[] {
  const g = buildCooccurrenceGraph(days);
  const scores = pageRank(g);
  return topKByScore(scores, k).map((n) => String(n).padStart(2, '0'));
}

/** Chỉ số của k phần tử điểm cao nhất (ổn định: hòa điểm thì số nhỏ trước). */
export function topKByScore(scores: number[], k: number): number[] {
  return scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, k)
    .map((x) => x.i);
}

/** Danh sách cạnh sắp xếp theo trọng số giảm dần (để vẽ đồ thị). */
export function topEdges(graph: LotoGraph, limit: number): GraphEdge[] {
  const edges: GraphEdge[] = [];
  graph.adj.forEach((m, a) => {
    m.forEach((w, b) => {
      if (b > a) edges.push({ a, b, weight: w });
    });
  });
  edges.sort((x, y) => y.weight - x.weight);
  return edges.slice(0, limit);
}

/** Top-n "hàng xóm" đồng xuất hiện nhiều nhất với một số. */
export function topNeighbors(
  graph: LotoGraph,
  node: number,
  n: number,
): { num: number; weight: number }[] {
  const m = graph.adj.get(node);
  if (!m) return [];
  return Array.from(m.entries())
    .map(([num, weight]) => ({ num, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n);
}

/** Số ngày vắng mặt (gan) của một số tính đến cuối danh sách ngày. */
export function gapDaysOf(days: DayResult[], node: number): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    if (dayLotoSet(days[i]).has(node)) return days.length - 1 - i;
  }
  return null;
}

export interface GraphEval {
  graph: { p: number; r: number; n: number };
  freq: { p: number; r: number; n: number };
  randPrecision: number; // kỳ vọng lý thuyết của đoán ngẫu nhiên
  testDays: number;
  trainDays: number;
}

/**
 * Đánh giá mô hình đồ thị đúng kỷ luật thời gian của lab:
 * - Chia ngày theo thời gian 70/30 (khớp cách splitChrono của MLP: cùng tập
 *   ngày test, test day = ngày Y của các window test).
 * - Đồ thị CHỈ xây trên ngày train — không nhìn thấy tương lai.
 * - Baseline tần suất: top-k theo tần suất ngày train, chấm trên cùng tập test.
 */
export function evaluateGraph(days: DayResult[], lookback: number, k: number): GraphEval {
  const sorted = days.slice().sort((a, b) => cmpDate(a.date, b.date));
  const nSamples = sorted.length - lookback;
  const empty = { p: 0, r: 0, n: 0 };
  if (nSamples < 2) return { graph: empty, freq: empty, randPrecision: 0, testDays: 0, trainDays: 0 };
  const nTest = Math.max(1, Math.floor(nSamples * 0.3));
  const nTrain = nSamples - nTest;
  const trainDays = sorted.slice(0, lookback + nTrain);
  const testDays = sorted.slice(lookback + nTrain);

  const graph = buildCooccurrenceGraph(trainDays);
  const scores = pageRank(graph);
  const graphPred = new Set(topKByScore(scores, k));
  const freqPred = new Set(
    topKByScore(graph.freq, k),
  );

  const scoreSet = (pred: Set<number>) => {
    let pSum = 0;
    let rSum = 0;
    let n = 0;
    let truthSum = 0;
    for (const day of testDays) {
      const truth = dayLotoSet(day);
      if (truth.size === 0) continue;
      let hit = 0;
      truth.forEach((t) => {
        if (pred.has(t)) hit++;
      });
      pSum += hit / k;
      rSum += hit / truth.size;
      truthSum += truth.size;
      n++;
    }
    return { p: n ? pSum / n : 0, r: n ? rSum / n : 0, n, avgTruth: n ? truthSum / n : 0 };
  };

  const g = scoreSet(graphPred);
  const f = scoreSet(freqPred);
  return {
    graph: { p: g.p, r: g.r, n: g.n },
    freq: { p: f.p, r: f.r, n: f.n },
    randPrecision: g.avgTruth / 100,
    testDays: testDays.length,
    trainDays: trainDays.length,
  };
}
