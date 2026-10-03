/**
 * Lab mạng nơ-ron — MLP viết tay từ đầu, không dùng thư viện ngoài.
 * Mục đích: THỰC HÀNH kỹ thuật (khởi tạo, lan truyền xuôi/ngược, SGD, BCE),
 * KHÔNG phải để dự đoán xổ số (các kỳ quay là ngẫu nhiên độc lập).
 */
import type { DayResult } from './types';
import { analysisProvinces } from './stats';

/** PRNG mulberry32 — tái lập được từ seed, dùng cho khởi tạo trọng số. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2 chữ số cuối của một giải (lô tô). "028" -> 28, "07" -> 7. */
function last2(s: string): number {
  const n = parseInt(s.trim().slice(-2), 10);
  return Number.isNaN(n) ? -1 : n;
}

/** Trích mọi số lô tô (00–99) trong một ngày: 2 tỉnh đầu tiên, 2 chữ số cuối mỗi giải. */
export function lotoOfDay(day: DayResult): number[] {
  const out: number[] = [];
  for (const p of analysisProvinces(day)) {
    const ps = p.prizes;
    const groups: string[][] = [
      ps.db, ps.nhat, ps.nhi, ps.ba, ps.tu, ps.nam, ps.sau, ps.bay, ps.tam,
    ];
    for (const g of groups) {
      for (const s of g) {
        const n = last2(s);
        if (n >= 0) out.push(n);
      }
    }
  }
  return out;
}

/** "DD-MM-YYYY" -> số YYYYMMDD để sắp xếp thời gian. */
function dateKey(d: string): number {
  const [dd, mm, yyyy] = d.split('-').map(Number);
  return yyyy * 10000 + mm * 100 + dd;
}

/**
 * Mạng perceptron nhiều tầng (MLP): sigmoid mọi tầng, khởi tạo Xavier,
 * hàm mất mát BCE, tối ưu SGD theo batch đầy đủ.
 */
export class MLP {
  private sizes: number[];
  /** W[l]: ma trận (sizes[l+1] x sizes[l]) — tầng l -> l+1 */
  private W: number[][][];
  /** b[l]: vector bias của tầng l+1 */
  private b: number[][];

  constructor(layers: number[], seed: number) {
    if (layers.length < 2) throw new Error('MLP cần ít nhất 2 tầng (input, output).');
    this.sizes = layers.slice();
    const rand = mulberry32(seed);
    this.W = [];
    this.b = [];
    for (let l = 0; l < layers.length - 1; l++) {
      const fanIn = layers[l];
      const fanOut = layers[l + 1];
      const limit = Math.sqrt(6 / (fanIn + fanOut)); // Xavier uniform
      const wl: number[][] = [];
      for (let i = 0; i < fanOut; i++) {
        const row: number[] = [];
        for (let j = 0; j < fanIn; j++) row.push((rand() * 2 - 1) * limit);
        wl.push(row);
      }
      this.W.push(wl);
      this.b.push(new Array(fanOut).fill(0));
    }
  }

  private static sigmoid(z: number): number {
    if (z < -30) return 0; // ổn định số học
    if (z > 30) return 1;
    return 1 / (1 + Math.exp(-z));
  }

  /** Lan truyền xuôi, trả về đầu ra tầng cuối. */
  forward(x: number[]): number[] {
    let a = x.slice();
    for (let l = 0; l < this.W.length; l++) {
      const next: number[] = [];
      for (let i = 0; i < this.W[l].length; i++) {
        let z = this.b[l][i];
        const row = this.W[l][i];
        for (let j = 0; j < row.length; j++) z += row[j] * a[j];
        next.push(MLP.sigmoid(z));
      }
      a = next;
    }
    return a;
  }

  /** BCE trung bình trên các đầu ra của một mẫu. */
  private static bce(out: number[], y: number[]): number {
    const eps = 1e-12;
    let sum = 0;
    for (let i = 0; i < out.length; i++) {
      const p = Math.min(1 - eps, Math.max(eps, out[i]));
      sum += -(y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p));
    }
    return sum / out.length;
  }

  /**
   * Huấn luyện SGD full-batch.
   * onEpoch(epoch, loss) gọi sau mỗi epoch — trang lab dùng để vẽ loss curve
   * và chia nhỏ quá trình train (không đơ UI).
   */
  fit(
    X: number[][],
    Y: number[][],
    epochs: number,
    lr: number,
    onEpoch?: (epoch: number, loss: number) => void,
  ): void {
    const n = X.length;
    if (n === 0 || epochs <= 0) return;
    for (let ep = 0; ep < epochs; ep++) {
      let lossSum = 0;
      for (let s = 0; s < n; s++) {
        // --- forward, lưu activation mỗi tầng để dùng cho backprop ---
        const acts: number[][] = [X[s].slice()];
        for (let l = 0; l < this.W.length; l++) {
          const prev = acts[l];
          const cur: number[] = [];
          for (let i = 0; i < this.W[l].length; i++) {
            let z = this.b[l][i];
            const row = this.W[l][i];
            for (let j = 0; j < row.length; j++) z += row[j] * prev[j];
            cur.push(MLP.sigmoid(z));
          }
          acts.push(cur);
        }
        const out = acts[acts.length - 1];
        const y = Y[s];
        lossSum += MLP.bce(out, y);
        // --- backward: BCE + sigmoid ở tầng cuối -> dz = (a - y) / m ---
        const m = out.length;
        let dz: number[] = out.map((a, i) => (a - y[i]) / m);
        for (let l = this.W.length - 1; l >= 0; l--) {
          const prev = acts[l];
          // lan truyền lỗi về tầng trước TRƯỚC khi cập nhật W (dùng W hiện tại)
          let dzPrev: number[] | null = null;
          if (l > 0) {
            const da: number[] = new Array(prev.length).fill(0);
            for (let i = 0; i < this.W[l].length; i++) {
              for (let j = 0; j < prev.length; j++) da[j] += this.W[l][i][j] * dz[i];
            }
            const aPrev = acts[l]; // đã qua sigmoid -> đạo hàm a*(1-a)
            dzPrev = da.map((d, j) => d * aPrev[j] * (1 - aPrev[j]));
          }
          // cập nhật W, b của tầng l
          for (let i = 0; i < this.W[l].length; i++) {
            for (let j = 0; j < prev.length; j++) {
              this.W[l][i][j] -= lr * dz[i] * prev[j];
            }
            this.b[l][i] -= lr * dz[i];
          }
          if (dzPrev) dz = dzPrev;
        }
      }
      if (onEpoch) onEpoch(ep, lossSum / n);
    }
  }
}

export interface Dataset {
  X: number[][];
  Y: number[][];
}

/**
 * Dựng dataset từ kết quả các ngày.
 * - Sắp xếp ngày tăng dần theo thời gian.
 * - Feature: vector 100 chiều = tần suất tương đối (0–1) của các số 00–99
 *   trong `lookback` kỳ quay gần nhất (dùng 2 chữ số cuối mọi giải).
 * - Label: vector 100 chiều multi-hot = các số lô tô xuất hiện ở kỳ TIẾP THEO.
 * - Mỗi mẫu chỉ dùng các kỳ quá khứ -> KHÔNG leakage; giữ thứ tự thời gian
 *   (không shuffle ngẫu nhiên toàn cục).
 */
export function buildDataset(days: DayResult[], lookback: number): Dataset {
  const sorted = days.slice().sort((a, b) => dateKey(a.date) - dateKey(b.date));
  const lotos = sorted.map(lotoOfDay);
  const X: number[][] = [];
  const Y: number[][] = [];
  for (let i = lookback; i < sorted.length; i++) {
    const counts = new Array(100).fill(0);
    let total = 0;
    for (let j = i - lookback; j < i; j++) {
      for (const n of lotos[j]) {
        counts[n]++;
        total++;
      }
    }
    X.push(counts.map((c) => (total > 0 ? c / total : 0)));
    const y = new Array(100).fill(0);
    for (const n of lotos[i]) y[n] = 1;
    Y.push(y);
  }
  return { X, Y };
}

export interface Split {
  Xtr: number[][];
  Ytr: number[][];
  Xte: number[][];
  Yte: number[][];
}

/** Chia theo thời gian: train = quá khứ, test = tương lai (không shuffle). */
export function splitChrono(X: number[][], Y: number[][], testRatio = 0.3): Split {
  const n = X.length;
  const nTest = Math.max(1, Math.floor(n * testRatio));
  const nTrain = Math.max(1, n - nTest);
  return {
    Xtr: X.slice(0, nTrain),
    Ytr: Y.slice(0, nTrain),
    Xte: X.slice(nTrain),
    Yte: Y.slice(nTrain),
  };
}

/** Chỉ số của k giá trị lớn nhất (sắp xếp giảm dần theo giá trị). */
export function topK(v: number[], k: number): number[] {
  return v
    .map((val, idx) => ({ val, idx }))
    .sort((a, b) => b.val - a.val)
    .slice(0, Math.min(k, v.length))
    .map((o) => o.idx);
}
