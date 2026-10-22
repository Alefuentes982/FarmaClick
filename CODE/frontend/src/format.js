const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
export const money = (v) => clp.format(Number(v ?? 0));
export const percent = (fraccion) => `${Math.round(Number(fraccion) * 10000) / 100}%`;
export const fechaCorta = (v) => (v ? new Date(v).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }) : '—');
// Las columnas DATE llegan como "AAAA-MM-DD" (o ISO a medianoche UTC); se muestran sin corrimiento de zona horaria.
export const soloFecha = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('-') : '—');
// AAAA-MM-DD en hora local (para <input type="date"> y filtros por día).
export const hoyIso = (offsetDias = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  return d.toLocaleDateString('en-CA');
};
export const inicioMesIso = () => { const d = new Date(); d.setDate(1); return d.toLocaleDateString('en-CA'); };
export const isoDate = (v) => (v ? String(v).slice(0, 10) : '');
export const fechaHora = (v) => (v
  ? new Date(v).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' })
  : '—');
