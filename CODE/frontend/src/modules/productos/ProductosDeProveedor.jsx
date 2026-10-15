import { api } from '../../api.js';
import { money } from '../../format.js';
import { ErrorAlert, useAsync } from '../../components/ui.jsx';

// Sección "Productos que ofrece" de la ficha del proveedor (se inserta en el slot proveedor.ficha).
export default function ProductosDeProveedor({ proveedorId }) {
  const { data, error } = useAsync(() => api.get(`/productos/proveedor/${proveedorId}`), [proveedorId]);

  return (
    <>
      <h3 className="h5">Productos que ofrece</h3>
      <ErrorAlert error={error} />
      {data?.length === 0 ? (
        <p className="text-muted">Aún no hay productos asociados. Se asocian desde la ficha del producto.</p>
      ) : (
        <table className="table table-sm">
          <thead><tr><th>SKU</th><th>Producto</th><th className="text-end">Costo referencial</th><th /></tr></thead>
          <tbody>
            {data?.map((p) => (
              <tr key={p.producto_id}>
                <td>{p.sku}</td><td>{p.nombre}</td><td className="text-end">{money(p.costo_referencial)}</td>
                <td>{p.es_principal && <span className="badge text-bg-primary">Principal</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
