import { useState } from 'react';
import { api, qs } from '../../api.js';
import { descargarArchivo } from '../../archivos.js';
import { money, soloFecha } from '../../format.js';
import { ErrorAlert, Seccion, Spinner, useAsync } from '../../components/ui.jsx';

const numero = new Intl.NumberFormat('es-CL');
const celda = (tipo, v) => (v == null || v === '' ? '—' : tipo === 'clp' ? money(v) : tipo === 'entero' ? numero.format(v) : tipo === 'fecha' ? soloFecha(v) : v);
const alinea = (c) => (c.tipo === 'texto' || c.tipo === 'fecha' ? '' : 'text-end');

// Un informe del dashboard dentro de su sección: lo pide al backend, lo muestra como tabla con su fila de totales y ofrece
// Excel, CSV y PDF en la cabecera. `params` son los filtros (desde, hasta, sucursal_id, dias, limite); la exportación trae
// todas las filas, sin el límite. `antes(informe)` permite poner un gráfico sobre la tabla; `plegable` deja la tabla
// oculta bajo ese gráfico hasta que se pide.
export default function TablaInforme({ id, titulo, icono = 'bi-table', params, antes, vacio = 'Sin datos para los filtros elegidos.', plegable = false }) {
  const consulta = qs(params);
  const { data, error, loading } = useAsync(() => api.get(`/dashboard/informes/${id}${consulta}`), [id, consulta]);
  const [errorArchivo, setErrorArchivo] = useState(null);
  const [bajando, setBajando] = useState(null);
  const [abierta, setAbierta] = useState(!plegable);

  const exportar = async (formato) => {
    setErrorArchivo(null);
    setBajando(formato);
    try {
      await descargarArchivo(`/dashboard/informes/${id}/exportar${qs({ ...params, limite: '', formato })}`);
    } catch (err) {
      setErrorArchivo(err);
    } finally {
      setBajando(null);
    }
  };

  const sinDatos = !data?.filas.length;
  const boton = (formato, etiqueta, icon, clase) => (
    <button key={formato} type="button" className={`btn btn-sm ${clase}`} disabled={sinDatos || bajando} onClick={() => exportar(formato)} title={`Descargar en ${etiqueta}`}>
      <i className={`bi ${icon} me-1`} />{bajando === formato ? 'Generando…' : etiqueta}
    </button>
  );
  const acciones = (
    <>
      {boton('xlsx', 'Excel', 'bi-file-earmark-excel', 'btn-outline-success')}
      {boton('csv', 'CSV', 'bi-filetype-csv', 'btn-outline-secondary')}
      {boton('pdf', 'PDF', 'bi-file-earmark-pdf', 'btn-outline-secondary')}
    </>
  );

  const tabla = data && (
    <div className="table-responsive">
      <table className="table table-sm table-hover align-middle">
        <thead>
          <tr>{data.columnas.map((c) => <th key={c.key} className={alinea(c)}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {data.filas.length === 0 && <tr><td colSpan={data.columnas.length} className="text-center text-muted py-3">{vacio}</td></tr>}
          {data.filas.map((f, i) => (
            <tr key={i}>
              {data.columnas.map((c) => <td key={c.key} className={alinea(c)}>{celda(c.tipo, f[c.key])}</td>)}
            </tr>
          ))}
        </tbody>
        {data.filas.length > 1 && Object.keys(data.totales).length > 0 && (
          <tfoot>
            <tr className="fw-semibold">
              {data.columnas.map((c, i) => (
                <td key={c.key} className={alinea(c)}>{i === 0 ? 'Total' : c.key in data.totales ? celda(c.tipo, data.totales[c.key]) : ''}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );

  return (
    <Seccion titulo={titulo ?? data?.titulo} icono={icono} acciones={acciones} plano={!antes}>
      <ErrorAlert error={error || errorArchivo} onClose={errorArchivo ? () => setErrorArchivo(null) : undefined} />
      {loading && !data ? <Spinner /> : data && (antes ? (
        <>
          {antes(data)}
          {plegable && (
            <button type="button" className="btn btn-link btn-sm px-0 mt-2" onClick={() => setAbierta((a) => !a)}>
              <i className={`bi ${abierta ? 'bi-chevron-up' : 'bi-chevron-down'} me-1`} />{abierta ? 'Ocultar' : 'Ver'} el detalle en tabla
            </button>
          )}
          {abierta && <div className="mt-2 border rounded overflow-hidden">{tabla}</div>}
        </>
      ) : tabla)}
    </Seccion>
  );
}
