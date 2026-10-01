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
    </div>
  );
}
