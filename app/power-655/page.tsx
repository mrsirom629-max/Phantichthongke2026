'use client';

/**
 * Phân hệ Vietlott Power 6/55 — thống kê mô tả & kiểm định nâng cao.
 *
 * NGUYÊN TẮC: các kỳ quay là độc lập ngẫu nhiên — mọi mô hình ở đây chỉ
 * MÔ TẢ và KIỂM ĐỊNH (chi-square, order statistics, PMI, PageRank),
 * không dự đoán. Giải thưởng lớn không làm thay đổi tính ngẫu nhiên.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PowerDraw } from '@/lib/vietlott';
import {
  buildGraph55,
  chiSquareUniformity,
  comboProfile,
  fmtVND,
  freq55,
  hypergeometric,
  orderStats,
  pageRank55,
  pairPMI,
  topEdges55,
} from '@/lib/power655';
import KnowledgeGraph from '@/components/KnowledgeGraph';
import { addDays, cmpDate, diffDays, isValidDate, todayVN } from '@/lib/stats';
import {
  DEFAULT_CONSTRAINTS,
  scoreNumbers55,
  scoreSpread,
  solvePortfolio,
  trainNN55,
  type Portfolio,
} from '@/lib/nnSolver655';
import {
  BASELINE_MEAN_HITS,
  PLAYBOOK_BASELINE,
  aggregateByConfig,
  configSignature,
  entrySource,
  evolutionAdvice,
  loadEvoEntries,
  playbookScores,
  reconcileEntry,
  saveEvoEntries,
  sourceComparison,
  userNumberStats,
  type EvoEntry,
  type SolverConfig,
  type UserNumStat,
} from '@/lib/evolution655';
import type { TrainProgress } from '@/lib/forecastModel';

const VIEW_KEY = 'p65-view-v1';
const MAX_RANGE_DAYS = 365;
const DEFAULT_SPAN = 60; // mặc định 60 ngày (~25 kỳ, đủ cho kiểm định)

/** "DD-MM-YYYY" → "YYYY-MM-DD" cho <input type="date">. */
function toInputValue(dmy: string): string {
  const [d, m, y] = dmy.split('-');
  return `${y}-${m}-${d}`;
}
/** "YYYY-MM-DD" → "DD-MM-YYYY". */
function fromInputValue(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}-${m}-${y}`;
}

function loadSavedRange(): { from: string; to: string } | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { from?: string; to?: string };
    if (
      typeof v.from === 'string' && isValidDate(v.from) &&
      typeof v.to === 'string' && isValidDate(v.to) &&
      cmpDate(v.from, v.to) <= 0
    ) {
      return { from: v.from, to: v.to };
    }
  } catch {
    /* bỏ qua */
  }
  return null;
}

function Ball({ n, bonus = false, size = 30 }: { n: number; bonus?: boolean; size?: number }) {
  return (
    <span
      className="num"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: bonus ? '#dc2626' : '#1d4ed8',
        color: '#fff',
        fontWeight: 800,
        fontSize: size * 0.42,
        margin: 2,
      }}
    >
      {String(n).padStart(2, '0')}
    </span>
  );
}

function displayDate(d: string): string {
  return d.replace(/-/g, '/');
}

/**
 * Phân tích ô nhập bộ số của anh: mỗi dòng 1 vé, 6 số 01–55 cách nhau
 * bởi khoảng trắng/phẩy/chấm phẩy.
 */
function parseUserTickets(text: string): { tickets: number[][]; error: string | null } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { tickets: [], error: 'Anh chưa nhập bộ số nào.' };
  if (lines.length > 10) return { tickets: [], error: 'Tối đa 10 vé (10 dòng).' };
  const tickets: number[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const nums = lines[i].split(/[\s,;]+/).filter(Boolean).map(Number);
    if (
      nums.length !== 6 ||
      nums.some((n) => !Number.isInteger(n) || n < 1 || n > 55) ||
      new Set(nums).size !== 6
    ) {
      return { tickets: [], error: `Dòng ${i + 1}: cần đúng 6 số nguyên phân biệt từ 01–55.` };
    }
    tickets.push(nums.slice().sort((a, b) => a - b));
  }
  return { tickets, error: null };
}

/** Biểu đồ hits TB theo thời gian + đường kỳ vọng ngẫu nhiên. */
function EvoChart({ entries }: { entries: EvoEntry[] }) {  const dkey = (s: string) => s.split('-').reverse().join('');
  const done = entries
    .filter((e) => e.status === 'done' && e.meanHits !== null)
    .sort((a, b) => (dkey(a.targetDate || a.afterDate) < dkey(b.targetDate || b.afterDate) ? -1 : 1));
  if (done.length === 0) return <p className="muted">Chưa có bản ghi nào được đối chiếu.</p>;
  const W = 700, H = 260, pl = 44, pr = 16, pt = 16, pb = 34;
  const means = done.map((e) => e.meanHits!);
  const yMax = Math.max(1.6, ...means, BASELINE_MEAN_HITS) * 1.12;
  const X = (i: number) =>
    done.length === 1 ? pl + (W - pl - pr) / 2 : pl + (i * (W - pl - pr)) / (done.length - 1);
  const Y = (v: number) => pt + (1 - v / yMax) * (H - pt - pb);
  const yb = Y(BASELINE_MEAN_HITS);
  const pts = done.map((e, i) => `${X(i).toFixed(1)},${Y(e.meanHits!).toFixed(1)}`).join(' ');
  const step = Math.max(1, Math.ceil(done.length / 8));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 700, height: 'auto' }}>
      {[0.5, 1.0, 1.5].map((v) => (
        <g key={v}>
          <line x1={pl} y1={Y(v)} x2={W - pr} y2={Y(v)} stroke="var(--border)" strokeWidth={1} />
          <text x={pl - 6} y={Y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{v.toFixed(1)}</text>
        </g>
      ))}
      <line x1={pl} y1={yb} x2={W - pr} y2={yb} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="6 4" />
      <text x={W - pr} y={yb - 6} textAnchor="end" fontSize={12} fill="#f59e0b">
        kỳ vọng ngẫu nhiên {BASELINE_MEAN_HITS.toFixed(2)}
      </text>
      <polyline points={pts} fill="none" stroke="#38bdf8" strokeWidth={2} />
      {done.map((e, i) => (
        <g key={e.id}>
          <circle cx={X(i)} cy={Y(e.meanHits!)} r={4.5} fill={entrySource(e) === 'user' ? '#4ade80' : '#38bdf8'}>
            <title>{`${entrySource(e) === 'user' ? 'Anh' : 'Máy'} · ${e.targetDate || 'kỳ sau ' + e.afterDate}: TB ${e.meanHits!.toFixed(2)}/vé (hits ${e.hits!.join('·')})`}</title>
          </circle>
          {i % step === 0 && (
            <text x={X(i)} y={H - 10} textAnchor="middle" fontSize={11} fill="var(--muted)">
              {(e.targetDate || e.afterDate).slice(0, 5)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export default function Power655Page() {
  const saved = useMemo(loadSavedRange, []);
  const [fromDate, setFromDate] = useState(
    () => saved?.from ?? addDays(todayVN(), -(DEFAULT_SPAN - 1)),
  );
  const [toDate, setToDate] = useState(() => saved?.to ?? todayVN());
  const [draws, setDraws] = useState<PowerDraw[]>([]);
  const [liveCount, setLiveCount] = useState(0);
  const [seedCount, setSeedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [prog, setProg] = useState({ done: 0, total: 0 });
  const [err, setErr] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [selNum, setSelNum] = useState<number | null>(null); // số 1..55 đang chọn
  const [selGraph, setSelGraph] = useState<number | null>(null); // index 0-based
  const busyRef = useRef(false);

  // NN + Solver
  const [nnLookback, setNnLookback] = useState(5);
  const [nnHidden, setNnHidden] = useState(32);
  const [nnEpochs, setNnEpochs] = useState(200);
  const [ticketCount, setTicketCount] = useState(5);
  const [lambda, setLambda] = useState(0.5);
  const [nnPhase, setNnPhase] = useState<'idle' | 'training' | 'solving' | 'done'>('idle');
  const [trainProg, setTrainProg] = useState<TrainProgress>({ epoch: 0, total: 0, loss: 0 });
  const [nnScores, setNnScores] = useState<number[] | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [nnErr, setNnErr] = useState('');

  // Vòng lặp tự tiến hóa
  const [evoEntries, setEvoEntries] = useState<EvoEntry[]>(() => loadEvoEntries());
  const [evoMsg, setEvoMsg] = useState('');
  const [backtestDate, setBacktestDate] = useState('');
  const [evoBusy, setEvoBusy] = useState(false);
  const [evoFilter, setEvoFilter] = useState<'all' | 'user' | 'system'>('all');

  // Sổ tay của anh
  const [userPicks, setUserPicks] = useState('');
  const [userTestDate, setUserTestDate] = useState('');
  const [userMsg, setUserMsg] = useState('');
  const [playbookK, setPlaybookK] = useState(5);
  const [playbookTickets, setPlaybookTickets] = useState<Portfolio | null>(null);

  /**
   * Tải các kỳ trong khoảng from → to: mỗi trang ngày của Minh Ngọc chứa
   * ~10 kỳ, đi lùi từ "to" về "from" và khử trùng theo kỳ vé.
   */
  const loadRange = useCallback(async (from: string, to: string) => {
    if (busyRef.current) return;
    setFormError(null);
    if (!isValidDate(from) || !isValidDate(to)) {
      setFormError('Ngày chưa hợp lệ. Hãy chọn lại từ ngày / đến ngày.');
      return;
    }
    if (cmpDate(from, to) > 0) {
      setFormError('“Từ ngày” phải trước hoặc bằng “Đến ngày”.');
      return;
    }
    const span = diffDays(from, to) + 1;
    if (span > MAX_RANGE_DAYS) {
      setFormError(`Khoảng tối đa ${MAX_RANGE_DAYS} ngày (đang chọn ${span} ngày). Hãy thu hẹp lại.`);
      return;
    }
    busyRef.current = true;
    setLoading(true);
    setErr('');
    const estTotal = Math.max(1, Math.round(span * 3 / 7)); // ước lượng: 3 kỳ/tuần
    setProg({ done: 0, total: estTotal });
    try {
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify({ from, to }));
      } catch {
        /* bỏ qua */
      }
      const inRange = (d: string) => cmpDate(d, from) >= 0 && cmpDate(d, to) <= 0;
      const key = (s: string) => s.split('-').reverse().join('');
      const byKy = new Map<string, PowerDraw>();
      let live = 0;
      let seed = 0;
      let cursor = to;
      let guard = 0;
      while (guard < 60) {
        guard++;
        if (cmpDate(cursor, from) < 0) break;
        const res = await fetch(`/api/vietlott?date=${encodeURIComponent(cursor)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as {
          source?: string;
          draws?: PowerDraw[];
          error?: string;
        };
        if (j.error) throw new Error(j.error);
        const list = Array.isArray(j.draws) ? j.draws : [];
        if (list.length === 0) {
          cursor = addDays(cursor, -10);
          continue;
        }
        for (const d of list) {
          if (!byKy.has(d.ky) && inRange(d.date)) {
            byKy.set(d.ky, d);
            if (j.source === 'minhngoc') live++;
            else seed++;
          }
        }
        setProg({ done: byKy.size, total: estTotal });
        // Dừng khi trang đã chạm mốc cũ hơn "from".
        // Lùi đúng 1 ngày so với kỳ cũ nhất trang này (khử trùng theo kỳ vé
        // nên chồng lấp không sao) — đảm bảo không bỏ sót kỳ nào.
        const pageOldest = list.reduce((a, b) => (key(a.date) < key(b.date) ? a : b)).date;
        if (cmpDate(pageOldest, from) < 0) break;
        const nextCursor = addDays(pageOldest, -1);
        if (nextCursor === cursor) break;
        cursor = nextCursor;
      }
      const all = Array.from(byKy.values()).sort((a, b) =>
        key(a.date) < key(b.date) ? 1 : -1,
      );
      setDraws(all);
      setLiveCount(live);
      setSeedCount(seed);
      if (all.length === 0) {
        setErr('Không tìm thấy kỳ quay nào trong khoảng đã chọn.');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không tải được dữ liệu.');
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, []);

  /** ⏭ Kỳ trước: lùi một khoảng cùng độ dài về quá khứ. */
  const nextCycle = useCallback(() => {
    const span = diffDays(fromDate, toDate) + 1;
    const newTo = addDays(fromDate, -1);
    const newFrom = addDays(newTo, -(span - 1));
    setFromDate(newFrom);
    setToDate(newTo);
    loadRange(newFrom, newTo);
  }, [fromDate, toDate, loadRange]);

  /**
   * Đấu nối NN + Solver:
   *  1. Huấn luyện MLP 55→hidden→55 trên lịch sử các kỳ → điểm số mô tả 55 số.
   *  2. Solver (greedy + local search) chọn K vé tối ưu tổng điểm + độ bao phủ,
   *     dưới ràng buộc tổ hợp.
   */
  const runNNSolver = useCallback(async () => {
    if (draws.length < 20) {
      setNnErr(`Cần ít nhất 20 kỳ dữ liệu (hiện có ${draws.length}). Hãy mở rộng khoảng ngày.`);
      return;
    }
    setNnErr('');
    setPortfolio(null);
    setNnScores(null);
    setNnPhase('training');
    setTrainProg({ epoch: 0, total: nnEpochs, loss: 0 });
    try {
      const mlp = await trainNN55(draws, nnLookback, nnHidden, nnEpochs, setTrainProg);
      const scores = scoreNumbers55(mlp, draws, nnLookback);
      setNnScores(scores);
      setNnPhase('solving');
      // setTimeout để UI kịp vẽ trạng thái "đang giải" trước khi solver chạy
      await new Promise<void>((r) => setTimeout(r, 30));
      const pf = solvePortfolio(scores, ticketCount, lambda, DEFAULT_CONSTRAINTS);
      setPortfolio(pf);
      setNnPhase('done');
    } catch (e) {
      setNnErr(e instanceof Error ? e.message : 'Chạy thất bại, thử lại.');
      setNnPhase('idle');
    }
  }, [draws, nnLookback, nnHidden, nnEpochs, ticketCount, lambda]);

  /* ── Vòng lặp tự tiến hóa ─────────────────────────────── */

  const persistEvo = (list: EvoEntry[]) => {
    setEvoEntries(list);
    saveEvoEntries(list);
  };

  const currentSolverConfig = (): SolverConfig => ({
    lookback: nnLookback,
    hidden: nnHidden,
    epochs: nnEpochs,
    tickets: ticketCount,
    lambda,
  });

  /** Backtest: gợi ý cho 1 ngày quá khứ (chỉ dùng dữ liệu TRƯỚC ngày đó) rồi đối chiếu ngay. */
  const runBacktest = useCallback(async () => {
    if (evoBusy) return;
    setEvoMsg('');
    if (!isValidDate(backtestDate)) {
      setEvoMsg('Chọn ngày backtest hợp lệ.');
      return;
    }
    const key = (s: string) => s.split('-').reverse().join('');
    if (!draws.some((d) => d.date === backtestDate)) {
      setEvoMsg(`Ngày ${backtestDate} không có kỳ quay trong dữ liệu đã tải — hãy chọn một ngày có kỳ quay.`);
      return;
    }
    const before = draws.filter((d) => key(d.date) < key(backtestDate));
    if (before.length < 20) {
      setEvoMsg(`Chỉ có ${before.length} kỳ trước ${backtestDate} — cần ít nhất 20 kỳ. Hãy tải khoảng ngày rộng hơn.`);
      return;
    }
    setEvoBusy(true);
    try {
      const mlp = await trainNN55(before, nnLookback, nnHidden, nnEpochs);
      const scores = scoreNumbers55(mlp, before, nnLookback);
      const pf = solvePortfolio(scores, ticketCount, lambda, DEFAULT_CONSTRAINTS);
      const actual = draws.find((d) => d.date === backtestDate)!;
      const hits = pf.tickets.map(
        (t) => t.numbers.filter((n) => actual.numbers.includes(n)).length,
      );
      const meanHits = hits.reduce((a, b) => a + b, 0) / hits.length;
      const entry: EvoEntry = {
        id: `${Date.now()}`,
        source: 'system',
        targetDate: backtestDate,
        afterDate: '',
        ky: actual.ky,
        config: currentSolverConfig(),
        tickets: pf.tickets.map((t) => t.numbers),
        totalScore: pf.totalScore,
        coverage: pf.coverage,
        createdAt: Date.now(),
        status: 'done',
        actual: actual.numbers.slice(),
        hits,
        meanHits,
      };
      persistEvo([entry, ...evoEntries]);
      setEvoMsg(
        `Backtest ${backtestDate} (kỳ ${actual.ky}): trúng TB ${meanHits.toFixed(2)}/vé — kỳ vọng ngẫu nhiên ${BASELINE_MEAN_HITS.toFixed(2)}.`,
      );
    } catch (e) {
      setEvoMsg(e instanceof Error ? e.message : 'Backtest thất bại.');
    } finally {
      setEvoBusy(false);
    }
  }, [evoBusy, backtestDate, draws, nnLookback, nnHidden, nnEpochs, ticketCount, lambda, evoEntries]);

  /** Lưu gợi ý hiện tại (mục 6) để chờ KQ kỳ tới. */
  const savePending = useCallback(() => {
    if (!portfolio) {
      setEvoMsg('Hãy chạy NN + Solver ở mục 6 trước, rồi lưu gợi ý.');
      return;
    }
    const entry: EvoEntry = {
      id: `${Date.now()}`,
      source: 'system',
      targetDate: '',
      afterDate: todayVN(),
      ky: '',
      config: currentSolverConfig(),
      tickets: portfolio.tickets.map((t) => t.numbers),
      totalScore: portfolio.totalScore,
      coverage: portfolio.coverage,
      createdAt: Date.now(),
      status: 'pending',
      actual: null,
      hits: null,
      meanHits: null,
    };
    persistEvo([entry, ...evoEntries]);
    setEvoMsg('Đã lưu gợi ý — khi có KQ kỳ quay mới, tải khoảng ngày chứa nó rồi bấm "Đối chiếu".');
  }, [portfolio, nnLookback, nnHidden, nnEpochs, ticketCount, lambda, evoEntries]);

  /** Đối chiếu mọi gợi ý đang chờ với dữ liệu đã tải. */
  const reconcileAll = useCallback(() => {
    const list = evoEntries.map((e) => reconcileEntry(e, draws));
    const newly = list.filter((e, i) => e.status === 'done' && evoEntries[i].status === 'pending').length;
    persistEvo(list);
    const stillPending = list.filter((e) => e.status === 'pending').length;
    setEvoMsg(
      newly > 0
        ? `Đã đối chiếu ${newly} gợi ý.` + (stillPending > 0 ? ` Còn ${stillPending} gợi ý chưa có KQ — hãy mở rộng khoảng ngày tải.` : '')
        : 'Chưa đối chiếu được gợi ý nào — hãy tải khoảng ngày chứa các kỳ cần đối chiếu.',
    );
  }, [evoEntries, draws]);

  const deleteEvo = useCallback((id: string) => {
    persistEvo(evoEntries.filter((e) => e.id !== id));
  }, [evoEntries]);

  /* ── Sổ tay của anh: anh chọn số ────────────────────────── */

  const userManualConfig = (n: number): SolverConfig => ({
    lookback: 0, hidden: 0, epochs: 0, tickets: n, lambda: 0,
  });

  /** Lưu bộ số anh nhập để chờ KQ kỳ tới. */
  const saveUserPending = useCallback(() => {
    const { tickets, error } = parseUserTickets(userPicks);
    if (error) {
      setUserMsg(error);
      return;
    }
    const distinct = new Set<number>();
    tickets.forEach((t) => t.forEach((n) => distinct.add(n)));
    const entry: EvoEntry = {
      id: `${Date.now()}`,
      source: 'user',
      targetDate: '',
      afterDate: todayVN(),
      ky: '',
      config: userManualConfig(tickets.length),
      tickets,
      totalScore: 0,
      coverage: distinct.size,
      createdAt: Date.now(),
      status: 'pending',
      actual: null,
      hits: null,
      meanHits: null,
    };
    persistEvo([entry, ...evoEntries]);
    setUserPicks('');
    setUserMsg(`Đã ghi nhận ${tickets.length} vé của anh — chờ KQ kỳ tới, rồi bấm "Đối chiếu" ở mục 7.`);
  }, [userPicks, evoEntries]);

  /** Thử bộ số của anh trên 1 ngày quá khứ → đối chiếu ngay. */
  const testUserOnDate = useCallback(() => {
    const { tickets, error } = parseUserTickets(userPicks);
    if (error) {
      setUserMsg(error);
      return;
    }
    if (!isValidDate(userTestDate)) {
      setUserMsg('Chọn ngày để thử (ngày có kỳ quay trong quá khứ).');
      return;
    }
    const actual = draws.find((d) => d.date === userTestDate);
    if (!actual) {
      setUserMsg(`Ngày ${userTestDate} không có kỳ quay trong dữ liệu đã tải.`);
      return;
    }
    const hits = tickets.map((t) => t.filter((n) => actual.numbers.includes(n)).length);
    const meanHits = hits.reduce((a, b) => a + b, 0) / hits.length;
    const distinct = new Set<number>();
    tickets.forEach((t) => t.forEach((n) => distinct.add(n)));
    const entry: EvoEntry = {
      id: `${Date.now()}`,
      source: 'user',
      targetDate: userTestDate,
      afterDate: '',
      ky: actual.ky,
      config: userManualConfig(tickets.length),
      tickets,
      totalScore: 0,
      coverage: distinct.size,
      createdAt: Date.now(),
      status: 'done',
      actual: actual.numbers.slice(),
      hits,
      meanHits,
    };
    persistEvo([entry, ...evoEntries]);
    setUserMsg(
      `Thử trên ${userTestDate} (kỳ ${actual.ky}, KQ: ${actual.numbers.map((n) => String(n).padStart(2, '0')).join(' ')}): ` +
        `trúng TB ${meanHits.toFixed(2)}/vé — kỳ vọng ngẫu nhiên ${BASELINE_MEAN_HITS.toFixed(2)}.`,
    );
  }, [userPicks, userTestDate, draws, evoEntries]);

  /** Dựng vé từ sổ tay: solver tối ưu trên điểm số "hợp tay" của anh. */
  const buildFromPlaybook = useCallback(() => {
    const stats = userNumberStats(evoEntries);
    if (stats.length === 0) {
      setUserMsg('Sổ tay chưa có dữ liệu đối chiếu — hãy thử/lưu vài bộ số trước.');
      return;
    }
    const scores = playbookScores(stats);
    const pf = solvePortfolio(scores, playbookK, lambda, DEFAULT_CONSTRAINTS);
    setPlaybookTickets(pf);
    setUserMsg(`Đã dựng ${pf.tickets.length} vé từ sổ tay của anh (ưu tiên các số "hợp tay", vẫn giữ ràng buộc tổ hợp).`);
  }, [evoEntries, playbookK, lambda]);

  // Tự chọn ngày backtest mặc định: ngày có ≥20 kỳ đứng trước nó
  useEffect(() => {
    if (!backtestDate && draws.length >= 30) {
      setBacktestDate(draws[draws.length - 21].date);
    }
  }, [draws, backtestDate]);

  // Mở trang: khôi phục khoảng đã lưu rồi tải
  useEffect(() => {
    const r = loadSavedRange() ?? {
      from: addDays(todayVN(), -(DEFAULT_SPAN - 1)),
      to: todayVN(),
    };
    loadRange(r.from, r.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const freq = useMemo(() => (draws.length > 0 ? freq55(draws) : null), [draws]);
  const chi = useMemo(() => (draws.length >= 20 ? chiSquareUniformity(draws) : null), [draws]);
  const ostats = useMemo(() => (draws.length > 0 ? orderStats(draws) : null), [draws]);
  const combos = useMemo(() => (draws.length > 0 ? comboProfile(draws) : null), [draws]);
  const pmis = useMemo(() => (draws.length >= 20 ? pairPMI(draws, 3, 20) : null), [draws]);
  const graph = useMemo(() => {
    if (draws.length < 20) return null;
    const g = buildGraph55(draws);
    return { g, scores: pageRank55(g), edges: topEdges55(g, 160) };
  }, [draws]);

  const maxF = useMemo(
    () => (freq ? Math.max(...freq.main, 1) : 1),
    [freq],
  );

  // Phân phối số lẻ thực tế vs lý thuyết siêu bội
  const oddHist = useMemo(() => {
    if (!combos) return null;
    const emp = new Array(7).fill(0);
    for (const c of combos) emp[c.odd]++;
    return emp.map((count, k) => ({
      k,
      emp: combos.length > 0 ? count / combos.length : 0,
      theory: hypergeometric(k, 28),
    }));
  }, [combos]);

  const numDetail = useMemo(() => {
    if (selNum === null || !freq || !graph) return null;
    const idx = selNum - 1;
    const rank = graph.scores
      .map((s, i) => ({ s, i }))
      .sort((a, b) => b.s - a.s)
      .findIndex((x) => x.i === idx) + 1;
    const co = new Map<number, number>();
    graph.g.adj.get(selNum)?.forEach((w, j) => co.set(j, w));
    const topCo = Array.from(co.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    return { rank, f: freq.main[idx], b: freq.bonus[idx], gap: freq.gap[idx], topCo };
  }, [selNum, freq, graph]);

  return (
    <div>
      <h1>Vietlott Power 6/55</h1>
      <div className="note">
        <b>Thống kê mô tả &amp; kiểm định — không dự đoán.</b> Mỗi kỳ quay 6/55 là
        độc lập ngẫu nhiên; giải Jackpot hàng chục tỷ không làm thay đổi điều đó.
        Các mô hình dưới đây (chi-square, order statistics, PMI, PageRank) dùng để{' '}
        <b>đo tính ngẫu nhiên và khám phá cấu trúc</b>, điểm số không phải xác suất trúng.
      </div>

      <div className="card">
        <div className="row">
          <div className="field">
            <label htmlFor="p65from">Từ ngày</label>
            <input
              type="date"
              id="p65from"
              value={toInputValue(fromDate)}
              max={toInputValue(toDate)}
              onChange={(e) => e.target.value && setFromDate(fromInputValue(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="p65to">Đến ngày</label>
            <input
              type="date"
              id="p65to"
              value={toInputValue(toDate)}
              min={toInputValue(fromDate)}
              max={toInputValue(todayVN())}
              onChange={(e) => e.target.value && setToDate(fromInputValue(e.target.value))}
            />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => loadRange(fromDate, toDate)} disabled={loading}>
                {loading ? 'Đang tải...' : 'Tải dữ liệu'}
              </button>
              <button className="ghost" onClick={nextCycle} disabled={loading}>
                ⏭ Kỳ trước
              </button>
            </div>
          </div>
          {draws.length > 0 && (
            <div className="field">
              <label>&nbsp;</label>
              <span className="muted">
                Đã có <b>{draws.length}</b> kỳ{' '}
                {seedCount === 0 ? (
                  <span className="pill good">{liveCount} kỳ trực tiếp Minh Ngọc</span>
                ) : (
                  <span className="pill warn">
                    {liveCount} trực tiếp • {seedCount} mẫu
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
        {formError && <p style={{ color: '#f87171' }}>{formError}</p>}
        {loading && (
          <div className="progress" style={{ marginTop: 8 }}>
            <div style={{ width: `${prog.total > 0 ? Math.min(100, (prog.done / prog.total) * 100) : 0}%` }} />
          </div>
        )}
        {loading && <p className="muted">Đã tải {prog.done} kỳ trong khoảng...</p>}
        {err && <p style={{ color: '#f87171' }}>{err}</p>}
      </div>

      {draws.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>1. Kết quả các kỳ gần nhất</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead>
                <tr>
                  <th>Kỳ</th>
                  <th>Ngày quay</th>
                  <th>6 số chính</th>
                  <th>Số đặc biệt</th>
                  <th>Jackpot 1</th>
                  <th>Jackpot 2</th>
                </tr>
              </thead>
              <tbody>
                {draws.slice(0, 12).map((d) => (
                  <tr key={d.ky}>
                    <td className="num">#{d.ky}</td>
                    <td>
                      {displayDate(d.date)}
                      <div className="muted" style={{ fontSize: 12 }}>{d.weekday}</div>
                    </td>
                    <td>
                      {d.numbers.map((n) => (
                        <Ball key={n} n={n} size={28} />
                      ))}
                    </td>
                    <td>
                      <Ball n={d.bonus} bonus size={28} />
                    </td>
                    <td className="num" style={{ fontSize: 13 }}>{fmtVND(d.jackpot1)}</td>
                    <td className="num" style={{ fontSize: 13 }}>{fmtVND(d.jackpot2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {freq && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>2. Tần suất 01–55 ({freq.draws} kỳ)</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            Màu càng đậm = về càng nhiều. Nhấp vào một số để xem chi tiết (tần suất,
            số kỳ vắng, số lần làm số đặc biệt).
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {freq.main.map((f, i) => {
              const n = i + 1;
              const t = f / maxF;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setSelNum(selNum === n ? null : n)}
                  title={`Số ${String(n).padStart(2, '0')}: ${f} kỳ`}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 8,
                    border: selNum === n ? '2px solid #fff' : '1px solid var(--border)',
                    background: `rgba(29, 78, 216, ${0.12 + t * 0.75})`,
                    color: '#fff',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  {String(n).padStart(2, '0')}
                  <div style={{ fontSize: 10, fontWeight: 400 }}>{f}</div>
                </button>
              );
            })}
          </div>
          {selNum !== null && numDetail && (
            <table className="grid" style={{ marginTop: 12, maxWidth: 560 }}>
              <tbody>
                <tr>
                  <td>Số đang xem</td>
                  <td className="num"><b>{String(selNum).padStart(2, '0')}</b></td>
                </tr>
                <tr>
                  <td>Hạng PageRank (đồ thị 55 số)</td>
                  <td className="num"><b>{numDetail.rank}/55</b></td>
                </tr>
                <tr>
                  <td>Số kỳ xuất hiện (6 số chính)</td>
                  <td className="num">{numDetail.f}</td>
                </tr>
                <tr>
                  <td>Số kỳ làm số đặc biệt</td>
                  <td className="num">{numDetail.b}</td>
                </tr>
                <tr>
                  <td>Số kỳ vắng gần nhất (gan)</td>
                  <td className="num">{numDetail.gap ?? '—'}</td>
                </tr>
                <tr>
                  <td>Hay về cùng với</td>
                  <td>
                    {numDetail.topCo.map(([j, w]) => (
                      <span key={j} className="num" style={{ marginRight: 10 }} title={`${w} kỳ về cùng`}>
                        <b>{String(j).padStart(2, '0')}</b>
                        <span className="muted"> ×{w}</span>
                      </span>
                    ))}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {chi && ostats && oddHist && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>3. Kiểm định thống kê nâng cao</h3>

          <h4>Kiểm định chi-square tính đồng đều (H0: 55 số về đều nhau)</h4>
          <table className="grid" style={{ maxWidth: 640 }}>
            <tbody>
              <tr>
                <td>χ² quan sát</td>
                <td className="num"><b>{chi.chi2.toFixed(2)}</b></td>
              </tr>
              <tr>
                <td>Bậc tự do</td>
                <td className="num">{chi.df}</td>
              </tr>
              <tr>
                <td>p-value</td>
                <td className="num"><b>{chi.pValue.toFixed(4)}</b></td>
              </tr>
              <tr>
                <td>Tần suất kỳ vọng mỗi số</td>
                <td className="num">{chi.expected.toFixed(1)} kỳ</td>
              </tr>
            </tbody>
          </table>
          <div className="note" style={{ marginTop: 8 }}>
            {chi.verdict === 'uniform' ? (
              <span>
                <b>Kết luận:</b> p-value ≥ 0.05 — <b>không có bằng chứng lệch khỏi đồng đều</b>.
                Đúng như kỳ vọng của các kỳ quay ngẫu nhiên độc lập.
              </span>
            ) : (
              <span>
                <b>Lưu ý:</b> p-value &lt; 0.05 — có dấu hiệu lệch. Hãy thận trọng: với mẫu
                nhỏ, dao động ngẫu nhiên cũng có thể gây ra điều này. Kiểm tra lại khi có
                thêm dữ liệu trực tiếp.
              </span>
            )}
          </div>

          <h4 style={{ marginTop: 16 }}>Order statistics — vị trí sắp xếp so với lý thuyết</h4>
          <p className="muted" style={{ fontSize: 13 }}>
            Với 6 số rút từ 1–55, số nhỏ nhất kỳ vọng ≈ 8, số thứ hai ≈ 16, … số lớn
            nhất ≈ 48 (công thức k×56/7). So sánh trung bình thực tế:
          </p>
          <table className="grid" style={{ maxWidth: 560 }}>
            <thead>
              <tr>
                <th>Vị trí</th>
                <th>Trung bình thực tế</th>
                <th>Lý thuyết</th>
                <th>Chênh lệch</th>
              </tr>
            </thead>
            <tbody>
              {ostats.map((o) => (
                <tr key={o.pos}>
                  <td>Số nhỏ thứ {o.pos}</td>
                  <td className="num">{o.empirical.toFixed(2)}</td>
                  <td className="num">{o.theoretical.toFixed(1)}</td>
                  <td className="num">{(o.empirical - o.theoretical).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 style={{ marginTop: 16 }}>Phân phối số lẻ — thực tế vs siêu bội lý thuyết</h4>
          <p className="muted" style={{ fontSize: 13 }}>
            Trong 55 số có 28 số lẻ. Số lượng số lẻ mỗi kỳ tuân theo phân phối siêu bội
            Hypergeometric(55, 28, 6) — trung bình lý thuyết ≈ 3.05 số lẻ/kỳ.
          </p>
          <table className="grid" style={{ maxWidth: 560 }}>
            <thead>
              <tr>
                <th>Số lẻ/kỳ</th>
                <th>Thực tế</th>
                <th>Lý thuyết</th>
              </tr>
            </thead>
            <tbody>
              {oddHist.map((r) => (
                <tr key={r.k}>
                  <td className="num">{r.k}</td>
                  <td className="num">{(r.emp * 100).toFixed(1)}%</td>
                  <td className="num">{(r.theory * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {combos && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>4. Hồ sơ tổ hợp từng kỳ</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            Chẵn/lẻ, thấp (1–27)/cao (28–55), tổng 6 số (lý thuyết TB ≈ 168), cặp số
            liên tiếp — các chiều phân tích tổ hợp kinh điển của xổ số 6/55.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead>
                <tr>
                  <th>Kỳ</th>
                  <th>Ngày</th>
                  <th>6 số</th>
                  <th>Lẻ</th>
                  <th>Thấp (1–27)</th>
                  <th>Tổng</th>
                  <th>Cặp liên tiếp</th>
                </tr>
              </thead>
              <tbody>
                {combos.slice(0, 15).map((c) => {
                  const d = draws.find((x) => x.ky === c.ky);
                  return (
                    <tr key={c.ky}>
                      <td className="num">#{c.ky}</td>
                      <td>{displayDate(c.date)}</td>
                      <td>{d?.numbers.map((n) => String(n).padStart(2, '0')).join(' ')}</td>
                      <td className="num">{c.odd}/6</td>
                      <td className="num">{c.low}/6</td>
                      <td className="num">{c.sum}</td>
                      <td className="num">{c.consec}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {graph && pmis && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>5. Đồ thị tri thức 55 số (PageRank)</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            Mỗi số 01–55 là một node; hai số cùng xuất hiện trong một kỳ tạo một cạnh.
            PageRank xếp hạng độ "trung tâm" — mô tả cấu trúc đồng xuất hiện, không dự báo.
          </p>
          <div className="row">
            <span className="muted">
              Đồ thị: <b>55</b> node • <b>{graph.edges.length}</b> cạnh tiêu biểu •{' '}
              <b>{graph.g.days}</b> kỳ
            </span>
          </div>
          <div style={{ marginTop: 12, maxWidth: 640 }}>
            <KnowledgeGraph
              scores={graph.scores}
              edges={graph.edges.map((e) => ({ a: e.a - 1, b: e.b - 1, weight: e.weight }))}
              selected={selGraph}
              onSelect={(i) => {
                setSelGraph((cur) => (cur === i ? null : i));
                setSelNum(i + 1);
              }}
              labelOf={(i) => String(i + 1).padStart(2, '0')}
              ariaLabel="Đồ thị tri thức 55 số Power 6/55"
            />
          </div>

          <h4 style={{ marginTop: 16 }}>
            Cặp số có PMI cao nhất (về cùng nhau nhiều hơn độc lập)
          </h4>
          <p className="muted" style={{ fontSize: 13 }}>
            PMI = log(P(a,b) / P(a)P(b)). PMI ≈ 0 nghĩa là độc lập — đúng kỳ vọng của
            quay ngẫu nhiên; các giá trị dương nhỏ thường chỉ là nhiễu mẫu.
          </p>
          <table className="grid" style={{ maxWidth: 560 }}>
            <thead>
              <tr>
                <th>Cặp</th>
                <th>Số kỳ về cùng</th>
                <th>PMI</th>
              </tr>
            </thead>
            <tbody>
              {pmis.map((p) => (
                <tr key={`${p.a}-${p.b}`}>
                  <td className="num">
                    <b>{String(p.a).padStart(2, '0')} – {String(p.b).padStart(2, '0')}</b>
                  </td>
                  <td className="num">{p.co}</td>
                  <td className="num">{p.pmi.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>6. Tối ưu tổ hợp — Mạng nơ-ron + Solver</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          <b>Đấu nối 2 tầng:</b> (1) MLP 55→nơ-ron ẩn→55 học từ lịch sử các kỳ, cho{' '}
          <b>điểm số mô tả</b> từng số 01–55; (2) <b>solver</b> (greedy + local search)
          chọn K vé × 6 số sao cho <b>tổng điểm lớn nhất + độ bao phủ cao nhất</b>,
          dưới ràng buộc: số lẻ {DEFAULT_CONSTRAINTS.oddMin}–{DEFAULT_CONSTRAINTS.oddMax},
          tổng {DEFAULT_CONSTRAINTS.sumMin}–{DEFAULT_CONSTRAINTS.sumMax},
          tối đa {DEFAULT_CONSTRAINTS.consecMax} cặp liên tiếp/vé.
        </p>
        <div className="note">
          <b>Đọc đúng vai trò:</b> NN chỉ học <i>mô tả</i> quá khứ — với quay ngẫu nhiên,
          điểm số kỳ vọng ≈ đều nhau + nhiễu (xem độ lệch chuẩn dưới đây). Solver{' '}
          <b>không làm tăng xác suất trúng</b>; nó giúp giữ kỷ luật tổ hợp, đa dạng hóa
          danh mục vé và tránh dồn vào các số "đông người chọn" (đỡ chia giải <i>nếu</i> trúng).
        </div>
        <div className="row">
          <div className="field">
            <label>Lookback</label>
            <select value={nnLookback} onChange={(e) => setNnLookback(Number(e.target.value))} disabled={nnPhase === 'training'}>
              <option value={3}>3</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
            </select>
          </div>
          <div className="field">
            <label>Nơ-ron ẩn</label>
            <select value={nnHidden} onChange={(e) => setNnHidden(Number(e.target.value))} disabled={nnPhase === 'training'}>
              <option value={16}>16</option>
              <option value={32}>32</option>
              <option value={64}>64</option>
            </select>
          </div>
          <div className="field">
            <label>Epoch</label>
            <select value={nnEpochs} onChange={(e) => setNnEpochs(Number(e.target.value))} disabled={nnPhase === 'training'}>
              <option value={50}>50</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
            </select>
          </div>
          <div className="field">
            <label>Số vé (K)</label>
            <select value={ticketCount} onChange={(e) => setTicketCount(Number(e.target.value))} disabled={nnPhase === 'training' || nnPhase === 'solving'}>
              {[1, 2, 3, 5, 8, 10].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Ưu tiên bao phủ (λ)</label>
            <select value={lambda} onChange={(e) => setLambda(Number(e.target.value))} disabled={nnPhase === 'training' || nnPhase === 'solving'}>
              <option value={0}>0 — chỉ theo điểm NN</option>
              <option value={0.5}>0.5 — cân bằng</option>
              <option value={1}>1 — bao phủ mạnh</option>
            </select>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button onClick={runNNSolver} disabled={nnPhase === 'training' || nnPhase === 'solving' || loading}>
              {nnPhase === 'training'
                ? `NN đang học ${trainProg.epoch}/${trainProg.total}...`
                : nnPhase === 'solving'
                  ? 'Solver đang tối ưu...'
                  : 'Chạy NN + Solver'}
            </button>
          </div>
        </div>
        {nnPhase === 'training' && (
          <div style={{ marginTop: 8 }}>
            <p className="muted">Epoch {trainProg.epoch}/{trainProg.total} — loss: {trainProg.loss.toFixed(4)}</p>
            <div className="progress">
              <div style={{ width: `${trainProg.total > 0 ? (trainProg.epoch / trainProg.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
        {nnErr && <p style={{ color: '#f87171' }}>{nnErr}</p>}

        {nnScores && (
          <div style={{ marginTop: 12 }}>
            <h4>Điểm số NN cho 55 số (top 10)</h4>
            {(() => {
              const sp = scoreSpread(nnScores);
              const top = nnScores
                .map((s, i) => ({ s, n: i + 1 }))
                .sort((a, b) => b.s - a.s)
                .slice(0, 10);
              return (
                <div>
                  <p className="muted" style={{ fontSize: 13 }}>
                    Trung bình {sp.mean.toFixed(3)} • độ lệch chuẩn {sp.std.toFixed(4)} •
                    min {sp.min.toFixed(3)} • max {sp.max.toFixed(3)}
                    {sp.std < 0.02 && (
                      <span> — <b>độ phân tán rất nhỏ: NN gần như không tìm thấy tín hiệu nào</b> (đúng kỳ vọng ngẫu nhiên).</span>
                    )}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {top.map(({ s, n }) => (
                      <span key={n} className="num" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }} title={`Điểm ${s.toFixed(4)}`}>
                        <b>{String(n).padStart(2, '0')}</b> <span className="muted">{s.toFixed(3)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {portfolio && (
          <div style={{ marginTop: 16 }}>
            <h4>Danh mục {portfolio.tickets.length} vé — solver đã tối ưu</h4>
            <p className="muted" style={{ fontSize: 13 }}>
              Tổng điểm {portfolio.totalScore.toFixed(2)} • Bao phủ{' '}
              <b>{portfolio.coverage}/55</b> số phân biệt • λ={portfolio.lambda}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Vé</th>
                    <th>6 số</th>
                    <th>Điểm</th>
                    <th>Lẻ</th>
                    <th>Tổng</th>
                    <th>Liên tiếp</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.tickets.map((t, i) => (
                    <tr key={i}>
                      <td className="num">#{i + 1}</td>
                      <td>{t.numbers.map((n) => <Ball key={n} n={n} size={26} />)}</td>
                      <td className="num">{t.score.toFixed(2)}</td>
                      <td className="num">{t.odd}/6</td>
                      <td className="num">{t.sum}</td>
                      <td className="num">{t.consec}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>7. Vòng lặp tự tiến hóa — gợi ý → đối chiếu → cải tiến</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          Mỗi gợi ý của hệ thống được <b>lưu lại trước giờ quay</b>, sau đó đối chiếu với KQ thật
          (số trúng/vé). Tích lũy càng nhiều, hệ thống càng có cơ sở để <b>cải tiến cấu hình</b>
          (lookback, hidden, epoch, λ) — đó là "tự tiến hóa".
        </p>
        <div className="note">
          <b>Tiệm cận trung thực:</b> vì các kỳ độc lập ngẫu nhiên, hits TB/vé của <i>mọi</i> hệ thống
          đều tiệm cận về kỳ vọng ngẫu nhiên <b>{BASELINE_MEAN_HITS.toFixed(2)}</b> (đường vàng đứt nét).
          "Chính xác nhất" ở đây nghĩa là: hệ thống tự chứng minh giới hạn đó bằng dữ liệu thật,
          đồng thời tối ưu những gì tối ưu được — loss của NN, objective của solver, độ bao phủ vé.
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="btdate">Ngày backtest</label>
            <input
              type="date"
              id="btdate"
              value={backtestDate ? toInputValue(backtestDate) : ''}
              max={toInputValue(todayVN())}
              onChange={(e) => e.target.value && setBacktestDate(fromInputValue(e.target.value))}
            />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={runBacktest} disabled={evoBusy || loading}>
                {evoBusy ? 'Đang backtest...' : 'Backtest: gợi ý → đối chiếu ngay'}
              </button>
              <button className="ghost" onClick={savePending} disabled={!portfolio}>
                Lưu gợi ý hiện tại (chờ kỳ tới)
              </button>
              <button className="ghost" onClick={reconcileAll}>
                Đối chiếu các gợi ý đang chờ
              </button>
            </div>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Backtest dùng <b>cấu hình mục 6</b> và chỉ huấn luyện trên các kỳ <b>trước</b> ngày đã chọn
          (không nhìn trước tương lai). Nhật ký lưu trên trình duyệt này.
        </p>
        {evoMsg && <p>{evoMsg}</p>}

        <h4>Biểu đồ tiến hóa — hits TB/vé theo thời gian</h4>
        <EvoChart entries={evoEntries} />
        <p className="muted" style={{ fontSize: 13 }}>
          <span style={{ color: '#38bdf8' }}>●</span> máy gợi ý &nbsp;
          <span style={{ color: '#4ade80' }}>●</span> anh chọn
        </p>

        {evoEntries.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <h4>Nhật ký gợi ý ({evoEntries.length})</h4>
            <div className="row" style={{ marginBottom: 8 }}>
              {(['all', 'user', 'system'] as const).map((f) => (
                <button
                  key={f}
                  className={evoFilter === f ? '' : 'ghost'}
                  style={{ padding: '4px 12px' }}
                  onClick={() => setEvoFilter(f)}
                >
                  {f === 'all' ? 'Tất cả' : f === 'user' ? '🧑 Của anh' : '🤖 Của máy'}
                </button>
              ))}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Nguồn</th>
                    <th>Ngày/Kỳ</th>
                    <th>Cấu hình</th>
                    <th>Hits từng vé</th>
                    <th>TB/vé</th>
                    <th>vs ngẫu nhiên</th>
                    <th>Bao phủ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {evoEntries
                    .filter((e) => evoFilter === 'all' || entrySource(e) === evoFilter)
                    .map((e) => {
                    const diff = e.meanHits !== null ? e.meanHits - BASELINE_MEAN_HITS : null;
                    const src = entrySource(e);
                    return (
                      <tr key={e.id}>
                        <td className="num" title={src === 'user' ? 'Anh tự chọn số' : 'Máy gợi ý (NN+Solver)'}>
                          {src === 'user' ? '🧑' : '🤖'}
                        </td>
                        <td className="num">
                          {e.status === 'done' ? (
                            <span title={e.actual ? `KQ: ${e.actual.map((n) => String(n).padStart(2, '0')).join(' ')}` : ''}>
                              {e.targetDate || `sau ${e.afterDate}`}{e.ky ? ` (${e.ky})` : ''}
                            </span>
                          ) : (
                            <span className="pill warn">chờ KQ {e.targetDate ? e.targetDate : `sau ${e.afterDate}`}</span>
                          )}
                        </td>
                        <td className="num" style={{ fontSize: 12 }}>{configSignature(e.config)}</td>
                        <td className="num" title={e.tickets.map((t) => t.map((n) => String(n).padStart(2, '0')).join(' ')).join(' | ')}>
                          {e.hits ? e.hits.join('·') : '—'}
                        </td>
                        <td className="num">{e.meanHits !== null ? <b>{e.meanHits.toFixed(2)}</b> : '—'}</td>
                        <td className="num" style={{ color: diff === null ? undefined : diff >= 0 ? '#4ade80' : '#f87171' }}>
                          {diff !== null ? `${diff >= 0 ? '+' : ''}${diff.toFixed(2)}` : '—'}
                        </td>
                        <td className="num">{e.coverage}/55</td>
                        <td className="num">
                          <button className="ghost" style={{ padding: '2px 8px' }} onClick={() => deleteEvo(e.id)}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(() => {
          const aggs = aggregateByConfig(evoEntries.filter((e) => entrySource(e) === 'system'));
          if (aggs.length === 0) return null;
          return (
            <div style={{ marginTop: 12 }}>
              <h4>Bảng xếp hạng cấu hình máy (theo objective)</h4>
              <div style={{ overflowX: 'auto' }}>
                <table className="grid" style={{ maxWidth: 720 }}>
                  <thead>
                    <tr>
                      <th>Cấu hình</th>
                      <th>Số bản ghi</th>
                      <th>Hits TB/vé</th>
                      <th>Bao phủ TB</th>
                      <th>Objective TB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggs.map((a, i) => (
                      <tr key={a.sig} style={i === 0 ? { background: 'rgba(74,222,128,0.08)' } : undefined}>
                        <td className="num">{i === 0 ? '★ ' : ''}{a.sig}</td>
                        <td className="num">{a.n}</td>
                        <td className="num">{a.meanHits !== null ? a.meanHits.toFixed(2) : '—'}</td>
                        <td className="num">{a.meanCoverage.toFixed(1)}</td>
                        <td className="num">{a.meanObjective.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: 13 }}>
                Objective cao nhất ≠ trúng nhiều nhất — objective đo <i>chất lượng tối ưu</i> của solver,
                còn hits đo <i>ngẫu nhiên</i> của kỳ quay.
              </p>
            </div>
          );
        })()}

        {(() => {
          const tips = evolutionAdvice(evoEntries.filter((e) => entrySource(e) === 'system'));
          return (
            <div style={{ marginTop: 12 }}>
              <h4>Hệ thống tự đề xuất cải tiến</h4>
              <ul style={{ fontSize: 14, lineHeight: 1.7 }}>
                {tips.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          );
        })()}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>8. Sổ tay của anh — anh chọn số, hệ thống ghi nhận &amp; so sánh</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          Anh là người chọn cặp số. Hệ thống chỉ làm 3 việc: <b>ghi nhận</b> bộ số của anh,{' '}
          <b>so sánh</b> với KQ thật, và <b>tối ưu sổ tay</b> cho các kỳ tiếp theo.
        </p>
        <div className="field" style={{ maxWidth: 560 }}>
          <label htmlFor="userpicks">Bộ số của anh — mỗi dòng 1 vé: 6 số từ 01–55, cách nhau bởi khoảng trắng hoặc phẩy</label>
          <textarea
            id="userpicks"
            rows={4}
            value={userPicks}
            onChange={(e) => setUserPicks(e.target.value)}
            placeholder={'07 20 25 29 30 45\n03 11 18 27 33 52'}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 15 }}
          />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="usertestdate">Thử trên ngày (quá khứ)</label>
            <input
              type="date"
              id="usertestdate"
              value={userTestDate ? toInputValue(userTestDate) : ''}
              max={toInputValue(todayVN())}
              onChange={(e) => e.target.value && setUserTestDate(fromInputValue(e.target.value))}
            />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={testUserOnDate}>Thử bộ số trên ngày này</button>
              <button className="ghost" onClick={saveUserPending}>Lưu bộ số (chờ kỳ tới)</button>
            </div>
          </div>
        </div>
        {userMsg && <p>{userMsg}</p>}

        {(() => {
          const cmp = sourceComparison(evoEntries);
          const u = cmp.user;
          const s = cmp.system;
          if (u.n === 0 && s.n === 0) return null;
          const diff = u.meanHits !== null && s.meanHits !== null ? u.meanHits - s.meanHits : null;
          return (
            <div style={{ marginTop: 12 }}>
              <h4>Anh vs máy — trúng TB/vé (đã đối chiếu)</h4>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div className="card" style={{ flex: '1 1 200px', margin: 0 }}>
                  <div style={{ fontSize: 15 }}>🧑 Anh tự chọn</div>
                  <div style={{ fontSize: 26, fontWeight: 700 }}>
                    {u.meanHits !== null ? u.meanHits.toFixed(2) : '—'}
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>{u.n} bản ghi · {u.tickets} vé</div>
                </div>
                <div className="card" style={{ flex: '1 1 200px', margin: 0 }}>
                  <div style={{ fontSize: 15 }}>🤖 Máy (NN+Solver)</div>
                  <div style={{ fontSize: 26, fontWeight: 700 }}>
                    {s.meanHits !== null ? s.meanHits.toFixed(2) : '—'}
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>{s.n} bản ghi · {s.tickets} vé</div>
                </div>
              </div>
              {diff !== null && (
                <p style={{ fontSize: 14 }}>
                  {Math.abs(diff) < 0.05
                    ? 'Ngang tài ngang sức — cả hai đều quanh kỳ vọng ngẫu nhiên.'
                    : diff > 0
                      ? `Anh đang hơn máy ${diff.toFixed(2)}/vé.`
                      : `Máy đang hơn anh ${(-diff).toFixed(2)}/vé.`}{' '}
                  <span className="muted">(Kỳ vọng ngẫu nhiên: {BASELINE_MEAN_HITS.toFixed(2)}/vé)</span>
                </p>
              )}
            </div>
          );
        })()}

        {(() => {
          const stats = userNumberStats(evoEntries);
          if (stats.length === 0) {
            return (
              <p className="muted" style={{ fontSize: 13 }}>
                Sổ tay phong độ sẽ hiện ở đây sau vài lần anh thử/lưu và đối chiếu — hệ thống ghi lại
                số nào anh hay chọn và "phong độ" của từng số.
              </p>
            );
          }
          return (
            <div style={{ marginTop: 12 }}>
              <h4>Sổ tay phong độ — các số anh hay chọn</h4>
              <p className="muted" style={{ fontSize: 13 }}>
                "Hợp tay" = tỉ lệ trúng khi anh chọn số đó cao hơn kỳ vọng ngẫu nhiên{' '}
                {(PLAYBOOK_BASELINE * 100).toFixed(1)}% một cách đáng kể. Đây là thống kê mô tả —
                quá khứ không lái được tương lai, nhưng giúp anh thấy thói quen chọn số của mình.
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table className="grid" style={{ maxWidth: 560 }}>
                  <thead>
                    <tr>
                      <th>Số</th>
                      <th>Số kỳ đã chọn</th>
                      <th>Số kỳ trúng</th>
                      <th>Tỉ lệ trúng</th>
                      <th>Đánh giá</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.slice(0, 15).map((st) => {
                      const edge = st.hitRate - PLAYBOOK_BASELINE;
                      return (
                        <tr key={st.n}>
                          <td className="num"><Ball n={st.n} size={26} /></td>
                          <td className="num">{st.picks}</td>
                          <td className="num">{st.hits}</td>
                          <td className="num">{(st.hitRate * 100).toFixed(1)}%</td>
                          <td>
                            {edge > 0.05 ? (
                              <span className="pill good">hợp tay</span>
                            ) : edge < -0.05 ? (
                              <span className="pill warn">lệch tay</span>
                            ) : (
                              <span className="muted">bình thường</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        <div style={{ marginTop: 12 }}>
          <h4>Dựng vé kỳ tới từ sổ tay của anh</h4>
          <p className="muted" style={{ fontSize: 13 }}>
            Solver chạy trên điểm số "hợp tay" rút từ lịch sử chọn số của chính anh —
            vẫn giữ ràng buộc tổ hợp (lẻ 2–4, tổng 100–250, ≤2 cặp liên tiếp).
          </p>
          <div className="row">
            <div className="field">
              <label>Số vé</label>
              <select value={playbookK} onChange={(e) => setPlaybookK(Number(e.target.value))}>
                {[1, 2, 3, 5, 8, 10].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button onClick={buildFromPlaybook}>Dựng vé từ sổ tay</button>
            </div>
          </div>
          {playbookTickets && (
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Vé</th>
                    <th>6 số</th>
                    <th>Lẻ</th>
                    <th>Tổng</th>
                    <th>Liên tiếp</th>
                  </tr>
                </thead>
                <tbody>
                  {playbookTickets.tickets.map((t, i) => (
                    <tr key={i}>
                      <td className="num">#{i + 1}</td>
                      <td>{t.numbers.map((n) => <Ball key={n} n={n} size={26} />)}</td>
                      <td className="num">{t.odd}/6</td>
                      <td className="num">{t.sum}</td>
                      <td className="num">{t.consec}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
