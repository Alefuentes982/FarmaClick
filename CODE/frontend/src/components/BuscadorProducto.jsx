import { useEffect, useId, useRef, useState } from 'react';
import { api, qs } from '../api.js';

// Orden de las coincidencias: SKU exacto, SKU que empieza con lo escrito, nombre que empieza con lo escrito y el resto
// por nombre. Así, escribir el SKU o el comienzo del nombre deja arriba lo que se busca.
export function ordenarCoincidencias(lista, texto) {
  const q = texto.trim().toLowerCase();
  const peso = (p) => (p.sku.toLowerCase() === q ? 0 : p.sku.toLowerCase().startsWith(q) ? 1 : p.nombre.toLowerCase().startsWith(q) ? 2 : 3);
  // Entre coincidencias por SKU se ordena por SKU (MED-020, MED-021…); en el resto, por nombre.
  return [...lista].sort((a, b) => peso(a) - peso(b)
    || (peso(a) <= 1 ? a.sku.localeCompare(b.sku, 'es', { numeric: true }) : 0)
    || a.nombre.localeCompare(b.nombre, 'es'));
}

// Selector de producto con búsqueda por SKU o nombre (reemplaza a las listas desplegables de cientos de productos).
//   value: producto elegido ({ id, sku, nombre }) o null;  onChange(producto | null)
//   buscar(texto): promesa con la lista de productos; por defecto busca en /productos (activos).
//   listarAlEnfocar: con el campo vacío muestra la lista completa (como un combo) y escribir la filtra.
//   max: cuántas coincidencias mostrar (10 por defecto).  marca(producto): texto extra al final de cada opción.
//   required: el formulario no se envía sin un producto elegido (validación del navegador).
export default function BuscadorProducto({
  value, onChange, buscar, id, placeholder = 'Escriba el SKU o el nombre…', autoFocus, listarAlEnfocar = false, max = 10, marca, required = false,
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const caja = useRef(null);
  const listaRef = useRef(null);
  const buscarProductos = buscar ?? ((q) => api.get(`/productos${qs({ q, activo: 'true', limit: 30 })}`).then((r) => r.data));

  useEffect(() => {
    const q = texto.trim();
    if (value || (!q && !(listarAlEnfocar && abierto))) { setResultados([]); setCargando(false); return undefined; }
    let vigente = true;
    setCargando(true);
    const t = setTimeout(() => {
      buscarProductos(q)
        .then((lista) => { if (vigente) { setResultados(ordenarCoincidencias(lista, q).slice(0, max)); setActivo(0); setError(null); } })
        .catch((e) => vigente && (setResultados([]), setError(e)))
        .finally(() => vigente && setCargando(false));
    }, 200);
    return () => { vigente = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto, value, abierto && listarAlEnfocar]);

  // Cierra la lista al hacer clic fuera.
  useEffect(() => {
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  // Con las flechas, la opción marcada se mantiene visible aunque la lista sea larga.
  useEffect(() => {
    listaRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activo]);

  const elegir = (p) => { onChange(p); setTexto(''); setResultados([]); setAbierto(false); };

  const teclas = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setActivo((i) => Math.min(i + 1, resultados.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((i) => Math.max(i - 1, 0)); }
    // Enter con la lista abierta elige la opción marcada y nunca envía el formulario que contiene al buscador.
    else if (e.key === 'Enter') { if (abierto) { e.preventDefault(); if (resultados[activo]) elegir(resultados[activo]); } }
    else if (e.key === 'Escape') setAbierto(false);
  };

  if (value) {
    return (
      <div className="input-group">
        <span className="form-control bg-light text-truncate" id={inputId} title={`${value.sku} — ${value.nombre}`}>
          <strong className="me-2">{value.sku}</strong>{value.nombre}{marca?.(value)}
        </span>
        <button type="button" className="btn btn-outline-secondary" onClick={() => onChange(null)} aria-label="Cambiar producto" title="Cambiar producto">
          <i className="bi bi-x-lg" />
        </button>
      </div>
    );
  }

  return (
    <div className="position-relative" ref={caja}>
      <input id={inputId} className="form-control" autoComplete="off" autoFocus={autoFocus} required={required} placeholder={placeholder} value={texto}
        role="combobox" aria-expanded={abierto} aria-controls={`${inputId}-lista`}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)} onKeyDown={teclas} />
      {abierto && (texto.trim() || listarAlEnfocar) && (
        <div className="list-group position-absolute w-100 shadow-sm" style={{ zIndex: 20, maxHeight: 320, overflowY: 'auto' }} id={`${inputId}-lista`} role="listbox" ref={listaRef}>
          {error && <div className="list-group-item text-danger small">{error.message}</div>}
          {!error && cargando && resultados.length === 0 && <div className="list-group-item text-muted small">Buscando…</div>}
          {!error && !cargando && resultados.length === 0 && <div className="list-group-item text-muted small">{texto.trim() ? `Ningún producto coincide con «${texto.trim()}».` : 'No hay productos para elegir.'}</div>}
          {resultados.map((p, i) => (
            <button type="button" key={p.id} role="option" aria-selected={i === activo}
              className={`list-group-item list-group-item-action ${i === activo ? 'active' : ''}`}
              onMouseEnter={() => setActivo(i)} onClick={() => elegir(p)}>
              <strong className="me-2">{p.sku}</strong>{p.nombre}{marca?.(p)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
