/** Store nhật ký dự báo — dùng jsonStore dùng chung (GitHub khi có token, file khi dev). */
import { createJsonStore, STORE_READONLY, isReadonlyError } from './jsonStore';
import type { ForecastEntry } from './forecast';

const store = createJsonStore<ForecastEntry[]>('data/forecast-log.json', 'forecast-log');

export const readLog = (): Promise<ForecastEntry[]> => store.read([]);
export const writeLog = (entries: ForecastEntry[]): Promise<void> => store.write(entries);
export const isReadonlyStore = (): boolean => store.isReadonly();
export { STORE_READONLY, isReadonlyError };
