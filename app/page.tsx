'use client';

import { useCallback, useEffect, useState } from 'react';
import { PRIZE_ORDER, type DayResult, type Mien } from '../lib/types';

interface ResultsResponse {
  ok?: boolean;
  /** API trả 'minhngoc' (live) hoặc 'seed' (demo). Giữ tương thích với dạng cũ 'live'/'demo'. */
  source?: 'minhngoc' | 'seed' | 'live' | 'demo';
  data?: DayResult | null;
  note?: string;
  error?: string;
}

/** YYYY-MM-DD -> DD-MM-YYYY (định dạng API yêu cầu). */
function toApiDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** DD-MM-YYYY -> DD/MM/YYYY (hiển thị giống mẫu Excel). */
function displayDate(apiDate: string): string {
  return apiDate.replace(/-/g, '/');
}

/** Ngày hôm nay dạng YYYY-MM-DD cho input type=date. */
function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function mienLabel(m: Mien): string {
  if (m === 'trung') return 'Miền Trung';
  if (m === 'bac') return 'Miền Bắc';
  return 'Miền Nam';
}

/** Chuẩn hóa response: API trả { source: 'minhngoc'|'seed', data: DayResult|null, note? }. */
function normalizeResponse(json: unknown): {
  data: DayResult | null;
  source: 'live' | 'demo';
  note?: string;
} {
  if (json && typeof json === 'object' && 'data' in json) {
    const r = json as ResultsResponse;
    const src: 'live' | 'demo' =
      r.source === 'live' || r.source === 'minhngoc' ? 'live' : 'demo';
    return { data: r.data ?? null, source: src, note: r.note };
  }
  return { data: (json as DayResult | null) ?? null, source: 'demo' };
}

export default function HomePage() {
  const [dateIso, setDateIso] = useState<string>(todayIso);
  const [mien, setMien] = useState<Mien>('nam');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DayResult | null>(null);
  const [source, setSource] = useState<'live' | 'demo'>('demo');
  const [note, setNote] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const fetchResults = useCallback(async (iso: string, m: Mien) => {
    if (!iso) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/results?date=${encodeURIComponent(toApiDate(iso))}&mien=${m}`,
      );
      if (!res.ok) throw new Error(`Máy chủ trả về lỗi ${res.status}.`);
      const json: unknown = await res.json();
      const { data, source: src, note: n } = normalizeResponse(json);
      setResult(data);
      setSource(src);
      setNote(n ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dữ liệu, vui lòng thử lại.');
      setResult(null);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }, []);

  useEffect(() => {
    fetchResults(todayIso(), mien);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchResults]);

  const handleView = () => fetchResults(dateIso, mien);
  const handleMien = (m: Mien) => {
    setMien(m);
    fetchResults(dateIso, m);
  };

  /** Chỉ hiện các hàng giải có số (XSMB không có giải tám). */
  const prizeRows = result
    ? PRIZE_ORDER.filter(({ key }) =>
        result.provinces.some((p) => (p.prizes[key] ?? []).length > 0),
      )
    : [];

  return (
    <div>
      <h1>Kết quả xổ số</h1>
      <p className="muted">Bảng kết quả theo đúng mẫu: Thứ | Ngày sổ | Miền | Giải | Tỉnh.</p>

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
            <label htmlFor="pick-date">Ngày sổ</label>
            <input
              id="pick-date"
              type="date"
              value={dateIso}
              max={todayIso()}
              onChange={(e) => setDateIso(e.target.value)}
            />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button type="button" onClick={handleView} disabled={loading || !dateIso}>
              {loading ? 'Đang tải...' : 'Xem'}
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="card">
          <p className="muted">Đang tải dữ liệu, vui lòng chờ...</p>
        </div>
      )}

      {!loading && error && (
        <div className="card">
          <p>
            <span className="pill bad">Lỗi</span>
          </p>
          <p>{error}</p>
          <button type="button" className="ghost" onClick={handleView}>
            Thử lại
          </button>
        </div>
      )}

      {!loading && !error && searched && !result && (
        <div className="card">
          <p className="muted">Chưa có dữ liệu cho ngày này. Hãy chọn ngày khác.</p>
        </div>
      )}

      {!loading && !error && result && (
        <div>
          <p>
            <span className={source === 'live' ? 'pill good' : 'pill warn'}>
              {source === 'live' ? 'Minh Ngọc trực tiếp' : 'Dữ liệu mẫu (demo)'}
            </span>
          </p>
          {note && <p className="muted" style={{ fontSize: 13 }}>{note}</p>}
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead>
                <tr>
                  <th rowSpan={2}>Thứ</th>
                  <th rowSpan={2}>Ngày sổ</th>
                  <th rowSpan={2}>Miền</th>
                  <th rowSpan={2}>Giải</th>
                  <th colSpan={result.provinces.length}>Tỉnh</th>
                </tr>
                <tr>
                  {result.provinces.map((p) => (
                    <th key={p.code}>{p.province}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {prizeRows.map(({ key, label }) => (
                  <tr key={key} className={key === 'db' ? 'prize-db' : undefined}>
                    <td>{result.weekday}</td>
                    <td>{displayDate(result.date)}</td>
                    <td>{mienLabel(result.mien)}</td>
                    <td>{label}</td>
                    {result.provinces.map((p) => (
                      <td key={p.code} className="num">
                        {(p.prizes[key] ?? []).map((n) => (
                          <div key={n}>{n}</div>
                        ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
