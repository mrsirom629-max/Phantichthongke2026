/**
 * JSON store dùng chung: đọc/ghi một file JSON qua GitHub Contents API
 * (khi có GITHUB_TOKEN) hoặc file local (dev).
 * Dùng cho forecast-log, masterdata, ...
 */
import { promises as fs } from 'fs';
import path from 'path';

export const STORE_READONLY = 'STORE_READONLY_NO_TOKEN';

export interface JsonStore<T> {
  read: (fallback: T) => Promise<T>;
  write: (data: T) => Promise<void>;
  isReadonly: () => boolean;
}

export function createJsonStore<T>(relPath: string, commitPrefix: string): JsonStore<T> {
  const REPO = process.env.GITHUB_REPO || 'mrsirom629-max/Phantichthongke2026';
  const BRANCH = process.env.GITHUB_BRANCH || 'main';
  const useGithub = (): boolean => !!process.env.GITHUB_TOKEN;
  const localPath = (): string => path.join(process.cwd(), relPath);

  async function fileRead(): Promise<T | null> {
    try {
      const raw = await fs.readFile(localPath(), 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async function ghRead(): Promise<{ data: T | null; sha: string | null }> {
    const url = `https://api.github.com/repos/${REPO}/contents/${relPath}?ref=${BRANCH}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.status === 404) return { data: null, sha: null };
    if (!res.ok) throw new Error(`GitHub read ${res.status}`);
    const j = (await res.json()) as { sha?: string; content?: string };
    if (!j.content) return { data: null, sha: j.sha ?? null };
    const text = Buffer.from(j.content, 'base64').toString('utf-8');
    return { data: JSON.parse(text) as T, sha: j.sha ?? null };
  }

  async function ghWrite(data: T, sha: string | null): Promise<void> {
    const url = `https://api.github.com/repos/${REPO}/contents/${relPath}`;
    const body: Record<string, unknown> = {
      message: `${commitPrefix}: update`,
      content: Buffer.from(JSON.stringify(data, null, 2), 'utf-8').toString('base64'),
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

  function readonlyError(): Error {
    const err = new Error(STORE_READONLY) as Error & { code?: string };
    err.code = STORE_READONLY;
    return err;
  }

  return {
    async read(fallback: T): Promise<T> {
      if (useGithub()) {
        try {
          const { data } = await ghRead();
          return data ?? fallback;
        } catch {
          return (await fileRead()) ?? fallback;
        }
      }
      return (await fileRead()) ?? fallback;
    },
    async write(data: T): Promise<void> {
      if (useGithub()) {
        const { sha } = await ghRead();
        await ghWrite(data, sha);
        return;
      }
      if (process.env.VERCEL) throw readonlyError();
      await fs.mkdir(path.dirname(localPath()), { recursive: true });
      await fs.writeFile(localPath(), JSON.stringify(data, null, 2), 'utf-8');
    },
    isReadonly(): boolean {
      return !useGithub() && !!process.env.VERCEL;
    },
  };
}

export function isReadonlyError(e: unknown): boolean {
  return (
    (e as Error)?.message === STORE_READONLY ||
    (e as Error & { code?: string })?.code === STORE_READONLY
  );
}
