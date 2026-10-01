/** Store masterdata — dùng jsonStore dùng chung (redis → github → file). */
import {
  createJsonStore,
  STORE_READONLY,
  isReadonlyError,
  type StoreBackend,
} from './jsonStore';
import type { StoredDay } from './masterdata';

const OPTS = {
  relPath: 'data/masterdata.json',
  commitPrefix: 'masterdata',
  redisKey: 'xs26:masterdata',
} as const;

export function createMasterdataStore(forceBackend?: StoreBackend) {
  return createJsonStore<StoredDay[]>(OPTS, forceBackend);
}

export { STORE_READONLY, isReadonlyError };
