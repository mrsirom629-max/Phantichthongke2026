/**
 * JSON store dùng chung với 3 backend (ưu tiên theo thứ tự):
 * - redis:  Upstash Redis (khi có UPSTASH_REDIS_REST_URL/TOKEN)
 * - github: file trong repo qua Contents API (khi có GITHUB_TOKEN)
 * - file:   file local (dev)
 *
 * read:  backend chính → nếu redis TRỐNG thì rớt về github/file
 *        (giúp chuyển đổi backend không mất dữ liệu cũ).
 * write: luôn ghi vào backend chính đang cấu hình.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { Redis } from '@upstash/redis';

export const STORE_READONLY = 'STORE_READONLY_NO_TOKEN';

export type StoreBackend = 'redis' | 'github' | 'file';

export interface JsonStoreOptions {
  relPath: string; // đường dẫn file khi dùng github/file
  commitPrefix: string; // prefix commit khi ghi qua GitHub
  redisKey: string; // key khi dùng Redis
}

export interface JsonStore<T> {
  backend: StoreBackend;
  read: (fallback: T) => Promise<T>;
  write: (data: T) => Promise<void>;
  isReadonly: () => boolean;
}

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

function selectBackend(): StoreBackend {
  if (redisConfig()) return 'redis';
  if (process.env.GITHUB_TOKEN) return 'github';
  return 'file';
}

export function createJsonStore<T>(
  opts: JsonStoreOptions,
  forceBackend?: StoreBackend,
): JsonStore<T> {
  const backend: StoreBackend = forceBackend ?? selectBackend();
  const cfg = redisConfig();
  const rc: Redis | null = cfg ? new Redis({ url: cfg.url, token: cfg.token }) : null;

  const REPO = process.env.GITHUB_REPO || 'mrsirom629-max/Phantichthongke2026';
  const BRANCH = process.env.GITHUB_BRANCH || 'main';
  const localPath = (): string => path.join(process.cwd(), opts.relPath);

  async function fileRead(): Promise<T | null> {
    try {
      const raw = await fs.readFile(localPath(), 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async function ghRead(): Promise<{ data: T | null; sha: string | null }> {
    const url = `https://api.github.com/repos/${REPO}/contents/${opts.relPath}?ref=${BRANCH}`;
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
    const url = `https://api.github.com/repos/${REPO}/contents/${opts.relPath}`;
    const body: Record<string, unknown> = {
      message: `${opts.commitPrefix}: update`,
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

  async function redisRead(): Promise<T | null> {
    if (!rc) return null;
    try {
      const v = await rc.get<T>(opts.redisKey);
      return v ?? null;
    } catch {
      return null;
    }
  }

  async function redisWrite(data: T): Promise<void> {
    if (!rc) throw new Error('Redis chưa cấu hình (thiếu UPSTASH_REDIS_REST_URL/TOKEN).');
    await rc.set(opts.redisKey, data);
  }

  /** Đọc github/file khi redis trống — dùng trong quá trình chuyển đổi. */
  async function legacyRead(): Promise<T | null> {
    if (process.env.GITHUB_TOKEN) {
      try {
        const { data } = await ghRead();
        if (data !== null) return data;
      } catch {
        /* bỏ qua, thử file */
      }
    }
    return fileRead();
  }

  function readonlyError(): Error {
    const err = new Error(STORE_READONLY) as Error & { code?: string };
    err.code = STORE_READONLY;
    return err;
  }

  return {
    backend,
    async read(fallback: T): Promise<T> {
      if (backend === 'redis') {
        const v = await redisRead();
        if (v !== null) return v;
        return (await legacyRead()) ?? fallback;
      }
      if (backend === 'github') {
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
      if (backend === 'redis') {
        await redisWrite(data);
        return;
      }
      if (backend === 'github') {
        const { sha } = await ghRead();
        await ghWrite(data, sha);
        return;
      }
      if (process.env.VERCEL) throw readonlyError();
      await fs.mkdir(path.dirname(localPath()), { recursive: true });
      await fs.writeFile(localPath(), JSON.stringify(data, null, 2), 'utf-8');
    },
    isReadonly(): boolean {
      return backend === 'file' && !!process.env.VERCEL;
    },
  };
}

export function isReadonlyError(e: unknown): boolean {
  return (
    (e as Error)?.message === STORE_READONLY ||
    (e as Error & { code?: string })?.code === STORE_READONLY
  );
}
