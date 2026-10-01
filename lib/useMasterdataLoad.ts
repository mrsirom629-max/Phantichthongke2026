'use client';
/**
 * Hook dùng chung: tải N ngày gần nhất qua masterdata.
 * 1. Đọc masterdata hiện có (GET /api/masterdata)
 * 2. Chỉ tải những ngày CÒN THIẾU (hoặc đang là seed → thử nâng cấp live)
 * 3. Ghi bổ sung vào masterdata (POST) — không trùng, không ghi đè live
 * 4. Dựng bảng chi tiết Thứ | Ngày | Số để kiểm chứng
 */
import { useState } from 'react';
import { addDays, lotoOf, todayVN } from './stats';
import { loadSpecificDays } from './liveDays';
import type { DayResult } from './types';
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

export function useMasterdataLoad() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<LoadProgress>({ done: 0, total: 0, phase: '' });
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MasterLoadState | null>(null);

  const load = async (d: number): Promise<MasterLoadState | null> => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      // 1. Masterdata hiện có
      setProgress({ done: 0, total: 0, phase: 'Đọc masterdata' });
      const mdRes = await fetch('/api/masterdata');
      if (!mdRes.ok) throw new Error('Không đọc được masterdata.');
      let all = ((await mdRes.json()) as { days: StoredDay[] }).days ?? [];

      const to = todayVN();
      const want: string[] = [];
      for (let i = 0; i < d; i++) want.push(addDays(to, -i));

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
        const r = await loadSpecificDays(toFetch, (done, total) =>
          setProgress({ done, total, phase: 'Tải ngày còn thiếu từ Minh Ngọc' }),
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
          const sres = await fetch('/api/masterdata', {
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
          const md2 = (await (await fetch('/api/masterdata')).json()) as {
            days: StoredDay[];
          };
          all = md2.days ?? [];
        }
      }

      // 3. Dựng dữ liệu khoảng từ masterdata (nguồn sự thật duy nhất)
      const have = new Map(all.map((x) => [x.date, x]));
      const from = addDays(to, -(d - 1));
      const rangeDays: DayResult[] = [];
      let live = 0;
      for (const dt of want) {
        const h = have.get(dt);
        if (h) {
          rangeDays.push(h);
          if (h.source === 'minhngoc') live += 1;
        }
      }
      if (rangeDays.length === 0) {
        throw new Error('Không tải được ngày nào. Hãy kiểm tra mạng rồi thử lại.');
      }

      const addedSet = new Set(addedDates);
      const upgradedSet = new Set(upgradedDates);
      const rows: MasterRow[] = rangeDays.map((day) => {
        const nums = new Set<string>();
        for (const p of day.provinces) for (const n of lotoOf(p.prizes)) nums.add(n);
        return {
          date: day.date,
          numbers: Array.from(nums).sort(),
          source: have.get(day.date)?.source ?? 'seed',
          isNew: addedSet.has(day.date),
          upgraded: upgradedSet.has(day.date),
        };
      });

      const state: MasterLoadState = {
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
          rangeCount: d,
          haveCount: rangeDays.length,
          added: addedDates.length,
          upgraded: upgradedDates.length,
          missing: want.filter((dt) => !have.has(dt)),
        },
      };
      setData(state);
      return state;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dữ liệu.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { loading, progress, error, data, load };
}
