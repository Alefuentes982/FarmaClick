import { useState } from 'react';
import { api } from '../api.js';

// Envía un comprobante por correo: pide la dirección y llama a la ruta de la API (POST { correo }).
//   ruta: '/pos/ventas/ID/enviar' | '/pedidos/ID/enviar' | '/devoluciones/ID/enviar'
//   correoInicial: dirección sugerida (p. ej. la última usada); onEnviado(correo) opcional.
export default function EnviarCorreo({ ruta, correoInicial = '', onEnviado, compacto = false }) {
  const [correo, setCorreo] = useState(correoInicial);
  const [estado, setEstado] = useState({ tipo: null, texto: '' });
  const enviando = estado.tipo === 'enviando';

  const enviar = async (e) => {
    e.preventDefault();
    if (enviando) return;
    setEstado({ tipo: 'enviando', texto: '' });
    try {
      const r = await api.post(ruta, { correo: correo.trim() });
      setEstado({ tipo: 'ok', texto: `Comprobante enviado a ${r.enviado_a}.` });
      onEnviado?.(r.enviado_a);
    } catch (err) {
      const detalle = err.details?.[0]?.message;
      setEstado({ tipo: 'error', texto: detalle ?? err.message });
    }
  };

  return (
    <form onSubmit={enviar} className={compacto ? '' : 'w-100'} style={{ maxWidth: 560 }}>
      <div className="input-group">
        <span className="input-group-text"><i className="bi bi-envelope" /></span>
        <input type="email" className="form-control" placeholder="correo@cliente.cl" required maxLength={150}
          aria-label="Correo del cliente" value={correo}
          onChange={(e) => { setCorreo(e.target.value); if (estado.tipo !== 'enviando') setEstado({ tipo: null, texto: '' }); }} />
        <button className="btn btn-primary" disabled={enviando || !correo.trim()}>
          {enviando ? 'Enviando…' : 'Enviar comprobante'}
        </button>
      </div>
      {estado.tipo === 'ok' && <div className="text-success small mt-1"><i className="bi bi-check-circle me-1" />{estado.texto}</div>}
      {estado.tipo === 'error' && <div className="text-danger small mt-1"><i className="bi bi-exclamation-circle me-1" />{estado.texto}</div>}
    </form>
  );
}
