// Prueba de carga liviana (16.7): 20 usuarios virtuales durante 2 minutos recorriendo las páginas
// principales. Objetivo: p95 < 800 ms y menos de 1 % de errores.
//
//   k6 run -e BASE_URL=https://<preview>.vercel.app k6/carga.js
//
// Nunca contra producción ni contra terceros: el script se niega a correr si BASE_URL apunta al
// dominio de producción o a Supabase.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || '';
if (!BASE || BASE.includes('pelotheta-futbol.vercel.app') || BASE.includes('supabase.co')) {
  throw new Error('BASE_URL tiene que ser un preview o un entorno local, nunca producción ni Supabase');
}

export const options = {
  vus: 20,
  duration: '2m',
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

const PATHS = ['/', '/equipo', '/jugadores', '/situaciones', '/estadistica/goles?entidad=jugador&id=6', '/estado'];

export default function () {
  for (const path of PATHS) {
    const res = http.get(`${BASE}${path}`);
    check(res, { 'responde 200': (r) => r.status === 200 });
    sleep(1);
  }
}
