'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadDaysLive } from '@/lib/liveDays';
import { freqTopK, predictTopK, trainForecastMLP, type TrainProgress } from '@/lib/forecastModel';
import { graphTopK } from '@/lib/graph';
import {
  MODEL_LABELS,
  fmtPct,
  scoreForecast,
  truthLotoSet,
  type ForecastEntry,
  type ForecastModel,
} from '@/lib/forecast';
import { cmpDate, parseD, todayVN } from '@/lib/stats';
import type { DayResult } from '@/lib/types';

const LOCAL_KEY = 'fc-log-local-v1';
const DEFAULT_K = 15;

type SimPhase = 'idle' | 'loading-days' | 'training' | 'preview' | 'saving' | 'done';

interface SimResult {
  numbers: string[];
  dataRange: ForecastEntry['dataRange'];
}

function loadLocal(): ForecastEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as ForecastEntry[]) : [];
  } catch {
    return [];
  }
}

function saveLocal(list: ForecastEntry[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch {
    /* bỏ qua */
  }
}

function displayDate(d: string): string {
  return d.replace(/-/g, '/');
}

export default function ForecastPage() {
  const [targetDate, setTargetDate] = useState(todayVN());
  const [model, setModel] = useState<ForecastModel>('mlp');
  const [k, setK] = useState(DEFAULT_K);
  const [lookback, setLookback] = useState(10);
  const [hidden, setHidden] = useState(64);
  const [epochs, setEpochs] = useState(500);

  const [phase, setPhase] = useState<SimPhase>('idle');
  const [dayProg, setDayProg] = useState({ done: 0, total: 0 });
  const [trainProg, setTrainProg] = useState<TrainProgress>({ epoch: 0, total: 0, loss: 0 });
  const [sim, setSim] = useState<SimResult | null>(null);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  const [entries, setEntries] = useState<ForecastEntry[]>([]);
  const [localEntries, setLocalEntries] = useState<ForecastEntry[]>([]);
  const [serverReadonly, setServerReadonly] = useState(false);
  const [recMsg, setRecMsg] = useState('');

  const refreshLog = useCallback(async () => {
    try {
      const res = await fetch('/api/forecast');
      if (!res.ok) throw new Error();
      const j = (await res.json()) as { entries?: ForecastEntry[]; readonly?: boolean };
      setEntries(Array.isArray(j.entries) ? j.entries : []);
      setServerReadonly(!!j.readonly);
    } catch {
      setEntries([]);
    }
    setLocalEntries(loadLocal());
  }, []);

  useEffect(() => {
    refreshLog();
  }, [refreshLog]);

  /** Nhật ký gộp: server là chính, bản local ghi đè theo id (khi chưa có token). */
  const merged: ForecastEntry[] = useMemo(() => {
    const byId = new Map<string, ForecastEntry>();
    for (const e of entries) byId.set(e.id, e);
    for (const e of localEntries) byId.set(e.id, e);
    return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [entries, localEntries]);

  const simulate = async () => {
    if (!parseD(targetDate)) {
      setErr('Ngày mục tiêu phải đúng dạng DD-MM-YYYY.');
      return;
    }
    setErr('');
    setNotice('');
    setSim(null);
    setPhase('loading-days');
    setDayProg({ done: 0, total: 90 });
    try {
      // Kỷ luật thời gian: chỉ dùng các ngày TRƯỚC ngày mục tiêu
      const r = await loadDaysLive(90, (done, total) => setDayProg({ done, total }));
      const past = r.days.filter((d) => cmpDate(d.date, targetDate) < 0);
      if (past.length < lookback + 5) {
        throw new Error(
          `Chỉ có ${past.length} ngày dữ liệu trước ${displayDate(targetDate)} (cần ít nhất ${lookback + 5}).`,
        );
      }
      const perDay = new Map(r.perDay.map((p) => [p.date, p.source]));
      const live = past.filter((d) => perDay.get(d.date) === 'minhngoc').length;
      const dataRange: ForecastEntry['dataRange'] = {
        from: past[0].date,
        to: past[past.length - 1].date,
        days: past.length,
        live,
        seed: past.length - live,
      };

      let numbers: string[];
      if (model === 'mlp') {
        setPhase('training');
        setTrainProg({ epoch: 0, total: epochs, loss: 0 });
        const mlp = await trainForecastMLP(past, lookback, hidden, epochs, 0.5, 42, setTrainProg);
        numbers = predictTopK(mlp, past, lookback, k);
      } else if (model === 'graph') {
        // Đồ thị tri thức: PageRank trên đồ thị đồng xuất hiện của 90 ngày quá khứ
        numbers = graphTopK(past, k);
      } else {
        numbers = freqTopK(past, k);
      }
      setSim({ numbers, dataRange });
      setPhase('preview');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Mô phỏng thất bại, thử lại.');
      setPhase('idle');
    }
  };

  const saveEntry = async () => {
    if (!sim) return;
    setPhase('saving');
    setErr('');
    const payload = {
      targetDate,
      model,
      k,
      numbers: sim.numbers,
      params: { lookback, hidden, epochs, lr: 0.5, seed: 42 },
      dataRange: sim.dataRange,
      note: 'Tạo từ trang Dự báo (shadow)',
    };
    try {
      const res = await fetch('/api/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = (await res.json()) as { entry?: ForecastEntry; error?: string };
      if (res.status === 201 && j.entry) {
        setPhase('done');
        refreshLog();
        return;
      }
      if (res.status === 501 && j.entry) {
        // Chưa có GITHUB_TOKEN: lưu tạm trên trình duyệt
        const next = [j.entry, ...loadLocal()];
        saveLocal(next);
        setLocalEntries(next);
        setNotice(
          'Đã lưu tạm trên trình duyệt này (thiếu GITHUB_TOKEN nên chưa ghi được nhật ký chung). ' +
            'Thêm token theo README để bật nhật ký chung + đối chiếu 17h30 tự động.',
        );
        setPhase('done');
        return;
      }
      throw new Error(j.error || 'Không lưu được.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không lưu được nhật ký.');
      setPhase('preview');
    }
  };

  /** Xóa một entry khỏi nhật ký (chỉ khi còn pending). */
  const deleteEntry = async (id: string) => {
    if (!confirm('Xóa mô phỏng này khỏi nhật ký?')) return;
    try {
      const res = await fetch('/api/forecast', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error || 'Không xóa được.');
      }
      // Xóa cả bản local nếu có
      const locals = loadLocal().filter((e) => e.id !== id);
      saveLocal(locals);
      setLocalEntries(locals);
      await refreshLog();
    } catch (e) {
      setRecMsg(e instanceof Error ? e.message : 'Không xóa được.');
    }
  };
  const reconcileAll = useCallback(async () => {
    setRecMsg('Đang đối chiếu...');
    let changed = 0;
    // 1. Server: PATCH từng entry
    for (const e of entries) {
      if (e.status !== 'pending') continue;
      try {
        const res = await fetch('/api/forecast', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: e.id, action: 'reconcile' }),
        });
        const j = (await res.json()) as { reconciled?: boolean };
        if (j.reconciled) changed++;
      } catch {
        /* bỏ qua entry lỗi */
      }
    }
    // 2. Local: đối chiếu ngay trên trình duyệt (chỉ với số liệu LIVE)
    const locals = loadLocal();
    let localChanged = false;
    for (let i = 0; i < locals.length; i++) {
      const e = locals[i];
      if (e.status !== 'pending' || cmpDate(e.targetDate, todayVN()) > 0) continue;
      try {
        const res = await fetch(`/api/results?date=${encodeURIComponent(e.targetDate)}`);
        const j = (await res.json()) as { source?: string; data?: DayResult | null };
        if (j.source !== 'minhngoc' || !j.data) continue;
        const metrics = scoreForecast(e.numbers, truthLotoSet(j.data));
        locals[i] = { ...e, status: 'reconciled', reconciledAt: new Date().toISOString(), metrics };
        localChanged = true;
        changed++;
      } catch {
        /* bỏ qua */
      }
    }
    if (localChanged) {
      saveLocal(locals);
      setLocalEntries(locals);
    }
    await refreshLog();
    setRecMsg(
      changed > 0
        ? `Đã đối chiếu ${changed} mô phỏng.`
        : 'Chưa có mô phỏng nào đối chiếu được (có thể chưa tới giờ quay hoặc chưa có số thật).',
    );
  }, [entries, refreshLog]);

  // Tự đối chiếu khi mở trang (không cần chờ cron)
  useEffect(() => {
    const t = setTimeout(() => {
      reconcileAll();
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Mức độ tiên hóa: độ chính xác tích lũy theo mô hình, so với baseline ngẫu nhiên. */
  const evolution = useMemo(() => {
    const rec = merged.filter((e) => e.status === 'reconciled' && e.metrics);
    const byModel = new Map<
      ForecastModel,
      { n: number; pSum: number; rSum: number; bSum: number; last: ForecastEntry | null }
    >();
    for (const e of rec) {
      const m = e.metrics!;
      const cur = byModel.get(e.model) ?? { n: 0, pSum: 0, rSum: 0, bSum: 0, last: null };
      cur.n++;
      cur.pSum += m.precision;
      cur.rSum += m.recall;
      cur.bSum += m.baselinePrecision;
      if (!cur.last || e.targetDate > cur.last.targetDate) cur.last = e;
      byModel.set(e.model, cur);
    }
    return { rec, byModel };
  }, [merged]);

  const busy = phase === 'loading-days' || phase === 'training' || phase === 'saving';

  return (
    <div>
      <h1>Dự báo &amp; Nhật ký cải tiến</h1>
      <div className="note">
        <b>Chế độ SHADOW — thực nghiệm đo lường.</b> Mọi mô phỏng chỉ được ghi nhận
        để đối chiếu và rút ra độ chính xác, <b>không dùng để quyết định</b>. Xổ số
        là các kỳ quay ngẫu nhiên độc lập — không có mô hình nào dự đoán được kết quả.
        Điểm số mô hình <b>chưa hiệu chuẩn</b>, không phải xác suất trúng.
      </div>

      <div className="card">
        <h3>1. Tạo mô phỏng</h3>
        <div className="row">
          <div className="field">
            <label htmlFor="target">Ngày mục tiêu (DD-MM-YYYY)</label>
            <input
              id="target"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value.trim())}
              placeholder="01-10-2026"
              style={{ width: 140 }}
            />
          </div>
          <div className="field">
            <label htmlFor="model">Mô hình</label>
            <select id="model" value={model} onChange={(e) => setModel(e.target.value as ForecastModel)}>
              <option value="mlp">{MODEL_LABELS.mlp}</option>
              <option value="freq">{MODEL_LABELS.freq}</option>
              <option value="graph">{MODEL_LABELS.graph}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="fk">Số dự đoán (k)</label>
            <select id="fk" value={k} onChange={(e) => setK(Number(e.target.value))}>
              {[5, 10, 15, 20].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button onClick={simulate} disabled={busy}>
              {phase === 'loading-days'
                ? `Đang tải ${dayProg.done}/${dayProg.total}...`
                : phase === 'training'
                  ? `Đang train ${trainProg.epoch}/${trainProg.total}...`
                  : 'Mô phỏng'}
            </button>
          </div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor="lookback">Lookback</label>
            <select id="lookback" value={lookback} onChange={(e) => setLookback(Number(e.target.value))} disabled={model !== 'mlp'}>
              {[3, 5, 10].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="hidden">Nơ-ron ẩn</label>
            <select id="hidden" value={hidden} onChange={(e) => setHidden(Number(e.target.value))} disabled={model !== 'mlp'}>
              {[16, 32, 64].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="epochs">Epoch</label>
            <select id="epochs" value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} disabled={model !== 'mlp'}>
              {[50, 200, 500].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
        {phase === 'loading-days' && (
          <div className="progress" style={{ marginTop: 8 }}>
            <div style={{ width: `${dayProg.total > 0 ? (dayProg.done / dayProg.total) * 100 : 0}%` }} />
          </div>
        )}
        {phase === 'training' && (
          <div style={{ marginTop: 8 }}>
            <p className="muted">
              Epoch {trainProg.epoch}/{trainProg.total} — loss: {trainProg.loss.toFixed(4)}
            </p>
            <div className="progress">
              <div style={{ width: `${trainProg.total > 0 ? (trainProg.epoch / trainProg.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
        {err && <p style={{ color: '#f87171' }}>{err}</p>}
        {notice && (
          <p className="muted" style={{ fontSize: 13 }}>
            {notice}
          </p>
        )}

        {(phase === 'preview' || phase === 'saving' || phase === 'done') && sim && (
          <div style={{ marginTop: 12 }}>
            <h4 style={{ margin: '0 0 8px' }}>
              Kết quả mô phỏng cho {displayDate(targetDate)} — {MODEL_LABELS[model]} (top {k})
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {sim.numbers.map((n, i) => (
                <span
                  key={n}
                  className="num"
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '6px 10px',
                    fontWeight: 700,
                  }}
                  title={`Hạng ${i + 1}`}
                >
                  {n}
                </span>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              Dữ liệu train: {displayDate(sim.dataRange.from)} → {displayDate(sim.dataRange.to)} (
              {sim.dataRange.live} ngày trực tiếp, {sim.dataRange.seed} ngày mẫu). Chế độ shadow —
              chỉ ghi nhận để đo lường.
            </p>
            {phase !== 'done' ? (
              <button onClick={saveEntry} disabled={busy}>
                {phase === 'saving' ? 'Đang lưu...' : 'Lưu vào nhật ký'}
              </button>
            ) : (
              <p>
                <span className="pill good">Đã ghi nhật ký</span>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h3>2. Nhật ký mô phỏng</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          Mỗi mô phỏng được ghi <b>trước</b> giờ quay (snapshot trước outcome). Đối chiếu tự
          động lúc <b>17h30 hàng ngày</b> sau khi có số thật
          {serverReadonly && ' (nhật ký chung đang chỉ đọc — thiếu GITHUB_TOKEN, xem README).'}
        </p>
        {merged.length === 0 ? (
          <p className="muted">Chưa có mô phỏng nào trong nhật ký.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead>
                <tr>
                  <th>Ngày mục tiêu</th>
                  <th>Mô hình</th>
                  <th>k</th>
                  <th>Số mô phỏng</th>
                  <th>Trạng thái</th>
                  <th>Kết quả đối chiếu</th>
                </tr>
              </thead>
              <tbody>
                {merged.map((e) => (
                  <tr key={e.id}>
                    <td className="num">{displayDate(e.targetDate)}</td>
                    <td>{MODEL_LABELS[e.model]}</td>
                    <td className="num">{e.k}</td>
                    <td className="num" style={{ fontSize: 13 }}>
                      {e.numbers.join(' ')}
                    </td>
                    <td>
                      {e.status === 'pending' ? (
                        <span className="pill warn">chờ đối chiếu</span>
                      ) : (
                        <span className="pill good">đã đối chiếu</span>
                      )}
                      {e.status === 'pending' && (
                        <button
                          type="button"
                          className="ghost"
                          style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12 }}
                          onClick={() => deleteEntry(e.id)}
                        >
                          Xóa
                        </button>
                      )}
                    </td>
                    <td className="num" style={{ fontSize: 13 }}>
                      {e.metrics
                        ? `${e.metrics.hits}/${e.k} trúng • P=${fmtPct(e.metrics.precision)} (baseline ${fmtPct(e.metrics.baselinePrecision)})`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3>3. Đối chiếu &amp; Mức độ tiên hóa</h3>
        <div className="row">
          <button className="ghost" onClick={reconcileAll}>
            Đối chiếu ngay
          </button>
          {recMsg && <span className="muted">{recMsg}</span>}
        </div>
        {evolution.rec.length === 0 ? (
          <p className="muted">Chưa có mô phỏng nào được đối chiếu — mức độ tiên hóa sẽ xuất hiện sau kỳ đối chiếu đầu tiên.</p>
        ) : (
          <div>
            <div className="grid2">
              {(Object.keys(MODEL_LABELS) as ForecastModel[]).map((m) => {
                const s = evolution.byModel.get(m);
                if (!s) return null;
                return (
                  <div className="card" key={m}>
                    <h4 style={{ marginTop: 0 }}>{MODEL_LABELS[m]}</h4>
                    <div className="muted">Số kỳ đã đối chiếu</div>
                    <div style={{ fontSize: 24, fontWeight: 800 }}>{s.n}</div>
                    <div className="muted">Precision@{s.last?.k ?? k} trung bình (mức độ tiên hóa)</div>
                    <div style={{ fontSize: 24, fontWeight: 800 }}>{fmtPct(s.pSum / s.n)}</div>
                    <div className="muted">Baseline ngẫu nhiên: {fmtPct(s.bSum / s.n)}</div>
                    <div className="muted">Recall trung bình: {fmtPct(s.rSum / s.n)}</div>
                  </div>
                );
              })}
            </div>
            <div className="note" style={{ marginTop: 12 }}>
              <b>Cách đọc mức độ tiên hóa:</b> precision trung bình của mô hình so với
              baseline đoán ngẫu nhiên trên cùng các kỳ. Với xổ số ngẫu nhiên độc lập,
              kỳ vọng hai con số này <b>bám sát nhau</b> — đó chính là kết quả trung thực
              mà nhật ký này ghi nhận liên tục.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
