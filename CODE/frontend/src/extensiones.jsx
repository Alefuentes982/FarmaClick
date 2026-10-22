// Puntos de extensión: una pantalla declara un <Slot nombre="..."/> y otros módulos le agregan contenido
// desde su `extensiones: { 'nombre': Componente }`. Así una pantalla de un módulo puede mostrar datos de otro
// (p. ej. la ficha del proveedor muestra sus productos) sin importarlo, y cada módulo se entrega por separado.
const registro = new Map(); // slot -> Map(módulo -> Componente) (por módulo: la recarga en caliente no duplica)

export function registrarExtensiones(modulo, extensiones = {}) {
  Object.entries(extensiones).forEach(([slot, Componente]) => {
    if (!registro.has(slot)) registro.set(slot, new Map());
    registro.get(slot).set(modulo, Componente);
  });
}

export function Slot({ nombre, ...props }) {
  return [...(registro.get(nombre)?.entries() ?? [])].map(([modulo, Componente]) => <Componente key={modulo} {...props} />);
}
