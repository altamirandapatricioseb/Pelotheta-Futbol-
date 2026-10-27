import 'server-only';

import { latestRun, readConfig } from './github';
import { updateState, type UpdateState } from './state';

export type UpdateStatus = UpdateState | { state: 'unconfigured' | 'unavailable' };

/** Estado del botón para el route handler y para el primer render de la página. */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  const config = readConfig();
  if (!config) return { state: 'unconfigured' };
  try {
    return updateState(await latestRun(config));
  } catch {
    return { state: 'unavailable' };
  }
}
