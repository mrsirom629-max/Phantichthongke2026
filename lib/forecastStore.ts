/** Store nhật ký dự báo — dùng jsonStore dùng chung (redis → github → file). */
import {
  createJsonStore,
  STORE_READONLY,
  isReadonlyError,
  type StoreBackend,
} from './jsonStore';
import type { ForecastEntry } from './forecast';

const OPTS = {
  relPath: 'data/forecast-log.json',
  commitPrefix: 'forecast-log',
  redisKey: 'xs26:forecast-log',
} as const;

export function createForecastStore(forceBackend?: StoreBackend) {
  return createJsonStore<ForecastEntry[]>(OPTS, forceBackend);
}

const store = createForecastStore();

export const readLog = (): Promise<ForecastEntry[]> => store.read([]);
export const writeLog = (entries: ForecastEntry[]): Promise<void> => store.write(entries);
export const isReadonlyStore = (): boolean => store.isReadonly();
export const storeBackend = (): StoreBackend => store.backend;
export { STORE_READONLY, isReadonlyError };
