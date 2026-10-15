// Facultades por rol (las mismas reglas que valida el backend en core/roles.js y la base de datos).
export const esAdministrador = (user) => user?.rol === 'Administrador';
export const esJefeOAdmin = (user) => ['Administrador', 'Jefe de local'].includes(user?.rol);
