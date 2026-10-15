// Facultades que dependen del ROL (no de un permiso de "Roles y permisos", que el administrador puede repartir).
// Contrato de nombres: los roles 'Administrador' y 'Jefe de local' vienen sembrados y no deben renombrarse.
export const esAdministrador = (user) => user.rol === 'Administrador';
export const esJefeOAdmin = (user) => ['Administrador', 'Jefe de local'].includes(user.rol);

// El Jefe de local opera sobre las cajas de su sucursal (o todas, si no tiene una asignada); el Administrador, sobre todas.
export const operaSobreSucursal = (user, sucursalId) =>
  esAdministrador(user) || (esJefeOAdmin(user) && (!user.sucursal_id || user.sucursal_id === sucursalId));
