const BASE = 'https://appgastos-backend.onrender.com/api/v1';

export async function getSummary(anio, mes) {
  const r = await fetch(`${BASE}/summary?anio=${anio}&mes=${mes}`);
  return r.json();
}

export async function getMovements({ desde, hasta, tipo, cuenta, buscar, categoria_id, limite = 200 } = {}) {
  const params = new URLSearchParams();
  if (desde)                   params.set('desde', desde);
  if (hasta)                   params.set('hasta', hasta);
  if (tipo)                    params.set('tipo', tipo);
  if (cuenta)                  params.set('cuenta', cuenta);
  if (buscar)                  params.set('buscar', buscar);
  if (categoria_id !== undefined) params.set('categoria_id', categoria_id);
  params.set('limite', limite);
  const r = await fetch(`${BASE}/movements?${params}`);
  return r.json();
}

export async function addApplePay({ descripcion, monto, fecha }) {
  const body = { descripcion, monto: Math.abs(monto), cuenta: 'apple-pay' };
  if (fecha) body.fecha = fecha;
  const r = await fetch(`${BASE}/movements/apple-pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function addManual({ descripcion, monto, fecha, tipo = 'cargo' }) {
  const body = { descripcion, monto: Math.abs(monto), tipo, cuenta: 'manual' };
  if (fecha) body.fecha = fecha;
  const r = await fetch(`${BASE}/movements/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function getCategories() {
  const r = await fetch(`${BASE}/categories`);
  return r.json();
}

export async function setCategory(movId, catId) {
  const r = await fetch(`${BASE}/movements/${movId}/category`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoria_id: catId }),
  });
  return r.json();
}

export async function getYearlySummary(anio) {
  const r = await fetch(`${BASE}/summary/yearly?anio=${anio}`);
  return r.json();
}

export async function getYearlyCategoryBreakdown(anio) {
  const r = await fetch(`${BASE}/summary/yearly/categories?anio=${anio}`);
  return r.json();
}

export async function syncEmail() {
  const r = await fetch(`${BASE}/sync`, { method: 'POST' });
  return r.json();
}

export async function deleteCategory(catId) {
  const r = await fetch(`${BASE}/categories/${catId}`, { method: 'DELETE' });
  return r.json();
}

export async function createCategory({ nombre, icono, es_gasto, color }) {
  const r = await fetch(`${BASE}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, icono, es_gasto, color }),
  });
  return r.json();
}

export async function uploadPdfTC(pdfFile, rut) {
  const form = new FormData();
  form.append('pdf', pdfFile);
  const r = await fetch(`${BASE}/upload-pdf?tipo=tc&rut=${encodeURIComponent(rut)}`, {
    method: 'POST',
    body: form,
  });
  return r.json();
}

export async function deleteMovement(movId) {
  const r = await fetch(`${BASE}/movements/${movId}`, { method: 'DELETE' });
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
