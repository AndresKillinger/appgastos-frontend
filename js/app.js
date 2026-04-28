import { getSummary, getMovements, syncEmail, getCategories, setCategory, getYearlySummary, getYearlyCategoryBreakdown, createCategory, deleteCategory } from './api.js';

// ── Estado global ─────────────────────────────────────────────────────────────
const state = {
  tab: 'resumen',
  anio: new Date().getFullYear(),
  mes: new Date().getMonth() + 1,
  buscar: '',
  orden: 'fecha_desc',   // 'fecha_desc' | 'monto_desc' | 'monto_asc'
  cuenta: '',            // '' todos | 'cc' corriente | 'tc' tarjeta
  categorias: [],
  movimientosList: [],
};

const $ = id => document.getElementById(id);
const fmt = n => '$' + Math.abs(parseInt(n || 0)).toLocaleString('es-CL');
const fmtShort = n => { const v = Math.abs(parseInt(n||0)); return v>=1e6?'$'+(v/1e6).toFixed(1).replace('.0','')+'M':v>=1000?'$'+Math.round(v/1000)+'k':'$'+v; };
const fmtFecha = iso => { const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };
const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MESES_CORTO = ['','Ene','Feb','Mar','Abr','May','Jun',
                     'Jul','Ago','Sep','Oct','Nov','Dic'];

function periodNavHTML(screen) {
  const onMes = screen === 'resumen' ? 'selMesResumen' : 'selMesMov';
  const pills = MESES_CORTO.slice(1).map((n, i) => {
    const mes = i + 1;
    return `<button class="mes-pill${mes === state.mes ? ' mes-pill-active' : ''}" onclick="${onMes}(${mes})">${n}</button>`;
  }).join('');
  return `
    <div class="period-nav">
      <div class="year-row">
        <button class="nav-btn-sm" onclick="prevAnio('${screen}')">◀</button>
        <span class="year-label">${state.anio}</span>
        <button class="nav-btn-sm" onclick="nextAnio('${screen}')">▶</button>
      </div>
      <div class="mes-grid">${pills}</div>
    </div>`;
}

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
    const [d, yearly, stackData] = await Promise.all([
      getSummary(state.anio, state.mes),
      getYearlySummary(state.anio),
      getYearlyCategoryBreakdown(state.anio).catch(() => null),
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

    // Barras mes a mes simples
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

    // Gráfico de barras apiladas vertical por categoría y mes
    const stackRows = stackData
      ? (() => {
          const mesesConDatos = stackData.meses.filter(m => parseInt(m.total) > 0);
          const maxTotal = Math.max(1, ...mesesConDatos.map(m => parseInt(m.total)));
          return mesesConDatos.map(m => {
            const isActual = m.mes === mesActual;
            const pct = Math.round((parseInt(m.total) / maxTotal) * 100);
            const segs = m.categorias.map(c => {
              const info = stackData.categorias[String(c.categoria_id)];
              return `<div class="vstack-seg" style="flex:${parseInt(c.total)};background:${info?.color||'#888888'}" title="${info?.nombre||'Sin cat'}: ${fmt(c.total)}"></div>`;
            }).join('');
            return `
              <div class="vstack-col${isActual?' vstack-col-active':''}" onclick="irAMes(${m.mes})">
                <span class="vstack-total">${fmtShort(m.total)}</span>
                <div class="vstack-bar-wrap">
                  <div class="vstack-bar" style="height:${pct}%">${segs}</div>
                </div>
                <span class="vstack-label">${m.nombre}</span>
              </div>`;
          }).join('') || `<div class="empty" style="padding:8px">Sin datos</div>`;
        })()
      : '';

    el.innerHTML = `
      ${periodNavHTML('resumen')}

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

      ${stackData ? `
      <div class="section-title" style="margin-top:20px">🎯 APILADO POR CATEGORÍA</div>
      <div class="vstack-legend">${
        Object.values(stackData.categorias).map(c =>
          `<span class="vstack-legend-item"><span class="vstack-legend-dot" style="background:${c.color}"></span>${c.nombre}</span>`
        ).join('')
      }</div>
      <div class="vstack-chart">${stackRows}</div>` : ''}
    `;
  } catch(e) {
    el.innerHTML = `<div class="error">Error cargando datos</div>`;
  }
}

window.selMesResumen = mes => { state.mes = mes; loadResumen(); };
window.selMesMov     = mes => { state.mes = mes; loadMovimientos(); };
window.prevAnio  = screen => { state.anio--; screen === 'resumen' ? loadResumen() : loadMovimientos(); };
window.nextAnio  = screen => { state.anio++; screen === 'resumen' ? loadResumen() : loadMovimientos(); };
window.irAMes    = mes  => { state.mes = mes; navigate('movimientos'); };
window.prevMovMes = () => { state.mes--; if (state.mes < 1) { state.mes=12; state.anio--; } loadMovimientos(); };
window.nextMovMes = () => { state.mes++; if (state.mes > 12) { state.mes=1; state.anio++; } loadMovimientos(); };

// ── Pantalla: Movimientos ─────────────────────────────────────────────────────
async function loadMovimientos() {
  const navEl = $('mov-period-nav');
  if (navEl) navEl.innerHTML = periodNavHTML('mov');

  $('mov-list').innerHTML = `<div class="loading">🐌 Cargando...</div>`;

  const desde   = `${state.anio}-${String(state.mes).padStart(2,'0')}-01`;
  const lastDay = new Date(state.anio, state.mes, 0).getDate();
  const hasta   = `${state.anio}-${String(state.mes).padStart(2,'0')}-${lastDay}`;

  try {
    const d = await getMovements({ desde, hasta, cuenta: state.cuenta || undefined, buscar: state.buscar || undefined });
    state.movimientosList = d.data;
    renderMovimientos();
  } catch {
    $('mov-list').innerHTML = `<div class="error">Error cargando movimientos</div>`;
  }
}

const isTarjeta = m => m.cartola_id === 0;

function movCard(m, showDate = false) {
  const cat    = m.categoria;
  const tc     = isTarjeta(m);
  const abono  = m.tipo === 'abono';
  const catBadge = cat
    ? `<div class="cat-badge" style="border-color:${cat.color};color:${cat.color}">${cat.icono} ${cat.nombre}${!cat.es_gasto ? ' ✓' : ''}</div>`
    : `<div class="cat-badge cat-badge-sin">❓ tap para categorizar</div>`;
  const sub = [tc ? '💳 TC' : null, m.sucursal, showDate ? fmtFecha(m.fecha) : ''].filter(Boolean).join(' · ');
  return `
    <div class="mov-item${!cat ? ' mov-sin-cat' : ''}${tc ? ' mov-tc' : ''}${abono ? ' mov-abono' : ''}" onclick="abrirModalDesde(${m.id})">
      <div class="mov-icon">${abono ? '💰' : tc ? '💳' : '💥'}</div>
      <div class="mov-info">
        <div class="mov-desc">${cleanDesc(m.descripcion)}</div>
        ${sub ? `<div class="mov-sub">${sub}</div>` : ''}
        ${catBadge}
      </div>
      <div class="mov-monto ${abono ? 'monto-in' : 'monto-out'}">${abono ? '+' : '-'}${fmt(m.monto)}</div>
    </div>`;
}

function renderMovimientos() {
  const el = $('mov-list');

  // Actualiza botones de orden y cuenta
  document.querySelectorAll('.sort-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.orden === state.orden));
  document.querySelectorAll('.cuenta-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.cuenta === state.cuenta));

  const sinCat = state.movimientosList.filter(m => !m.categoria_id);
  const badge = $('badge-sin-cat');
  if (badge) {
    badge.textContent = sinCat.length > 0 ? `❓ ${sinCat.length} SIN CATEGORIZAR — TAP AQUÍ` : '';
    badge.classList.toggle('hidden', sinCat.length === 0);
  }

  if (!state.movimientosList.length) {
    el.innerHTML = `<div class="empty">Sin gastos este mes</div>`;
    return;
  }

  let lista = [...state.movimientosList];

  if (state.orden === 'monto_desc') {
    lista.sort((a, b) => Math.abs(parseInt(b.monto)) - Math.abs(parseInt(a.monto)));
    el.innerHTML = `<div class="date-group">${lista.map(m => movCard(m, true)).join('')}</div>`;
  } else if (state.orden === 'monto_asc') {
    lista.sort((a, b) => Math.abs(parseInt(a.monto)) - Math.abs(parseInt(b.monto)));
    el.innerHTML = `<div class="date-group">${lista.map(m => movCard(m, true)).join('')}</div>`;
  } else {
    // fecha_desc — agrupado por día
    const grupos = {};
    lista.forEach(m => { if (!grupos[m.fecha]) grupos[m.fecha]=[]; grupos[m.fecha].push(m); });
    el.innerHTML = Object.entries(grupos)
      .sort(([a],[b]) => b.localeCompare(a))
      .map(([fecha, movs]) => `
        <div class="date-group">
          <div class="date-header">📅 ${fmtFecha(fecha)}</div>
          ${movs.map(m => movCard(m)).join('')}
        </div>`).join('');
  }
}

window.setOrden  = (orden)  => { state.orden  = orden;  renderMovimientos(); };
window.setCuenta = (cuenta) => { state.cuenta = cuenta; loadMovimientos(); };

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
  const montoEl = $('modal-monto');
  montoEl.textContent = `${mov.tipo === 'abono' ? '+' : '-'}${fmt(mov.monto)}`;
  montoEl.className = `modal-monto${mov.tipo === 'abono' ? ' modal-monto-abono' : ''}`;
  $('modal-fecha').textContent = `📅 ${fmtFecha(mov.fecha)}`;
  $('modal-contador').textContent = mov.categoria
    ? `${mov.categoria.icono} ${mov.categoria.nombre}`
    : '❓ sin categoría';

  $('cat-grid').innerHTML = state.categorias.map(cat => `
    <div class="cat-btn-wrap">
      <button class="cat-btn ${cat.es_gasto ? '' : 'cat-no-gasto'}"
              onclick="guardarCategoria(${mov.id}, ${cat.id})">
        <div class="cat-btn-img">${mobImg(cat.mob_id, cat.icono, 32)}</div>
        <span class="cat-name" style="color:${cat.color}">${cat.nombre}</span>
      </button>
      ${!cat.es_sistema ? `<button class="cat-del" onclick="eliminarCategoria(event,${cat.id})" title="Eliminar">✕</button>` : ''}
    </div>`).join('');

  $('modal-categoria').classList.remove('hidden');
};

// Optimistic: actualiza estado, avanza al siguiente sin categoría, sincroniza en bg
window.guardarCategoria = async (movId, catId) => {
  const mov = state.movimientosList.find(m => m.id === movId);
  const cat = state.categorias.find(c => c.id === catId);
  const prev = { categoria: mov?.categoria, categoria_id: mov?.categoria_id };

  if (mov) {
    mov.categoria_id = catId;
    mov.categoria = cat ? { nombre: cat.nombre, icono: cat.icono, color: cat.color, es_gasto: cat.es_gasto } : null;
  }
  renderMovimientos();
  showToast(`✓ ${cat?.nombre || 'Guardado'}`);

  // Auto-avance: busca el siguiente sin categoría
  const next = state.movimientosList.find(m => m.id !== movId && !m.categoria_id);
  if (next) {
    abrirModalDesde(next.id);
  } else {
    $('modal-categoria').classList.add('hidden');
    showToast('🍄 ¡Todo categorizado!');
  }

  try {
    await setCategory(movId, catId);
  } catch {
    if (mov) { mov.categoria_id = prev.categoria_id; mov.categoria = prev.categoria; }
    renderMovimientos();
    showToast('Error al guardar', true);
  }
};

window.eliminarCategoria = async (e, catId) => {
  e.stopPropagation();
  const cat = state.categorias.find(c => c.id === catId);
  if (!cat) return;
  try {
    await deleteCategory(catId);
    state.categorias = state.categorias.filter(c => c.id !== catId);
    // Limpiar de movimientos en memoria
    state.movimientosList.forEach(m => { if (m.categoria_id === catId) { m.categoria_id = null; m.categoria = null; } });
    renderMovimientos();
    showToast(`✓ "${cat.nombre}" eliminada`);
    if (window._currentMovId != null) abrirModalDesde(window._currentMovId);
  } catch (err) {
    showToast(err?.message || 'Error al eliminar', true);
  }
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

  $('modal-categoria').addEventListener('click', e => {
    if (e.target === $('modal-categoria')) cerrarModal();
  });

  try { state.categorias = await getCategories(); } catch {}

  navigate('resumen');
});
