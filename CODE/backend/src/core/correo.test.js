import test from 'node:test';
import assert from 'node:assert/strict';
import { correoConfigurado, correoSchema, cuerpoComprobante, enviarCorreo, reiniciarCorreo } from './correo.js';

test('correoSchema normaliza y valida la dirección', () => {
  assert.equal(correoSchema.parse({ correo: '  Cliente@Example.COM ' }).correo, 'cliente@example.com');
  assert.equal(correoSchema.safeParse({ correo: 'sin-arroba' }).success, false);
  assert.equal(correoSchema.safeParse({ correo: 'a@b' }).success, false);
  assert.equal(correoSchema.safeParse({}).success, false);
  // Un salto de línea en la dirección sería inyección de cabeceras: no pasa la validación.
  assert.equal(correoSchema.safeParse({ correo: 'a@b.cl\r\nBcc: x@y.cl' }).success, false);
});

test('sin SMTP_HOST el envío responde 503 con un mensaje claro', async () => {
  const previo = process.env.SMTP_HOST;
  delete process.env.SMTP_HOST;
  reiniciarCorreo();
  assert.equal(correoConfigurado(), false);
  await assert.rejects(() => enviarCorreo({ para: 'a@b.cl', asunto: 'x', texto: 'y' }), (e) => e.status === 503 && /no está configurado/.test(e.message));
  if (previo) process.env.SMTP_HOST = previo;
});

test('el cuerpo del correo menciona el documento y escapa el HTML', () => {
  const { texto, html } = cuerpoComprobante({ nombre: 'Ana <script>', documento: 'comprobante de su compra', codigo: 'PED-000012', detalle: 'total $3.090' });
  assert.match(texto, /Hola Ana <script>,/);
  assert.match(texto, /comprobante de su compra PED-000012 \(total \$3\.090\)/);
  assert.ok(!html.includes('<script>'), 'el HTML no incluye etiquetas del nombre');
  assert.match(html, /&lt;script&gt;/);
  assert.match(cuerpoComprobante({ nombre: 'Cliente mostrador', documento: 'd', codigo: 'c' }).texto, /^Hola,\n/);
});
