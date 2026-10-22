import { useState } from 'react';
import { descargarArchivo, imprimirArchivo, verArchivo } from '../archivos.js';

// Ver, imprimir y descargar un documento PDF del backend (comprobantes, órdenes de compra, informes).
//   path: ruta de la API que devuelve { archivo, tipo, base64 }; nombre: nombre del archivo al descargar;
//   onError(err): recibe el error si algo falla; tamano="sm" para barras compactas.
export default function BotonesDocumento({ path, nombre, onError, etiquetaVer = 'Ver', tamano }) {
  const [ocupado, setOcupado] = useState(null);
  const clase = `btn btn-outline-secondary ${tamano === 'sm' ? 'btn-sm' : ''}`;
  const ejecutar = (clave, accion) => async () => {
    setOcupado(clave);
    try {
      await accion();
    } catch (err) {
      onError?.(err);
    } finally {
      setOcupado(null);
    }
  };
  return (
    <>
      <button type="button" className={clase} disabled={ocupado} onClick={ejecutar('ver', () => verArchivo(path))}>
        <i className="bi bi-eye me-1" />{etiquetaVer}
      </button>
      <button type="button" className={clase} disabled={ocupado} onClick={ejecutar('imprimir', () => imprimirArchivo(path))}>
        <i className="bi bi-printer me-1" />{ocupado === 'imprimir' ? 'Preparando…' : 'Imprimir'}
      </button>
      <button type="button" className={clase} disabled={ocupado} onClick={ejecutar('descargar', () => descargarArchivo(path, nombre))}>
        <i className="bi bi-file-earmark-pdf me-1" />Descargar
      </button>
    </>
  );
}
