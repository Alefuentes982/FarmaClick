import { Router } from 'express';

// GET /api/catalogos reúne las listas de apoyo (combos de los formularios). Cada módulo aporta las suyas
// en su `catalogos: { nombre: async () => filas }`; así un módulo nuevo no toca el de otro.
export function routerCatalogos(modulos) {
  const fuentes = Object.assign({}, ...modulos.map((m) => m.catalogos ?? {}));
  const r = Router();
  r.get('/', async (_req, res) => {
    const nombres = Object.keys(fuentes);
    const listas = await Promise.all(nombres.map((n) => fuentes[n]()));
    res.json(Object.fromEntries(nombres.map((n, i) => [n, listas[i]])));
  });
  return r;
}
