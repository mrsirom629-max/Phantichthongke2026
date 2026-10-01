/**
 * Lưu trữ nhật ký mô phỏng (forecast log) — dùng được cho cả API routes.
 *
 * - Production (Vercel) + có GITHUB_TOKEN: đọc/ghi file data/forecast-log.json
 *   trong repo qua GitHub Contents API → nhật ký bền vững, cron 17h30 dùng được.
 * - Dev (không có token): đọc/ghi file local.
 * - Production KHÔNG token: đọc được file đã commit (fs read-only OK),
 *   ghi → ném STORE_READONLY (API trả 501, UI báo rõ).
 */
import { promises as fs } from 'fs';
import path from 'path';
import type { ForecastEntry } from './forecast';

const LOG_REL = 'data/forecast-log.json';
const REPO = process.env.GITHUB_REPO || 'mrsirom629-max/Phantichthongke2026';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

export const STORE_READONLY = 'STORE_READONLY_NO_TOKEN';

function useGithub(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

function localPath(): string {
  return path.join(process.cwd(), LOG_REL);
}

async function fileRead(): Promise<ForecastEntry[]> {
  try {
    const raw = await fs.readFile(localPath(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ForecastEntry[]) : [];
  } catch {
    return [];
  }
}

async function ghRead(): Promise<{ entries: ForecastEntry[]; sha: string | null }> {
  const url = `https://api.github.com/repos/${REPO}/contents/${LOG_REL}?ref=${BRANCH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (res.status === 404) return { entries: [], sha: null };
  if (!res.ok) throw new Error(`GitHub read ${res.status}`);
  const j = (await res.json()) as { sha?: string; content?: string };
  if (!j.content) return { entries: [], sha: j.sha ?? null };
  const text = Buffer.from(j.content, 'base64').toString('utf-8');
  return { entries: JSON.parse(text) as ForecastEntry[], sha: j.sha ?? null };
}

async function ghWrite(entries: ForecastEntry[], sha: string | null): Promise<void> {
  const url = `https://api.github.com/repos/${REPO}/contents/${LOG_REL}`;
  const body: Record<string, unknown> = {
    message: `forecast-log: ${entries.length} entries`,
    content: Buffer.from(JSON.stringify(entries, null, 2), 'utf-8').toString('base64'),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`GitHub write ${res.status}: ${t.slice(0, 200)}`);
  }
}

/** Đọc toàn bộ nhật ký (mới nhất xếp sau; caller tự sort khi hiển thị). */
export async function readLog(): Promise<ForecastEntry[]> {
  if (useGithub()) {
    try {
      return (await ghRead()).entries;
    } catch {
      return fileRead(); // rớt về file đã commit
    }
  }
  return fileRead();
}

/** Ghi đè toàn bộ nhật ký. */
export async function writeLog(entries: ForecastEntry[]): Promise<void> {
  if (useGithub()) {
    const { sha } = await ghRead();
    await ghWrite(entries, sha);
    return;
  }
  if (process.env.VERCEL) {
    const err = new Error(STORE_READONLY) as Error & { code?: string };
    err.code = STORE_READONLY;
    throw err;
  }
  await fs.mkdir(path.dirname(localPath()), { recursive: true });
  await fs.writeFile(localPath(), JSON.stringify(entries, null, 2), 'utf-8');
}

export function isReadonlyStore(): boolean {
  return !useGithub() && !!process.env.VERCEL;
}
