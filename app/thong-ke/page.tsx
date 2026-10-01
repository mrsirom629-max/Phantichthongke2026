'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { XSMN_SCHEDULE } from '../../lib/constants';
import { addDays, cmpDate, computeStats, diffDays, drawsInRange, isValidDate, todayVN } from '../../lib/stats';
import { useMasterdataLoad } from '../../lib/useMasterdataLoad';
import MasterdataPanel from '../../components/MasterdataPanel';
import StoragePanel from '../../components/StoragePanel';
import type { Mien, NumberStat, StatsResult } from '../../lib/types';

const TOP_N = 10;
const MAX_RANGE_DAYS = 365;

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

/** Danh sách tỉnh XSMN duy nhất, sắp xếp theo alphabet tiếng Việt. */
function provinceList(): string[] {
  const set = new Set<string>();
  for (const arr of Object.values(XSMN_SCHEDULE)) {
    for (const p of arr) set.add(p.province);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
}

function displayDate(apiDate: string): string {
  return apiDate.replace(/-/g, '/');
}

function fmtNull(v: string | null): string {
  return v ?? '—';
}

function fmtGap(v: number | null): string {
  return v === null ? '—' : `${v} ngày`;
}

/** Dự phòng khi API không trả hot/cold/gan: tự tính từ freq. */
function deriveList(freq: NumberStat[], mode: 'hot' | 'cold' | 'gan'): NumberStat[] {
  const arr = [...freq];
  if (mode === 'hot') return arr.sort((a, b) => b.count - a.count).slice(0, TOP_N);
  if (mode === 'cold') return arr.sort((a, b) => a.count - b.count).slice(0, TOP_N);
  return arr
    .sort((a, b) => (b.gapDays ?? -1) - (a.gapDays ?? -1))
    .slice(0, TOP_N);
}

function StatTable({ title, rows }: { title: string; rows: NumberStat[] }) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">Không có dữ liệu.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="grid">
            <thead>
              <tr>
                <th>Số</th>
                <th>Số lần</th>
                <th>Lần cuối</th>
                <th>Số ngày vắng</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.number}>
                  <td className="num">{s.number}</td>
                  <td className="num">{s.count}</td>
                  <td>{fmtNull(s.lastSeen ? displayDate(s.lastSeen) : null)}</td>
                  <td>{fmtGap(s.gapDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function StatsPage() {
  const [mien, setMien] = useState<Mien>('nam');
  const provinces = useMemo(
    () => (mien === 'bac' ? ['Miền Bắc'] : provinceList()),
    [mien],
  );
  const [fromDate, setFromDate] = useState(() => addDays(todayVN(), -29));
  const [toDate, setToDate] = useState(() => todayVN());
  const [province, setProvince] = useState<string>('all');
  const [cycle, setCycle] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    loading,
    progress,
    error,
    data: master,
    load,
  } = useMasterdataLoad();
  /**
   * Con trỏ vòng quét: ngày cuối của vòng TIẾP THEO (null = bắt đầu từ hôm nay).
   * Mỗi vòng là một cửa sổ N ngày MỚI lùi về quá khứ, không đè lên vòng cũ.
   * Dùng ref để không làm useEffect chạy lại.
   */
  const windowEndRef = useRef<string | null>(null);

  /**
   * Quét một vòng từ from → to QUA MASTERDATA (kho riêng theo miền).
   * - reset=true: quét đúng khoảng đã chọn (vòng 1).
   * - reset=false: quét vòng tiếp theo lùi về quá khứ (không đè vòng cũ).
   * Chỉ tải những ngày còn thiếu, ghi bổ sung không trùng.
   */
  const loadData = useCallback(
    async (from: string, to: string, reset: boolean, m: Mien) => {
      setFormError(null);
      if (!isValidDate(from) || !isValidDate(to)) {
        setFormError('Ngày chưa hợp lệ. Hãy chọn lại từ ngày / đến ngày.');
        return;
      }
      if (cmpDate(from, to) > 0) {
        setFormError('“Từ ngày” phải trước hoặc bằng “Đến ngày”.');
        return;
      }
      const d = diffDays(from, to) + 1;
      if (d > MAX_RANGE_DAYS) {
        setFormError(`Khoảng tối đa ${MAX_RANGE_DAYS} ngày (đang chọn ${d} ngày). Hãy thu hẹp lại.`);
        return;
      }
      const st = await load(d, to, m);
      if (st) {
        // Vòng sau bắt đầu từ ngày liền trước ngày đầu vòng này
        windowEndRef.current = addDays(st.summary.windowFrom, -1);
        setCycle((c) => (reset ? 1 : c + 1));
      }
    },
    [load],
  );

  useEffect(() => {
    const to = todayVN();
    loadData(addDays(to, -29), to, true, 'nam');
  }, [loadData]);

  /** Đổi miền: reset vòng quét, tải lại từ 30 ngày gần nhất của miền mới. */
  const handleMien = (m: Mien) => {
    if (m === mien || loading) return;
    setMien(m);
    setProvince('all');
    setCycle(0);
    setFormError(null);
    windowEndRef.current = null;
    const to = todayVN();
    const from = addDays(to, -29);
    setFromDate(from);
    setToDate(to);
    loadData(from, to, true, m);
  };

  /** Dữ liệu ngày trong khoảng — lấy từ masterdata (đã sắp xếp tăng dần). */
  const daysData = useMemo(
    () =>
      master
        ? {
            days: master.days,
            live: master.live,
            seed: master.seed,
            total: master.days.length,
            perDay: master.rows.map((r) => ({ date: r.date, source: r.source })),
          }
        : null,
    [master],
  );

  /** Thống kê tính trực tiếp trên dữ liệu vòng quét hiện tại (live + seed). */
  const stats: StatsResult | null = useMemo(() => {
    if (!daysData || !master) return null;
    const draws = drawsInRange(
      daysData.days,
      master.summary.windowFrom,
      master.summary.windowTo,
      province,
    );
    if (draws.length === 0) return null;
    return computeStats(draws, TOP_N, province);
  }, [daysData, master, province]);

  /** Nguồn dữ liệu: live toàn bộ / pha trộn / demo toàn bộ. */
  const source: 'live' | 'mixed' | 'demo' = !daysData
    ? 'demo'
    : daysData.seed === 0
      ? 'live'
      : daysData.live === 0
        ? 'demo'
        : 'mixed';

  const summary = useMemo(() => {
    if (!stats) return null;
    const hit = stats.freq.filter((f) => f.count > 0).length;
    const missed = stats.freq.filter((f) => f.count === 0).length;
    return {
      totalDraws: stats.totalDraws,
      range: `${displayDate(stats.from)} → ${displayDate(stats.to)}`,
      hit,
      missed,
    };
  }, [stats]);

  /** Tập số hot (top tần suất) để tô đậm trên lưới 00–99. */
  const hotSet = useMemo(() => {
    if (!stats) return new Set<string>();
    const ranked = [...stats.freq].sort((a, b) => b.count - a.count);
    const cutoff = ranked[Math.min(TOP_N, ranked.length) - 1]?.count ?? 0;
    return new Set(ranked.filter((f) => f.count >= cutoff && f.count > 0).map((f) => f.number));
  }, [stats]);

  const hot = stats ? (stats.hot.length ? stats.hot : deriveList(stats.freq, 'hot')) : [];
  const cold = stats ? (stats.cold.length ? stats.cold : deriveList(stats.freq, 'cold')) : [];
  const gan = stats ? (stats.gan.length ? stats.gan : deriveList(stats.freq, 'gan')) : [];

  const handleCalc = () => loadData(fromDate, toDate, true, mien);
  const handleNextCycle = () => {
    if (!isValidDate(fromDate) || !isValidDate(toDate) || cmpDate(fromDate, toDate) > 0) {
      setFormError('Hãy chọn khoảng ngày hợp lệ trước.');
      return;
    }
    const d = diffDays(fromDate, toDate) + 1;
    const newTo = addDays(fromDate, -1);
    const newFrom = addDays(newTo, -(d - 1));
    setFromDate(newFrom);
    setToDate(newTo);
    loadData(newFrom, newTo, false, mien);
  };

  const gridRows: string[][] = useMemo(() => {
    const rows: string[][] = [];
    for (let r = 0; r < 10; r++) {
      const row: string[] = [];
      for (let c = 0; c < 10; c++) row.push(String(r * 10 + c).padStart(2, '0'));
      rows.push(row);
    }
    return rows;
  }, []);

  const freqMap = useMemo(() => {
    const m = new Map<string, NumberStat>();
    stats?.freq.forEach((f) => m.set(f.number, f));
    return m;
  }, [stats]);

  return (
    <div>
      <h1>Thống kê lô tô</h1>
      <p className="muted">Tần suất các số 00–99 trong khoảng ngày đã chọn, theo đài hoặc toàn miền Nam. Mỗi vòng là một chu kỳ mới lùi về quá khứ.</p>

      <div className="card">
        <div className="row">
          <div className="field">
            <label>Miền</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['nam', 'bac'] as Mien[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={mien === m ? '' : 'ghost'}
                  onClick={() => handleMien(m)}
                  disabled={loading}
                >
                  {m === 'nam' ? 'Miền Nam' : 'Miền Bắc'}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="fromDate">Từ ngày</label>
            <input
              type="date"
              id="fromDate"
              value={toInputValue(fromDate)}
              max={toInputValue(toDate)}
              onChange={(e) => e.target.value && setFromDate(fromInputValue(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="toDate">Đến ngày</label>
            <input
              type="date"
              id="toDate"
              value={toInputValue(toDate)}
              min={toInputValue(fromDate)}
              max={toInputValue(todayVN())}
              onChange={(e) => e.target.value && setToDate(fromInputValue(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="province">Tỉnh / Đài</label>
            <select id="province" value={province} onChange={(e) => setProvince(e.target.value)}>
              <option value="all">Tất cả</option>
              {provinces.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button type="button" onClick={handleCalc} disabled={loading}>
              {loading ? 'Đang tính...' : 'Tính toán'}
            </button>
          </div>
          {cycle > 0 && (
            <div className="field">
              <label>&nbsp;</label>
              <button type="button" className="ghost" onClick={handleNextCycle} disabled={loading}>
                ⏭ Vòng tiếp theo
              </button>
            </div>
          )}
        </div>
        {formError && (
          <p style={{ color: '#f87171', fontSize: 13, marginBottom: 0 }}>{formError}</p>
        )}
        {cycle > 0 && master && (
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            Vòng quét #{cycle}: {master.summary.rangeFrom} → {master.summary.rangeTo} • Bấm{' '}
            <b>⏭ Vòng tiếp theo</b> để tải tiếp một vòng cũ hơn vào masterdata
            (đẩy lùi liên tục, không ghi đè ngày cũ).
          </p>
        )}
      </div>

      {loading && (
        <div className="card">
          <p className="muted">
            {progress.phase || 'Đang tải'}
            {progress.total > 0 ? `: ${progress.done}/${progress.total} ngày...` : '...'}
          </p>
          <div className="progress">
            <div
              style={{
                width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="card">
          <p>
            <span className="pill bad">Lỗi</span>
          </p>
          <p>{error}</p>
          <button type="button" className="ghost" onClick={handleCalc}>
            Thử lại
          </button>
        </div>
      )}

      {!loading && !error && daysData && !stats && (
        <div className="card">
          <p className="muted">Chưa có dữ liệu cho khoảng này. Hãy thử khoảng khác.</p>
        </div>
      )}

      {!loading && !error && stats && summary && daysData && (
        <div>
          <p>
            <span className={source === 'live' ? 'pill good' : 'pill warn'}>
              {source === 'live' && `Minh Ngọc trực tiếp • ${daysData.live} ngày`}
              {source === 'mixed' &&
                `Trực tiếp ${daysData.live}/${daysData.live + daysData.seed} ngày • ${daysData.seed} ngày mẫu`}
              {source === 'demo' && 'Dữ liệu mẫu (demo)'}
            </span>
          </p>

          {master && (
            <MasterdataPanel rows={master.rows} summary={master.summary} />
          )}

          <StoragePanel refreshKey={master?.summary.totalMaster ?? 0} />

          <div className="grid2">
            <div className="card">
              <div className="muted">Tổng lượt quay</div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{summary.totalDraws}</div>
            </div>
            <div className="card">
              <div className="muted">Khoảng ngày</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{summary.range}</div>
            </div>
            <div className="card">
              <div className="muted">Số lô tô đã về</div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{summary.hit} / 100</div>
            </div>
            <div className="card">
              <div className="muted">Số chưa về lần nào</div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{summary.missed} / 100</div>
            </div>
          </div>

          <h2>Bảng tần suất 00–99</h2>
          <p className="muted">
            Mỗi ô gồm số lô tô và số lần xuất hiện. Số <b style={{ color: 'var(--accent)' }}>tô đậm màu vàng</b> là
            nhóm về nhiều nhất (top {TOP_N}).
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <tbody>
                {gridRows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((n) => {
                      const f = freqMap.get(n);
                      const isHot = hotSet.has(n);
                      return (
                        <td
                          key={n}
                          className="num"
                          style={
                            isHot
                              ? { fontWeight: 800, color: 'var(--accent)' }
                              : undefined
                          }
                        >
                          <div>{n}</div>
                          <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                            {f ? f.count : 0}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Hot — Cold — Gan</h2>
          <div className="grid2">
            <StatTable title={`Về nhiều nhất (top ${TOP_N})`} rows={hot} />
            <StatTable title={`Về ít nhất (top ${TOP_N})`} rows={cold} />
            <StatTable title={`Lâu chưa về — lô gan (top ${TOP_N})`} rows={gan} />
          </div>

          <div className="note">
            Số liệu trên chỉ mang tính <b>thống kê mô tả</b> quá khứ, không có giá trị dự đoán
            kết quả quay thưởng. Nguồn dữ liệu:{' '}
            {source === 'live' && `trực tiếp từ Minh Ngọc (${daysData.live} ngày).`}
            {source === 'mixed' &&
              `trực tiếp từ Minh Ngọc (${daysData.live} ngày) + dữ liệu mẫu (${daysData.seed} ngày, do ngày đó chưa lấy được số thật).`}
            {source === 'demo' && 'dữ liệu mẫu (demo) để phát triển giao diện.'}{' '}
            Xổ số là trò chơi may rủi.
          </div>
        </div>
      )}
    </div>
  );
}
