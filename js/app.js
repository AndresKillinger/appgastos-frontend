import { getSummary, getMovements, addCreditCard, syncEmail, getCategories, setCategory } from './api.js';

// ── Estado global ─────────────────────────────────────────────────────────────
const state = {
  tab: 'resumen',
  anio: new Date().getFullYear(),
  mes: new Date().getMonth() + 1,
  filtroTipo: '',
  buscar: '',
  categorias: [],
  sinCategorizar: [],
  catIdx: 0,
};

const $ = id => document.getElementById(id);

// ── Formato números ───────────────────────────────────────────────────────────
const fmt = n => {
  const num = Math.abs(parseInt(n || 0));
  return '$' + num.toLocaleString('es-CL');
};

const fmtFecha = iso => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const MESES = ['', 'Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ── Imagen de monstruo con fallback a emoji ───────────────────────────────────
function mobImg(mobId, emoji, size = 36) {
  if (!mobId) return `<span style="font-size:${size}px;line-height:1">${emoji}</span>`;
  return `<img src="https://maplestory.io/api/GMS/latest/mob/${mobId}/render/stand"
    data-emoji="${emoji}"
    onerror="this.outerHTML='<span style=font-size:${size}px;line-height:1 class=mob-emoji>${this.dataset.emoji}</span>'"
    style="width:${size}px;height:${size}px;object-fit:contain;image-rendering:pixelated">`;
}

// ── Navegación ────────────────────────────────────────────────────────────────
function navigate(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('hidden', s.id !== `screen-${tab}`);
  });
  if (tab === 'resumen')     loadResumen();
  if (tab === 'movimientos') loadMovimientos();
}

// ── Pantalla: Resumen ─────────────────────────────────────────────────────────
async function loadResumen() {
  const el = $('resumen-content');
  el.innerHTML = `<div class="loading">🐌 Cargando...</div>`;

  try {
    const d = await getSummary(state.anio, state.mes);
    const balance = parseInt(d.balance);
    const excluido = parseInt(d.total_excluido || 0);
    const balanceColor = balance >= 0 ? 'text-green-400' : 'text-red-400';
    const monsters = ['🍄','🐌','👾','🦀','🐧','🐛','🦎','🐊','🦂','🐙'];

    el.innerHTML = `
      <div class="month-nav">
        <button onclick="prevMes()" class="nav-btn">◀</button>
        <span class="month-title">📅 ${MESES[state.mes]} ${state.anio}</span>
        <button onclick="nextMes()" class="nav-btn">▶</button>
      </div>

      <div class="cards-grid">
        <div class="card card-green">
          <div class="card-label">💰 DROP</div>
          <div class="card-value">${fmt(d.total_abonos)}</div>
        </div>
        <div class="card card-red">
          <div class="card-label">💥 DAÑO REAL</div>
          <div class="card-value">${fmt(d.total_cargos)}</div>
          ${excluido > 0 ? `<div class="card-sub">+${fmt(excluido)} excluido</div>` : ''}
        </div>
      </div>

      <div class="balance-card">
        <div class="card-label">⚔️ MESOS NETOS</div>
        <div class="card-value ${balanceColor}">${balance >= 0 ? '+' : ''}${fmt(d.balance)}</div>
        <div class="card-sub">${d.cantidad_movimientos} movimientos</div>
      </div>

      <div class="section-title">👑 TOP 10 BOSS DROPS</div>
      <div class="top-list">
        ${d.top_10_gastos.map((g, i) => `
          <div class="top-item">
            <span class="top-rank">${monsters[i] || '👾'}</span>
            <div class="top-info">
              <div class="top-desc">${cleanDesc(g.descripcion)}</div>
              <div class="top-date">${fmtFecha(g.fecha)}</div>
            </div>
            <div class="top-monto">-${fmt(g.monto)}</div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<div class="error">Error cargando datos</div>`;
  }
}

window.prevMes = () => {
  state.mes--;
  if (state.mes < 1) { state.mes = 12; state.anio--; }
  loadResumen();
};
window.nextMes = () => {
  state.mes++;
  if (state.mes > 12) { state.mes = 1; state.anio++; }
  loadResumen();
};

// ── Pantalla: Movimientos ─────────────────────────────────────────────────────
async function loadMovimientos() {
  const el = $('mov-list');
  el.innerHTML = `<div class="loading">🐌 Cargando...</div>`;

  const desde = `${state.anio}-${String(state.mes).padStart(2,'0')}-01`;
  const lastDay = new Date(state.anio, state.mes, 0).getDate();
  const hasta = `${state.anio}-${String(state.mes).padStart(2,'0')}-${lastDay}`;

  try {
    const d = await getMovements({
      desde,
      hasta,
      tipo: state.filtroTipo || undefined,
      buscar: state.buscar || undefined,
    });

    // Detectar sin categorizar
    checkUncategorized(d.data);

    if (!d.data.length) {
      el.innerHTML = `<div class="empty">Sin movimientos</div>`;
      return;
    }

    const grupos = {};
    d.data.forEach(m => {
      if (!grupos[m.fecha]) grupos[m.fecha] = [];
      grupos[m.fecha].push(m);
    });

    el.innerHTML = Object.entries(grupos)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([fecha, movs]) => `
        <div class="date-group">
          <div class="date-header">📅 ${fmtFecha(fecha)}</div>
          ${movs.map(m => {
            const cat = m.categoria;
            const catBadge = cat
              ? `<div class="cat-badge" style="border-color:${cat.color};color:${cat.color}">${cat.icono} ${cat.nombre}${!cat.es_gasto ? ' ✓' : ''}</div>`
              : (m.tipo === 'cargo' ? `<div class="cat-badge cat-badge-sin" onclick="abrirModalDesde(${m.id})">❓ categorizar</div>` : '');
            return `
            <div class="mov-item">
              <div class="mov-icon">${m.tipo === 'abono' ? '💰' : '💥'}</div>
              <div class="mov-info">
                <div class="mov-desc">${cleanDesc(m.descripcion)}</div>
                <div class="mov-sub">${m.sucursal || m.cuenta || ''}</div>
                ${catBadge}
              </div>
              <div class="mov-monto ${m.tipo === 'abono' ? 'monto-in' : 'monto-out'}">
                ${m.tipo === 'abono' ? '+' : '-'}${fmt(m.monto)}
              </div>
            </div>`;
          }).join('')}
        </div>
      `).join('');
  } catch (e) {
    el.innerHTML = `<div class="error">Error cargando movimientos</div>`;
  }
}

// ── Filtros movimientos ───────────────────────────────────────────────────────
window.setFiltro = tipo => {
  state.filtroTipo = state.filtroTipo === tipo ? '' : tipo;
  document.querySelectorAll('.filtro-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tipo === state.filtroTipo);
  });
  loadMovimientos();
};

window.onBuscar = e => {
  state.buscar = e.target.value;
  clearTimeout(window._buscarTimer);
  window._buscarTimer = setTimeout(loadMovimientos, 400);
};

window.onMesMovChange = e => {
  const [y, m] = e.target.value.split('-');
  state.anio = parseInt(y);
  state.mes = parseInt(m);
  loadMovimientos();
};

// ── Sistema de categorización ─────────────────────────────────────────────────
function checkUncategorized(movimientos) {
  state.sinCategorizar = movimientos.filter(m => m.tipo === 'cargo' && !m.categoria_id);
  const badge = $('badge-sin-cat');
  if (!badge) return;
  if (state.sinCategorizar.length > 0) {
    badge.textContent = `❓ ${state.sinCategorizar.length} SIN CATEGORIZAR`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

window.abrirModalCategoria = () => {
  if (state.sinCategorizar.length === 0) return;
  state.catIdx = 0;
  mostrarMovEnModal();
  $('modal-categoria').classList.remove('hidden');
};

window.abrirModalDesde = (movId) => {
  // Abrir modal directamente en un movimiento específico
  const idx = state.sinCategorizar.findIndex(m => m.id === movId);
  state.catIdx = idx >= 0 ? idx : 0;
  mostrarMovEnModal();
  $('modal-categoria').classList.remove('hidden');
};

function mostrarMovEnModal() {
  const mov = state.sinCategorizar[state.catIdx];
  if (!mov) {
    $('modal-categoria').classList.add('hidden');
    loadMovimientos();
    if (state.tab === 'resumen') loadResumen();
    return;
  }

  $('modal-contador').textContent = `${state.catIdx + 1} / ${state.sinCategorizar.length}`;
  $('modal-desc').textContent = cleanDesc(mov.descripcion);
  $('modal-monto').textContent = `-${fmt(mov.monto)}`;
  $('modal-fecha').textContent = `📅 ${fmtFecha(mov.fecha)}`;

  const grid = $('cat-grid');
  grid.innerHTML = state.categorias.map(cat => `
    <button class="cat-btn ${cat.es_gasto ? '' : 'cat-no-gasto'}"
            onclick="seleccionarCategoria(${mov.id}, ${cat.id})"
            title="${cat.nombre}">
      <div class="cat-btn-img">${mobImg(cat.mob_id, cat.icono, 32)}</div>
      <span class="cat-name" style="color:${cat.color}">${cat.nombre}</span>
    </button>
  `).join('');
}

window.seleccionarCategoria = async (movId, catId) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  try {
    await setCategory(movId, catId);
    state.catIdx++;
    mostrarMovEnModal();
  } catch {
    btn.disabled = false;
    showToast('Error al guardar', true);
  }
};

window.omitirCategoria = () => {
  state.catIdx++;
  mostrarMovEnModal();
};

window.cerrarModal = () => {
  $('modal-categoria').classList.add('hidden');
  loadMovimientos();
};

// ── Pantalla: Agregar (tarjeta crédito) ──────────────────────────────────────
async function submitTarjeta(e) {
  e.preventDefault();
  const btn = $('btn-agregar');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    await addCreditCard({
      fecha: $('input-fecha').value,
      descripcion: $('input-desc').value,
      monto: parseInt($('input-monto').value),
    });
    $('form-tc').reset();
    $('input-fecha').value = new Date().toISOString().split('T')[0];
    showToast('🍄 Gasto agregado!');
  } catch {
    showToast('Error al guardar', true);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚔️ GUARDAR GASTO';
  }
}

// ── Sync ──────────────────────────────────────────────────────────────────────
window.syncData = async () => {
  const btn = $('btn-sync');
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    const d = await syncEmail();
    const nuevas = (d.procesados || []).filter(p => !p.error).length;
    showToast(nuevas > 0 ? `🍄 ${nuevas} cartola(s) nueva(s)!` : '🐌 Sin cartolas nuevas');
    if (nuevas > 0) loadResumen();
  } catch {
    showToast('Error al sincronizar', true);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄';
  }
};

// ── Utilidades ────────────────────────────────────────────────────────────────
function cleanDesc(desc) {
  return (desc || '')
    .replace(/^\d{10,}\s*/, '')
    .replace(/^0+(\d)/, '$1')
    .trim() || desc;
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
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => navigate(b.dataset.tab));
  });

  const mesInput = $('mes-selector');
  if (mesInput) mesInput.value = `${state.anio}-${String(state.mes).padStart(2,'0')}`;

  const fechaInput = $('input-fecha');
  if (fechaInput) fechaInput.value = new Date().toISOString().split('T')[0];

  $('form-tc').addEventListener('submit', submitTarjeta);

  // Cargar categorías antes de navegar
  try {
    state.categorias = await getCategories();
  } catch {}

  navigate('resumen');
});
