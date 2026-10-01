'use client';

import { useEffect, useRef, useState } from 'react';
import { MLP, buildDataset, mulberry32, splitChrono, topK } from '@/lib/nn';
import { PRIZE_COUNTS, PRIZE_DIGITS } from '@/lib/constants';
import type { DayResult, PrizeSet } from '@/lib/types';

const LR = 0.5; // learning rate SGD
const CHUNK_EPOCHS = 10; // số epoch mỗi nhịp setInterval -> không đơ UI
const MIN_DAYS = 20; // ngưỡng dữ liệu tối thiểu

const PRIZE_KEYS: (keyof PrizeSet)[] = [
  'db', 'nhat', 'nhi', 'ba', 'tu', 'sau', 'bay', 'tam',
];

interface Score {
  p: number; // precision@k trung bình
  r: number; // recall@k trung bình
  n: number; // số kỳ test đã đánh giá
}

interface EvalResult {
  mlp: Score;
  rand: Score;
  freq: Score;
}

type Phase = 'idle' | 'loading' | 'ready' | 'training' | 'done';

/** Chuỗi số ngẫu nhiên có độ dài digits. */
function rndStr(rng: () => number, digits: number): string {
  let s = '';
  for (let i = 0; i < digits; i++) s += Math.floor(rng() * 10);
  return s;
}

/**
 * Sinh dữ liệu demo NGẪU NHIÊN (không phải kết quả thật) để thử nghiệm lab
 * khi chưa có seed. Càng minh họa rõ: dữ liệu ngẫu nhiên thì không học được gì.
 */
function genDemoDays(n: number): DayResult[] {
  const rng = mulberry32(20261001);
  const weekdays = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const d = new Date(2026, 6, 1);
  const days: DayResult[] = [];
  for (let i = 0; i < n; i++) {
    const prizes = {} as PrizeSet;
    for (const key of PRIZE_KEYS) {
      const arr: string[] = [];
      for (let c = 0; c < PRIZE_COUNTS[key]; c++) arr.push(rndStr(rng, PRIZE_DIGITS[key]));
      (prizes as unknown as Record<string, string[]>)[key] = arr;
    }
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    days.push({
      date: `${dd}-${mm}-${d.getFullYear()}`,
      weekday: weekdays[d.getDay()],
      mien: 'nam',
      provinces: [{ province: 'Demo', code: 'DEMO', prizes }],
    });
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/** Chọn k số phân biệt ngẫu nhiên (baseline ngẫu nhiên, seed cố định). */
function randomK(rng: () => number, k: number): number[] {
  const pool: number[] = Array.from({ length: 100 }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < k && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    const v = pool.splice(idx, 1)[0];
    out.push(v);
  }
  return out;
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** Đường cong loss vẽ bằng SVG đơn giản. */
function LossCurve({ losses }: { losses: number[] }) {
  if (losses.length < 2) return null;
  const W = 320;
  const H = 110;
  const P = 8;
  const max = Math.max(...losses);
  const min = Math.min(...losses);
  const span = max - min || 1;
  const step = (W - P * 2) / (losses.length - 1);
  const pts = losses
    .map((l, i) => {
      const x = P + i * step;
      const y = H - P - ((l - min) / span) * (H - P * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 130 }}>
      <polyline points={pts} fill="none" stroke="#fbbf24" strokeWidth={2} />
    </svg>
  );
}

export default function LabPage() {
  const [lookback, setLookback] = useState(5);
  const [hidden, setHidden] = useState(32);
  const [epochs, setEpochs] = useState(200);
  const [k, setK] = useState(10);
  const [days, setDays] = useState<DayResult[] | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [prog, setProg] = useState({ epoch: 0, total: 0, loss: 0 });
  const [losses, setLosses] = useState<number[]>([]);
  const [results, setResults] = useState<EvalResult | null>(null);
  const [counts, setCounts] = useState({ train: 0, test: 0 });
  const [err, setErr] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Dọn interval khi unmount -> không rò rỉ timer
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const loadDays = async () => {
    setPhase('loading');
    setErr('');
    setResults(null);
    setIsDemo(false);
    try {
      const res = await fetch('/api/days');
      const data = (await res.json()) as DayResult[];
      setDays(data);
      setPhase('ready');
    } catch {
      setErr('Không tải được dữ liệu. Hãy kiểm tra lại rồi thử lại.');
      setPhase('idle');
    }
  };

  const useDemo = () => {
    setDays(genDemoDays(90));
    setIsDemo(true);
    setErr('');
    setResults(null);
    setPhase('ready');
  };

  const notEnoughData = days !== null && days.length < MIN_DAYS;
  const canTrain = phase === 'ready' && !notEnoughData;

  const train = () => {
    if (!days || days.length < MIN_DAYS) return;
    const ds = buildDataset(days, lookback);
    if (ds.X.length < 10) {
      setErr(`Không đủ mẫu huấn luyện (chỉ tạo được ${ds.X.length} mẫu). Hãy giảm lookback hoặc thêm dữ liệu.`);
      return;
    }
    const { Xtr, Ytr, Xte, Yte } = splitChrono(ds.X, ds.Y, 0.3);
    setCounts({ train: Xtr.length, test: Xte.length });
    setErr('');
    setResults(null);

    const mlp = new MLP([100, hidden, 100], 42);
    const lossHist: number[] = [];
    let epoch = 0;
    setPhase('training');
    setProg({ epoch: 0, total: epochs, loss: 0 });

    // Huấn luyện theo từng chunk nhỏ -> UI không bị đơ
    timerRef.current = setInterval(() => {
      const step = Math.min(CHUNK_EPOCHS, epochs - epoch);
      mlp.fit(Xtr, Ytr, step, LR, (_e, loss) => {
        lossHist.push(loss);
      });
      epoch += step;
      setProg({ epoch, total: epochs, loss: lossHist[lossHist.length - 1] ?? 0 });
      setLosses(lossHist.slice());
      if (epoch >= epochs) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        evaluate(mlp, Xtr, Xte, Yte);
      }
    }, 0);
  };

  /** Đánh giá trên tập test: MLP vs baseline ngẫu nhiên vs baseline tần suất. */
  const evaluate = (mlp: MLP, Xtr: number[][], Xte: number[][], Yte: number[][]) => {
    // Baseline tần suất: k số hay về nhất trong phần train
    const colSum = new Array(100).fill(0);
    for (const row of Xtr) for (let j = 0; j < 100; j++) colSum[j] += row[j];
    const freqTop = topK(colSum, k);
    const rng = mulberry32(7); // seed cố định -> baseline ngẫu nhiên tái lập được

    const score = (predFn: (x: number[]) => number[]): Score => {
      let pSum = 0;
      let rSum = 0;
      let n = 0;
      for (let i = 0; i < Xte.length; i++) {
        const pred = new Set(predFn(Xte[i]));
        const truth: number[] = [];
        for (let j = 0; j < 100; j++) if (Yte[i][j] === 1) truth.push(j);
        if (truth.length === 0) continue;
        let hit = 0;
        for (const t of truth) if (pred.has(t)) hit++;
        pSum += hit / k;
        rSum += hit / truth.length;
        n++;
      }
      return { p: n > 0 ? pSum / n : 0, r: n > 0 ? rSum / n : 0, n };
    };

    setResults({
      mlp: score((x) => topK(mlp.forward(x), k)),
      rand: score(() => randomK(rng, k)),
      freq: score(() => freqTop),
    });
    setPhase('done');
  };

  const showHonestNote =
    results !== null && results.mlp.p <= results.freq.p + 1e-9;

  return (
    <div>
      <h1>Lab thực hành mạng nơ-ron</h1>

      <div className="note">
        <b>Lab thực hành kỹ thuật mạng nơ-ron.</b> Xổ số là các kỳ quay ngẫu nhiên
        độc lập — <b>KHÔNG có mô hình nào dự đoán được kết quả</b>. Lab này để học
        cách xây MLP từ đầu, chia train/test theo thời gian và <b>SO SÁNH VỚI
        BASELINE</b>, đúng nguyên tắc đánh giá trong học máy.
      </div>

      <div className="card">
        <h3>1. Dữ liệu</h3>
        <div className="row">
          <button className="ghost" onClick={loadDays} disabled={phase === 'loading' || phase === 'training'}>
            {phase === 'loading' ? 'Đang tải...' : 'Tải dữ liệu thật'}
          </button>
          {days && (
            <span className="muted">
              Đã có <b>{days.length}</b> ngày {isDemo && <span className="pill warn">dữ liệu demo ngẫu nhiên</span>}
            </span>
          )}
        </div>
        {notEnoughData && (
          <div className="note" style={{ marginTop: 12 }}>
            Dữ liệu chưa đủ để thực hành (cần ít nhất {MIN_DAYS} ngày, hiện có{' '}
            {days!.length} ngày). Hãy chạy seed thêm dữ liệu, hoặc dùng dữ liệu
            demo ngẫu nhiên để thử nghiệm kỹ thuật:
            <div style={{ marginTop: 8 }}>
              <button className="ghost" onClick={useDemo}>
                Dùng dữ liệu demo (ngẫu nhiên)
              </button>
            </div>
          </div>
        )}
        {err && <p style={{ color: '#f87171' }}>{err}</p>}
      </div>

      <div className="card">
        <h3>2. Cấu hình mô hình</h3>
        <div className="row">
          <div className="field">
            <label>Lookback (số kỳ quá khứ)</label>
            <select value={lookback} onChange={(e) => setLookback(Number(e.target.value))} disabled={phase === 'training'}>
              <option value={3}>3</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
            </select>
          </div>
          <div className="field">
            <label>Số nơ-ron tầng ẩn</label>
            <select value={hidden} onChange={(e) => setHidden(Number(e.target.value))} disabled={phase === 'training'}>
              <option value={16}>16</option>
              <option value={32}>32</option>
              <option value={64}>64</option>
            </select>
          </div>
          <div className="field">
            <label>Số epoch</label>
            <select value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} disabled={phase === 'training'}>
              <option value={50}>50</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
            </select>
          </div>
          <div className="field">
            <label>k (số dự đoán mỗi kỳ)</label>
            <select value={k} onChange={(e) => setK(Number(e.target.value))} disabled={phase === 'training'}>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
            </select>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Kiến trúc: MLP 100 → {hidden} → 100 (sigmoid, khởi tạo Xavier, BCE loss, SGD).
          Chia train/test theo thời gian: 70% quá khứ / 30% tương lai.
        </p>
        <button onClick={train} disabled={!canTrain}>
          {phase === 'training' ? 'Đang huấn luyện...' : 'Huấn luyện'}
        </button>
      </div>

      {phase === 'training' && (
        <div className="card">
          <h3>3. Huấn luyện</h3>
          <p className="muted">
            Epoch {prog.epoch}/{prog.total} — loss: {prog.loss.toFixed(4)}
          </p>
          <div className="progress">
            <div style={{ width: `${prog.total > 0 ? (prog.epoch / prog.total) * 100 : 0}%` }} />
          </div>
          <h3>Đường cong loss</h3>
          <LossCurve losses={losses} />
        </div>
      )}

      {phase === 'done' && results && (
        <div className="card">
          <h3>4. Đánh giá trên tập test ({counts.test} kỳ, train {counts.train} kỳ)</h3>
          <table className="grid">
            <thead>
              <tr>
                <th>Mô hình</th>
                <th>Precision@{k}</th>
                <th>Recall@{k}</th>
                <th>Số kỳ test</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><b>MLP (mạng nơ-ron)</b></td>
                <td className="num">{pct(results.mlp.p)}</td>
                <td className="num">{pct(results.mlp.r)}</td>
                <td className="num">{results.mlp.n}</td>
              </tr>
              <tr>
                <td>Baseline tần suất (k số hay về nhất ở train)</td>
                <td className="num">{pct(results.freq.p)}</td>
                <td className="num">{pct(results.freq.r)}</td>
                <td className="num">{results.freq.n}</td>
              </tr>
              <tr>
                <td>Baseline ngẫu nhiên</td>
                <td className="num">{pct(results.rand.p)}</td>
                <td className="num">{pct(results.rand.r)}</td>
                <td className="num">{results.rand.n}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 13 }}>
            precision@{k} = số trúng / {k}; recall@{k} = số trúng / số lô tô thật của kỳ.
            Mô hình tốt phải vượt <b>cả hai</b> baseline trên tập test.
          </p>
          {showHonestNote && (
            <div className="note">
              <b>Kết luận:</b> mô hình MLP không vượt được baseline tần suất —{' '}
              <b>đúng như kỳ vọng lý thuyết</b>. Các kỳ quay là độc lập ngẫu nhiên,
              quá khứ không chứa tín hiệu nào để dự đoán tương lai. Giá trị của lab
              này là thực hành kỹ thuật (xây MLP, chia train/test, so sánh baseline),
              không phải để tìm cách dự đoán xổ số.
            </div>
          )}
          {!showHonestNote && (
            <div className="note">
              MLP lần này vượt baseline tần suất trên tập test — hãy thận trọng: với
              dữ liệu ngẫu nhiên độc lập, chênh lệch nhỏ thường chỉ là dao động ngẫu
              nhiên của mẫu test nhỏ. Thử tăng dữ liệu hoặc chạy lại nhiều lần để
              kiểm chứng.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
