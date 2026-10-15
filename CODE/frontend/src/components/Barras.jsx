import { money } from '../format.js';

// Gráfico de barras en SVG, sin librerías: una barra por dato, con línea en cero (admite valores negativos,
// p. ej. un día con más devoluciones que ventas). datos: [{ etiqueta, valor }]; la etiqueta se muestra al pasar el cursor.
export default function Barras({ datos, alto = 160, formato = money, color = '#0d6efd' }) {
  if (!datos.length) return <div className="text-muted small py-4 text-center">Sin datos en el período</div>;
  const max = Math.max(0, ...datos.map((d) => d.valor));
  const min = Math.min(0, ...datos.map((d) => d.valor));
  const rango = max - min || 1;
  const y = (v) => ((max - v) / rango) * alto;
  const ancho = 100 / datos.length;
  const etiquetaCada = Math.ceil(datos.length / 8);
  return (
    <div>
      <svg viewBox={`0 0 100 ${alto}`} preserveAspectRatio="none" width="100%" height={alto} role="img" aria-label="Gráfico de barras">
        <line x1="0" x2="100" y1={y(0)} y2={y(0)} stroke="#adb5bd" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        {datos.map((d, i) => {
          const top = Math.min(y(d.valor), y(0));
          const h = Math.max(Math.abs(y(d.valor) - y(0)), d.valor ? 0.8 : 0);
          return (
            <rect key={i} x={i * ancho + ancho * 0.1} width={ancho * 0.8} y={top} height={h} fill={d.valor < 0 ? '#dc3545' : color} rx="0.3">
              <title>{`${d.etiqueta}: ${formato(d.valor)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="d-flex small text-muted" style={{ marginTop: 2 }}>
        {datos.map((d, i) => (
          <div key={i} style={{ width: `${ancho}%`, overflow: 'visible', whiteSpace: 'nowrap', fontSize: 10 }}>
            {i % etiquetaCada === 0 ? d.etiqueta : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
