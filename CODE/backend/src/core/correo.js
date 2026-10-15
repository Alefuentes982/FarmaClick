// Envío de correos con adjuntos (comprobantes). Usa SMTP configurable por variables de entorno, así sirve con
// cualquier proveedor (Gmail con contraseña de aplicación, Outlook, Brevo, Resend, un SMTP propio…):
//   SMTP_HOST, SMTP_PORT (587 por defecto), SMTP_SECURE (true si el puerto es 465), SMTP_USER, SMTP_PASS, SMTP_FROM
// Sin SMTP_HOST el envío está deshabilitado y la API lo informa con un 503 claro; el resto del sistema no cambia.
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { HttpError } from './errors.js';

export const correoSchema = z.object({
  correo: z.string().trim().toLowerCase().email('Escriba un correo válido.').max(150),
});

export const correoConfigurado = () => Boolean(process.env.SMTP_HOST);

let transporte = null;
const obtenerTransporte = () => {
  if (!transporte) {
    const puerto = Number(process.env.SMTP_PORT) || 587;
    transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: puerto,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : puerto === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporte;
};

// Para pruebas: reinicia el transporte si cambia la configuración.
export const reiniciarCorreo = () => { transporte = null; };

/** @param {{para:string, asunto:string, texto:string, html?:string, adjuntos?:{filename:string, content:Buffer, contentType?:string}[]}} m */
export async function enviarCorreo({ para, asunto, texto, html, adjuntos = [] }) {
  if (!correoConfigurado()) {
    throw new HttpError(503, 'El envío de correos no está configurado en el servidor (falta SMTP_HOST). Pida a un administrador que lo configure.');
  }
  const empresa = process.env.EMPRESA_NOMBRE || 'FarmaClick';
  try {
    await obtenerTransporte().sendMail({
      from: process.env.SMTP_FROM || `${empresa} <${process.env.SMTP_USER}>`,
      to: para, subject: asunto, text: texto, html, attachments: adjuntos,
    });
  } catch (err) {
    // No se expone el detalle del servidor de correo al cliente; queda en el log del backend.
    console.error('Error al enviar correo:', err.message);
    throw new HttpError(502, 'No se pudo enviar el correo. Revise la dirección y la configuración del servidor de correo.');
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Cuerpo estándar de un correo con un comprobante adjunto.
export function cuerpoComprobante({ nombre, documento, codigo, detalle }) {
  const empresa = process.env.EMPRESA_NOMBRE || 'FarmaClick';
  const saludo = nombre && nombre !== 'Cliente mostrador' ? `Hola ${nombre},` : 'Hola,';
  const texto = `${saludo}\n\nAdjuntamos el ${documento} ${codigo}${detalle ? ` (${detalle})` : ''}.\n\nGracias por preferirnos.\n${empresa}\n\nEste documento no es tributario.`;
  const html = `<p>${esc(saludo)}</p><p>Adjuntamos el ${esc(documento)} <strong>${esc(codigo)}</strong>${detalle ? ` (${esc(detalle)})` : ''}.</p>`
    + `<p>Gracias por preferirnos.<br><strong>${esc(empresa)}</strong></p><p style="color:#6c757d;font-size:12px">Este documento no es tributario.</p>`;
  return { texto, html };
}
