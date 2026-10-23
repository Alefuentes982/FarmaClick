// Prueba de rendimiento de FarmaClick con k6 (https://k6.io).
// Ejecutar con Docker (no requiere instalar k6):
//   docker run --rm -i -e URL=https://farmaclick-medifarm.duckdns.org -e CORREO=<correo> -e CLAVE=<clave> grafana/k6 run - < carga_k6.js
// Local:  docker run --rm -i --network host -e URL=http://localhost:3000 grafana/k6 run - < carga_k6.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const URL = __ENV.URL || 'http://localhost:3000';
export const options = {
  stages: [
    { duration: '30s', target: 10 },  // subida
    { duration: '1m', target: 20 },   // carga sostenida: 20 usuarios concurrentes
    { duration: '30s', target: 0 },   // bajada
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],     // menos de 1% de errores
    http_req_duration: ['p(95)<800'],   // 95% de las respuestas en menos de 800 ms
  },
};

export function setup() {
  const r = http.post(`${URL}/api/auth/login`, JSON.stringify({
    correo: __ENV.CORREO || 'admin@farmaclick.local', password: __ENV.CLAVE || 'Admin12345',
  }), { headers: { 'Content-Type': 'application/json' } });
  check(r, { 'login 200': (x) => x.status === 200 });
  return { token: r.json('access_token') };
}

export default function (data) {
  const h = { headers: { Authorization: `Bearer ${data.token}` } };
  const rs = http.batch([
    ['GET', `${URL}/api/health/db`],
    ['GET', `${URL}/api/inventario/stock`, null, h],
    ['GET', `${URL}/api/productos?q=para`, null, h],
    ['GET', `${URL}/api/dashboard/resumen`, null, h],
  ]);
  rs.forEach((r) => check(r, { 'respuesta 200': (x) => x.status === 200 }));
  sleep(1);
}
