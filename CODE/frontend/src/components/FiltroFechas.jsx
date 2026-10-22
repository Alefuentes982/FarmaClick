import { useEffect, useState } from 'react';
import { hoyIso, inicioMesIso } from '../format.js';

// Filtro por rango de días reutilizable (órdenes de compra, pedidos, ventas, reportes…).
// Se eligen las fechas y se aplican con el botón "Buscar" (o Enter); los atajos (Hoy, 7 días, Este mes) y "Limpiar"
// aplican de inmediato. onChange({ desde, hasta }) recibe AAAA-MM-DD o '' y solo se llama al aplicar.
// El backend lo recibe como ?desde=&hasta= (core/fechas.js).
export default function FiltroFechas({ desde, hasta, onChange }) {
  const [borrador, setBorrador] = useState({ desde, hasta });
  // Si el valor aplicado cambia desde afuera, el borrador lo sigue.
  useEffect(() => { setBorrador({ desde, hasta }); }, [desde, hasta]);

  const invalido = Boolean(borrador.desde && borrador.hasta && borrador.desde > borrador.hasta);
  const pendiente = borrador.desde !== desde || borrador.hasta !== hasta; // hay cambios sin buscar
  const aplicar = (f) => { setBorrador(f); onChange(f); };
  const buscar = () => { if (!invalido) onChange(borrador); };

  const atajos = [
    ['Hoy', () => aplicar({ desde: hoyIso(), hasta: hoyIso() })],
    ['7 días', () => aplicar({ desde: hoyIso(-6), hasta: hoyIso() })],
    ['Este mes', () => aplicar({ desde: inicioMesIso(), hasta: hoyIso() })],
  ];
  const clase = `form-control form-control-sm w-auto ${invalido ? 'is-invalid' : ''}`;
  const alEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } };

  return (
    <div className="d-flex flex-wrap align-items-center gap-2">
      <label className="small text-muted mb-0" htmlFor="ff-desde">Desde</label>
      <input id="ff-desde" type="date" className={clase} value={borrador.desde} max={borrador.hasta || undefined}
        onChange={(e) => setBorrador((b) => ({ ...b, desde: e.target.value }))} onKeyDown={alEnter} />
      <label className="small text-muted mb-0" htmlFor="ff-hasta">Hasta</label>
      <input id="ff-hasta" type="date" className={clase} value={borrador.hasta} min={borrador.desde || undefined}
        onChange={(e) => setBorrador((b) => ({ ...b, hasta: e.target.value }))} onKeyDown={alEnter} />
      <button type="button" className={`btn btn-sm ${pendiente ? 'btn-primary' : 'btn-outline-primary'}`} disabled={invalido} onClick={buscar}>
        <i className="bi bi-search me-1" />Buscar
      </button>
      <span className="vr d-none d-md-inline" />
      {atajos.map(([etiqueta, fn]) => (
        <button key={etiqueta} type="button" className="btn btn-outline-secondary btn-sm" onClick={fn}>{etiqueta}</button>
      ))}
      {(desde || hasta || borrador.desde || borrador.hasta) && (
        <button type="button" className="btn btn-link btn-sm" onClick={() => aplicar({ desde: '', hasta: '' })}>Limpiar</button>
      )}
      {invalido && <span className="text-danger small">"Desde" no puede ser posterior a "Hasta".</span>}
    </div>
  );
}
