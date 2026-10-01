'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { XSMN_SCHEDULE } from '../../lib/constants';
import { addDays, computeStats, drawsInRange, todayVN } from '../../lib/stats';
import { useMasterdataLoad } from '../../lib/useMasterdataLoad';
import MasterdataPanel from '../../components/MasterdataPanel';
import type { NumberStat, StatsResult } from '../../lib/types';

const DAY_OPTIONS = [7, 14, 30, 60, 90];
const TOP_N = 10;

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
  const provinces = useMemo(provinceList, []);
  const [days, setDays] = useState<number>(30);
  const [province, setProvince] = useState<string>('all');
  const {
    loading,
    progress,
    error,
    data: master,
    load,
  } = useMasterdataLoad();

  /**
   * Tải N ngày gần nhất QUA MASTERDATA: đọc kho trước, chỉ tải những ngày
   * còn thiếu từ Minh Ngọc, ghi bổ sung vào kho (không trùng), rồi tính
   * thống kê trên dữ liệu đã ghi.
   */
  const loadData = useCallback((d: number) => load(d), [load]);

  useEffect(() => {
    loadData(30);
  }, [loadData]);

  /** Dữ liệu ngày trong khoảng — lấy từ masterdata (đã sắp xếp tăng dần). */
  const daysData = useMemo(
    () =>
      master
        ? {
            days: master.days,
            live: master.live,
            seed: master.seed,
            total: days,
            perDay: master.rows.map((r) => ({ date: r.date, source: r.source })),
          }
        : null,
    [master, days],
  );

  /** Thống kê tính trực tiếp trên dữ liệu ngày đã tải (live + seed). */
  const stats: StatsResult | null = useMemo(() => {
    if (!daysData) return null;
    const to = todayVN();
    const from = addDays(to, -(days - 1));
    const draws = drawsInRange(daysData.days, from, to, province);
    if (draws.length === 0) return null;
    return computeStats(draws, TOP_N, province);
  }, [daysData, days, province]);

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

  const handleCalc = () => loadData(days);

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
      <p className="muted">Tần suất các số 00–99 trong N ngày gần nhất, theo đài hoặc toàn miền Nam.</p>

      <div className="card">
        <div className="row">
          <div className="field">
            <label htmlFor="days">Số ngày</label>
            <select id="days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d} ngày
                </option>
              ))}
            </select>
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
        </div>
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
