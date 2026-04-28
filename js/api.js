const BASE = 'https://appgastos-backend.onrender.com/api/v1';

export async function getSummary(anio, mes) {
  const r = await fetch(`${BASE}/summary?anio=${anio}&mes=${mes}`);
  return r.json();
}

export async function getMovements({ desde, hasta, tipo, buscar, limite = 200 } = {}) {
  const params = new URLSearchParams();
  if (desde)  params.set('desde', desde);
  if (hasta)  params.set('hasta', hasta);
  if (tipo)   params.set('tipo', tipo);
  if (buscar) params.set('buscar', buscar);
  params.set('limite', limite);
  const r = await fetch(`${BASE}/movements?${params}`);
  return r.json();
}

export async function addCreditCard({ fecha, descripcion, monto }) {
  const r = await fetch(`${BASE}/movements/credit-card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha, descripcion, monto: Math.abs(monto), tipo: 'cargo', cuenta: 'tarjeta-credito' }),
  });
  return r.json();
}
