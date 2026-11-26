import 'server-only';

import { cookies } from 'next/headers';

import { listClubs } from '@/lib/data/parquet';
import { BOCA_UID, CLUB_UID_RE, TEAM_COOKIE } from '@/lib/team-cookie';

export interface SelectedTeam {
  uid: string;
  name: string;
  /** Boca tiene el detalle por partido en Supabase; los demás clubes, los datos de temporada del archivo abierto. */
  isBoca: boolean;
}

const BOCA: SelectedTeam = { uid: BOCA_UID, name: 'Boca Juniors', isBoca: true };

/** El equipo elegido en el selector (cookie), con su nombre del archivo abierto. */
export async function getSelectedTeam(): Promise<SelectedTeam> {
  const raw = (await cookies()).get(TEAM_COOKIE)?.value;
  if (!raw || raw === BOCA_UID || !CLUB_UID_RE.test(raw)) return BOCA;
  const clubs = await listClubs(raw.slice(0, 3).toUpperCase());
  if (!clubs.ok) return { uid: raw, name: raw, isBoca: false }; // archivo caído: la página muestra el error
  const found = clubs.data.find((c) => c.uid === raw);
  return found ? { uid: raw, name: found.name, isBoca: false } : BOCA;
}
