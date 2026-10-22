import { app } from './app.js';
import { iniciarTareasCaja } from './modules/cuadratura/avisos.js';

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`FarmaClick API escuchando en http://localhost:${port}`));

// Cierre automático de cajas (23:59) y recordatorios por correo. Ver modules/cuadratura/avisos.js.
iniciarTareasCaja();
