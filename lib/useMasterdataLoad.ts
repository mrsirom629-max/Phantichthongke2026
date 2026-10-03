'use client';
/**
 * Hook dùng chung: tải ngày qua masterdata.
 * - load():    đọc kho → tải ngày thiếu → ghi bổ sung → dựng bảng.
 * - refresh(): CHỈ đọc kho và dựng bảng, KHÔNG tải ngày mới — dùng khi mở
 *   trang để hiển thị tức thì dữ liệu đã có, không bắt tải lại từ đầu.
 * 1. Đọc masterdata hiện có (GET /api/masterdata)
 * 2. (load) Chỉ tải những ngày CÒN THIẾU (hoặc đang là seed → thử nâng cấp live)
 * 3. (load) Ghi bổ sung vào masterdata (POST) — không trùng, không ghi đè live
 * 4. Dựng bảng chi tiết Thứ | Ngày | Số để kiểm chứng
 */
import { useCallback, useRef, useState } from 'react';
import { addDays, diffDays, isValidDate, lotoOf, todayVN, analysisProvinces } from './stats';
import { loadSpecificDays } from './liveDays';
import type { DayResult, Mien } from './types';
import type { StoredDay } from './masterdata';
import type { MasterRow, MasterSummary } from '../components/MasterdataPanel';

export interface MasterLoadState {
  days: DayResult[];
  live: number;
  seed: number;
  rows: MasterRow[];
  summary: MasterSummary;
}

export interface LoadProgress {
  done: number;
  total: number;
  phase: string;
}

/** Đọc toàn bộ kho masterdata của một miền (nguồn sự thật duy nhất). */
async function readMaster(mien: Mien): Promise<StoredDay[]> {
  const mdRes = await fetch(`/api/masterdata?mien=${mien}`);
  if (!mdRes.ok) throw new Error('Không đọc được masterdata.');
  return (((await mdRes.json()) as { days: StoredDay[] }).days ?? []);
}

/** Danh sách ngày trong [from..to] (mới nhất trước — khớp thứ tự bảng cũ). */
function wantDates(from: string, to: string): string[] {
  const d = diffDays(from, to) + 1;
  const want: string[] = [];
  for (let i = 0; i < d; i++) want.push(addDays(to, -i));
  return want;
}

/**
 * Dựng state hiển thị từ kho masterdata (nguồn sự thật duy nhất).
 * Không throw khi khoảng trống — page tự hiện "chưa có dữ liệu".
 */
function buildViewState(
  all: StoredDay[],
  want: string[],
  from: string,
  to: string,
  addedDates: string[],
  upgradedDates: string[],
): MasterLoadState {
  const have = new Map(all.map((x) => [x.date, x]));
  const rangeDays: DayResult[] = [];
  let live = 0;
  for (const dt of want) {
    const h = have.get(dt);
    if (h) {
      rangeDays.push(h);
      if (h.source === 'minhngoc') live += 1;
    }
  }
  const addedSet = new Set(addedDates);
  const upgradedSet = new Set(upgradedDates);
  const rows: MasterRow[] = rangeDays.map((day) => {
    const nums = new Set<string>();
    for (const p of analysisProvinces(day)) for (const n of lotoOf(p.prizes)) nums.add(n);
    return {
      date: day.date,
      numbers: Array.from(nums).sort(),
      source: have.get(day.date)?.source ?? 'seed',
      isNew: addedSet.has(day.date),
      upgraded: upgradedSet.has(day.date),
    };
  });
  return {
    days: rangeDays,
    live,
    seed: rangeDays.length - live,
    rows,
    summary: {
      totalMaster: all.length,
      masterFrom: all.length ? all[0].date : null,
      masterTo: all.length ? all[all.length - 1].date : null,
      rangeFrom: from.split('-').join('/'),
      rangeTo: to.split('-').join('/'),
      windowFrom: from,
      windowTo: to,
      rangeCount: want.length,
      haveCount: rangeDays.length,
      added: addedDates.length,
      upgraded: upgradedDates.length,
      missing: want.filter((dt) => !have.has(dt)),
    },
  };
}

export function useMasterdataLoad() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<LoadProgress>({ done: 0, total: 0, phase: '' });
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MasterLoadState | null>(null);
  // Chặn tải chồng lấn: chỉ một lượt load tại một thời điểm
  const busyRef = useRef(false);

  // useCallback + deps rỗng: identity ổn định → useEffect ở page chỉ chạy 1 lần,
  // không lặp vô hạn (mỗi lần lặp cũ đã gây POST liên tục → commit/deploy dồn dập).
  // endDate: ngày cuối của vòng quét (DD-MM-YYYY). Bỏ trống = hôm nay.
  // Mỗi vòng là một cửa sổ MỚI lùi về quá khứ, không đè lên vòng cũ.
  // mien: kho dữ liệu theo miền ('nam' | 'bac').
  const load = useCallback(
    async (d: number, endDate?: string, mien: Mien = 'nam'): Promise<MasterLoadState | null> => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setLoading(true);
      setError(null);
      setData(null);
      try {
        // 1. Masterdata hiện có (theo miền)
        setProgress({ done: 0, total: 0, phase: 'Đọc masterdata' });
        let all = await readMaster(mien);

      const to = endDate && isValidDate(endDate) ? endDate : todayVN();
      const from = addDays(to, -(d - 1));
      const want = wantDates(from, to);

      // 2. Ngày thiếu HOẶC đang là seed → tải bổ sung
      const have0 = new Map(all.map((x) => [x.date, x]));
      const toFetch = want.filter((dt) => {
        const h = have0.get(dt);
        return !h || h.source === 'seed';
      });

      let addedDates: string[] = [];
      let upgradedDates: string[] = [];
      if (toFetch.length > 0) {
        setProgress({ done: 0, total: toFetch.length, phase: 'Tải ngày còn thiếu từ Minh Ngọc' });
        const r = await loadSpecificDays(
          toFetch,
          (done, total) =>
            setProgress({ done, total, phase: 'Tải ngày còn thiếu từ Minh Ngọc' }),
          mien,
        );
        const incoming = r.perDay
          .map((p) => {
            const slot = r.days.find((dd) => dd.date === p.date);
            return slot
              ? { date: p.date, source: p.source as 'minhngoc' | 'seed', day: slot }
              : null;
          })
          .filter(
            (x): x is { date: string; source: 'minhngoc' | 'seed'; day: DayResult } =>
              x !== null,
          );
        if (incoming.length > 0) {
          setProgress({
            done: toFetch.length,
            total: toFetch.length,
            phase: 'Ghi bổ sung vào masterdata',
          });
          const sres = await fetch(`/api/masterdata?mien=${mien}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days: incoming }),
          });
          if (!sres.ok) {
            const j = (await sres.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error || 'Không ghi được masterdata.');
          }
          const sj = (await sres.json()) as {
            addedDates?: string[];
            upgradedDates?: string[];
          };
          addedDates = sj.addedDates ?? [];
          upgradedDates = sj.upgradedDates ?? [];
          all = await readMaster(mien);
        }
      }

      // 3. Dựng dữ liệu khoảng từ masterdata (nguồn sự thật duy nhất)
      const state = buildViewState(all, want, from, to, addedDates, upgradedDates);
      if (state.days.length === 0) {
        throw new Error('Không tải được ngày nào. Hãy kiểm tra mạng rồi thử lại.');
      }
      setData(state);
      return state;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dữ liệu.');
      return null;
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, []);

  /**
   * Chỉ đọc kho và dựng bảng hiển thị — KHÔNG tải ngày mới, KHÔNG ghi.
   * Dùng khi mở trang / đổi miền: hiển thị tức thì dữ liệu đã có,
   * không bắt người dùng chờ tải lại từ đầu.
   */
  const refresh = useCallback(
    async (from: string, to: string, mien: Mien = 'nam'): Promise<MasterLoadState | null> => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setLoading(true);
      setError(null);
      try {
        setProgress({ done: 0, total: 0, phase: 'Đọc kho masterdata' });
        const all = await readMaster(mien);
        const want = wantDates(from, to);
        const state = buildViewState(all, want, from, to, [], []);
        setData(state);
        return state;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Không đọc được kho dữ liệu.');
        return null;
      } finally {
        busyRef.current = false;
        setLoading(false);
      }
    },
    [],
  );

  return { loading, progress, error, data, load, refresh };
}
