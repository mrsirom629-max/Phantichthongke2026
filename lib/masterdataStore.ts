/** Store masterdata — dùng jsonStore dùng chung (redis → github → file). */
import {
  createJsonStore,
  STORE_READONLY,
  isReadonlyError,
  type StoreBackend,
} from './jsonStore';
import type { StoredDay } from './masterdata';
import type { Mien } from './types';

/**
 * Kho theo miền:
 * - 'nam' → key cũ `xs26:masterdata` (giữ nguyên dữ liệu XSMN hiện có).
 * - 'bac' → key mới `xs26:masterdata:mb`.
 */
export function createMasterdataStore(mien: Mien = 'nam', forceBackend?: StoreBackend) {
  return createJsonStore<StoredDay[]>(
    {
      relPath: mien === 'bac' ? 'data/masterdata-mb.json' : 'data/masterdata.json',
      commitPrefix: mien === 'bac' ? 'masterdata-mb' : 'masterdata',
      redisKey: mien === 'bac' ? 'xs26:masterdata:mb' : 'xs26:masterdata',
    },
    forceBackend,
  );
}

export { STORE_READONLY, isReadonlyError };
