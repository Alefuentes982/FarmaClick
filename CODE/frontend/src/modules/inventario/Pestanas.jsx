import { NavLink } from 'react-router-dom';

const pestanas = [
  ['/inventario', 'Stock', 'bi-boxes', true],
  ['/inventario/lotes', 'Lotes y vencimientos', 'bi-calendar-x', false],
  ['/inventario/kardex', 'Kardex', 'bi-journal-text', false],
  ['/inventario/ajuste', 'Registrar ajuste', 'bi-sliders', false],
];

export default function Pestanas() {
  return (
    <ul className="nav nav-pills mb-3">
      {pestanas.map(([to, label, icon, end]) => (
        <li className="nav-item" key={to}>
          <NavLink to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <i className={`bi ${icon} me-1`} />{label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}
