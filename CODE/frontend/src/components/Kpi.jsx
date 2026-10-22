import { Link } from 'react-router-dom';

// Tarjeta de indicador (una columna de la grilla). Con `to` es un enlace al detalle.
export default function Kpi({ titulo, valor, sub, clase = '', to, onClick, col = 'col-6 col-lg' }) {
  const cuerpo = (
    <div className="px-3 py-2">
      <div className="fc-kpi-titulo">{titulo}</div>
      <div className={`fc-kpi-valor ${clase}`}>{valor}</div>
      {sub && <div className="small text-muted">{sub}</div>}
    </div>
  );
  return (
    <div className={col}>
      {to && <Link to={to} className="d-block h-100 fc-kpi fc-kpi-alerta text-decoration-none text-reset">{cuerpo}</Link>}
      {!to && onClick && <button type="button" onClick={onClick} className="d-block w-100 h-100 text-start fc-kpi fc-kpi-alerta">{cuerpo}</button>}
      {!to && !onClick && <div className="h-100 fc-kpi">{cuerpo}</div>}
    </div>
  );
}
