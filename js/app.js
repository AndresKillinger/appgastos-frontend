import { getSummary, getMovements, addCreditCard, syncEmail, getCategories, setCategory, getYearlySummary, createCategory } from './api.js';

// ── Estado global ─────────────────────────────────────────────────────────────
const state = {
  tab: 'resumen',
  anio: new Date().getFullYear(),
  mes: new Date().getMonth() + 1,
  buscar: '',
  categorias: [],
  movimientosList: [],
};

const $ = id => document.getElementById(id);
const fmt = n => '$' + Math.abs(parseInt(n || 0)).toLocaleString('es-CL');
const fmtFecha = iso => { const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };
const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_CORTO = ['','Ene','Feb','Mar','Abr','May','Jun',
                     'Jul','Ago','Sep','Oct','Nov','Dic'];

function mobImg(mobId, emoji, size = 28) {
  if (!mobId) return `<span style="font-size:${size}px;line-height:1">${emoji}</span>`;
  return `<img src="https://maplestory.io/api/GMS/latest/mob/${mobId}/render/stand"
    onerror="this.outerHTML='<span style=font-size:${size}px;line-height:1>${emoji}</span>'"
    style="width:${size}px;height:${size}px;object-fit:contain;image-rendering:pixelated;flex-shrink:0">`;
}

// ── Navegación ────────────────────────────────────────────────────────────────
function navigate(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.screen').forEach(s =>
    s.classList.toggle('hidden', s.id !== `screen-${tab}`));
  if (tab === 'resumen')     loadResumen();
  if (tab === 'movimientos') loadMovimientos();
}

// ── Pantalla: Resumen ─────────────────────────────────────────────────────────
async function loadResumen() {
  const el = $('resumen-content');
  el.innerHTML = `<div class="loading">🐌 Cargando...</div>`;
  try {
    const [d, yearly] = await Promise.all([
      getSummary(state.anio, state.mes),
      getYearlySummary(state.anio),
    ]);

    const totalGasto = parseInt(d.total_cargos);
    const excluido   = parseInt(d.total_excluido || 0);

    // Barras de categorías
    const maxCat = Math.max(1, ...d.by_category.map(c => parseInt(c.total)));
    const catRows = d.by_category.map(c => {
      const pct = Math.round((parseInt(c.total) / maxCat) * 100);
      return `
        <div class="cat-row">
          <div class="cat-row-icon">${mobImg(c.mob_id, c.icono, 26)}</div>
          <div class="cat-row-body">
            <div class="cat-row-header">
              <span class="cat-row-name" style="color:${c.color}">${c.nombre}</span>
              <span class="cat-row-total">${fmt(c.total)}</span>
            </div>
            <div class="cat-bar-bg">
              <div class="cat-bar-fill" style="width:${pct}%;background:${c.color}"></div>
            </div>
            <span class="cat-row-count">${c.count} mov.</span>
          </div>
        </div>`;
    }).join('') || `<div class="empty" style="padding:16px">Sin gastos este mes</div>`;

    // Barras mes a mes
    const maxMes = Math.max(1, ...yearly.meses.map(m => parseInt(m.total)));
    const mesActual = state.mes;
    const mesRows = yearly.meses.map(m => {
      const pct = Math.round((parseInt(m.total) / maxMes) * 100);
      const isActual = m.mes === mesActual;
      return `
        <div class="mes-row ${isActual ? 'mes-actual' : ''}" onclick="irAMes(${m.mes})">
          <span class="mes-row-label">${m.nombre}</span>
          <div class="mes-bar-bg">
            <div class="mes-bar-fill" style="width:${pct}%;${isActual ? 'background:var(--gold)' : ''}"></div>
          </div>
          <span class="mes-row-total">${parseInt(m.total) > 0 ? fmt(m.total) : '—'}</span>
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="month-nav">
        <button onclick="prevMes()" class="nav-btn">◀</button>
        <span class="month-title">📅 ${MESES[state.mes]} ${state.anio}</span>
        <button onclick="nextMes()" class="nav-btn">▶</button>
      </div>

      <div class="total-card">
        <div class="total-label">💥 GASTO DEL MES</div>
        <div class="total-value">${fmt(totalGasto)}</div>
        ${excluido > 0 ? `<div class="total-excluido">+${fmt(excluido)} excluido (inversiones/no-gasto)</div>` : ''}
        <div class="total-sub">${d.cantidad_movimientos} cargos</div>
      </div>

      <div class="section-title">📊 GASTO POR CATEGORÍA</div>
      <div class="cat-list">${catRows}</div>

      <div class="section-title" style="margin-top:20px">📅 ${state.anio} MES A MES</div>
      <div class="mes-list">${mesRows}</div>
    `;
  } catch(e) {
    el.innerHTML = `<div class="error">Error cargando datos</div>`;
  }
}

window.prevMes    = () => { state.mes--; if (state.mes < 1) { state.mes=12; state.anio--; } loadResumen(); };
window.nextMes    = () => { state.mes++; if (state.mes > 12) { state.mes=1; state.anio++; } loadResumen(); };
window.irAMes     = (mes) => { state.mes = mes; navigate('movimientos'); };
window.prevMovMes = () => { state.mes--; if (state.mes < 1) { state.mes=12; state.anio--; } loadMovimientos(); };
window.nextMovMes = () => { state.mes++; if (state.mes > 12) { state.mes=1; state.anio++; } loadMovimientos(); };

// ── Pantalla: Movimientos (solo cargos) ───────────────────────────────────────
async function loadMovimientos() {
  const el = $('mov-list');
  el.innerHTML = `<div class="loading">🐌 Cargando...</div>`;

  const titleEl = $('mov-month-title');
  if (titleEl) titleEl.textContent = `📅 ${MESES[state.mes]} ${state.anio}`;

  const desde   = `${state.anio}-${String(state.mes).padStart(2,'0')}-01`;
  const lastDay = new Date(state.anio, state.mes, 0).getDate();
  const hasta   = `${state.anio}-${String(state.mes).padStart(2,'0')}-${lastDay}`;

  try {
    const d = await getMovements({
      desde, hasta,
      tipo: 'cargo',   // solo cargos, siempre
      buscar: state.buscar || undefined,
    });

    state.movimientosList = d.data;

    const sinCat = d.data.filter(m => !m.categoria_id);
    const badge = $('badge-sin-cat');
    if (badge) {
      badge.textContent = sinCat.length > 0 ? `❓ ${sinCat.length} SIN CATEGORIZAR — TAP AQUÍ` : '';
      badge.classList.toggle('hidden', sinCat.length === 0);
    }

    if (!d.data.length) { el.innerHTML = `<div class="empty">Sin gastos este mes</div>`; return; }

    const grupos = {};
    d.data.forEach(m => { if (!grupos[m.fecha]) grupos[m.fecha]=[]; grupos[m.fecha].push(m); });

    el.innerHTML = Object.entries(grupos)
      .sort(([a],[b]) => b.localeCompare(a))
      .map(([fecha, movs]) => `
        <div class="date-group">
          <div class="date-header">📅 ${fmtFecha(fecha)}</div>
          ${movs.map(m => {
            const cat = m.categoria;
            const catBadge = cat
              ? `<div class="cat-badge" style="border-color:${cat.color};color:${cat.color}">${cat.icono} ${cat.nombre}${!cat.es_gasto ? ' ✓' : ''}</div>`
              : `<div class="cat-badge cat-badge-sin">❓ tap para categorizar</div>`;
            return `
            <div class="mov-item${!cat ? ' mov-sin-cat' : ''}" onclick="abrirModalDesde(${m.id})">
              <div class="mov-icon">💥</div>
              <div class="mov-info">
                <div class="mov-desc">${cleanDesc(m.descripcion)}</div>
                <div class="mov-sub">${m.sucursal || ''}</div>
                ${catBadge}
              </div>
              <div class="mov-monto monto-out">-${fmt(m.monto)}</div>
            </div>`;
          }).join('')}
        </div>`).join('');
  } catch {
    el.innerHTML = `<div class="error">Error cargando movimientos</div>`;
  }
}

window.onBuscar = e => {
  state.buscar = e.target.value;
  clearTimeout(window._buscarTimer);
  window._buscarTimer = setTimeout(loadMovimientos, 400);
};

// ── Modal de categorización ───────────────────────────────────────────────────
window.abrirModalCategoria = () => {
  const primero = state.movimientosList.find(m => !m.categoria_id);
  if (primero) abrirModalDesde(primero.id);
};

window.abrirModalDesde = (movId) => {
  const mov = state.movimientosList.find(m => m.id === movId);
  if (!mov) return;
  window._currentMovId = movId;

  $('modal-desc').textContent  = cleanDesc(mov.descripcion);
  $('modal-monto').textContent = `-${fmt(mov.monto)}`;
  $('modal-fecha').textContent = `📅 ${fmtFecha(mov.fecha)}`;
  $('modal-contador').textContent = mov.categoria
    ? `${mov.categoria.icono} ${mov.categoria.nombre}`
    : '❓ sin categoría';

  $('cat-grid').innerHTML = state.categorias.map(cat => `
    <button class="cat-btn ${cat.es_gasto ? '' : 'cat-no-gasto'}"
            onclick="guardarCategoria(${mov.id}, ${cat.id})">
      <div class="cat-btn-img">${mobImg(cat.mob_id, cat.icono, 32)}</div>
      <span class="cat-name" style="color:${cat.color}">${cat.nombre}</span>
    </button>`).join('');

  $('modal-categoria').classList.remove('hidden');
};

window.guardarCategoria = async (movId, catId) => {
  try {
    await setCategory(movId, catId);
    $('modal-categoria').classList.add('hidden');
    showToast('✓ Categoría guardada');
    loadMovimientos();
  } catch { showToast('Error al guardar', true); }
};

window.cerrarModal = () => $('modal-categoria').classList.add('hidden');

window.omitirCategoria = () => {
  const idx = state.movimientosList.findIndex(m => m.id === window._currentMovId);
  const next = state.movimientosList.slice(idx + 1).find(m => !m.categoria_id);
  if (next) abrirModalDesde(next.id);
  else { cerrarModal(); showToast('✓ Todo categorizado'); }
};

window.toggleNuevaCat = () => $('nueva-cat-form').classList.toggle('hidden');

window.guardarNuevaCat = async () => {
  const nombre = $('nc-nombre').value.trim();
  const icono  = $('nc-icono').value.trim() || '❓';
  const es_gasto = $('nc-es-gasto').checked;
  const color  = $('nc-color').value;
  if (!nombre) { showToast('Pon un nombre', true); return; }
  try {
    const cat = await createCategory({ nombre, icono, es_gasto, color });
    state.categorias.push(cat);
    $('nueva-cat-form').classList.add('hidden');
    $('nc-nombre').value = '';
    showToast('✓ Categoría creada');
    if (window._currentMovId != null) abrirModalDesde(window._currentMovId);
  } catch { showToast('Error al crear', true); }
};

// ── Pantalla: Agregar ─────────────────────────────────────────────────────────
async function submitTarjeta(e) {
  e.preventDefault();
  const btn = $('btn-agregar');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    await addCreditCard({
      fecha: $('input-fecha').value,
      descripcion: $('input-desc').value,
      monto: parseInt($('input-monto').value),
    });
    $('form-tc').reset();
    $('input-fecha').value = new Date().toISOString().split('T')[0];
    showToast('🍄 Gasto agregado!');
  } catch { showToast('Error al guardar', true); }
  finally { btn.disabled = false; btn.textContent = '⚔️ GUARDAR GASTO'; }
}

// ── Sync ──────────────────────────────────────────────────────────────────────
window.syncData = async () => {
  const btn = $('btn-sync');
  btn.disabled = true; btn.textContent = '⏳';
  try {
    const d = await syncEmail();
    const nuevas = (d.procesados || []).filter(p => !p.error).length;
    showToast(nuevas > 0 ? `🍄 ${nuevas} cartola(s) nueva(s)!` : '🐌 Sin cartolas nuevas');
    if (nuevas > 0) loadResumen();
  } catch { showToast('Error al sincronizar', true); }
  finally { btn.disabled = false; btn.textContent = '🔄'; }
};

// ── Utilidades ────────────────────────────────────────────────────────────────
function cleanDesc(desc) {
  return (desc || '').replace(/^\d{10,}\s*/,'').replace(/^0+(\d)/,'$1').trim() || desc;
}
function showToast(msg, error = false) {
  const t = document.createElement('div');
  t.className = `toast ${error ? 'toast-error' : 'toast-ok'}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');

  document.querySelectorAll('.tab-btn').forEach(b =>
    b.addEventListener('click', () => navigate(b.dataset.tab)));

  const fechaInput = $('input-fecha');
  if (fechaInput) fechaInput.value = new Date().toISOString().split('T')[0];

  $('form-tc').addEventListener('submit', submitTarjeta);
  $('modal-categoria').addEventListener('click', e => {
    if (e.target === $('modal-categoria')) cerrarModal();
  });

  try { state.categorias = await getCategories(); } catch {}

  navigate('resumen');
});
