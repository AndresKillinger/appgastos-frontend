import { getSummary, getMovements, addCreditCard, syncEmail } from './api.js';

// ── Estado global ─────────────────────────────────────────────────────────────
const state = {
  tab: 'resumen',
  anio: new Date().getFullYear(),
  mes: new Date().getMonth() + 1,
  filtroTipo: '',
  buscar: '',
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

// ── Navegación ────────────────────────────────────────────────────────────────
function navigate(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('hidden', s.id !== `screen-${tab}`);
  });
  if (tab === 'resumen')    loadResumen();
  if (tab === 'movimientos') loadMovimientos();
}

// ── Pantalla: Resumen ─────────────────────────────────────────────────────────
async function loadResumen() {
  const el = $('resumen-content');
  el.innerHTML = `<div class="loading">Cargando...</div>`;

  try {
    const d = await getSummary(state.anio, state.mes);
    const balance = parseInt(d.balance);
    const balanceColor = balance >= 0 ? 'text-green-400' : 'text-red-400';

    el.innerHTML = `
      <div class="month-nav">
        <button onclick="prevMes()" class="nav-btn">‹</button>
        <span class="month-title">${MESES[state.mes]} ${state.anio}</span>
        <button onclick="nextMes()" class="nav-btn">›</button>
      </div>

      <div class="cards-grid">
        <div class="card card-green">
          <div class="card-label">Abonos</div>
          <div class="card-value">${fmt(d.total_abonos)}</div>
        </div>
        <div class="card card-red">
          <div class="card-label">Cargos</div>
          <div class="card-value">${fmt(d.total_cargos)}</div>
        </div>
      </div>

      <div class="balance-card">
        <div class="card-label">Balance del mes</div>
        <div class="card-value ${balanceColor}">${balance >= 0 ? '+' : ''}${fmt(d.balance)}</div>
        <div class="card-sub">${d.cantidad_movimientos} movimientos</div>
      </div>

      <div class="section-title">Top 10 gastos</div>
      <div class="top-list">
        ${d.top_10_gastos.map((g, i) => `
          <div class="top-item">
            <span class="top-rank">${i + 1}</span>
            <div class="top-info">
              <div class="top-desc">${cleanDesc(g.descripcion)}</div>
              <div class="top-date">${fmtFecha(g.fecha)}</div>
            </div>
            <div class="top-monto">${fmt(g.monto)}</div>
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
  el.innerHTML = `<div class="loading">Cargando...</div>`;

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

    if (!d.data.length) {
      el.innerHTML = `<div class="empty">Sin movimientos</div>`;
      return;
    }

    // Agrupar por fecha
    const grupos = {};
    d.data.forEach(m => {
      if (!grupos[m.fecha]) grupos[m.fecha] = [];
      grupos[m.fecha].push(m);
    });

    el.innerHTML = Object.entries(grupos)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([fecha, movs]) => `
        <div class="date-group">
          <div class="date-header">${fmtFecha(fecha)}</div>
          ${movs.map(m => `
            <div class="mov-item">
              <div class="mov-icon ${m.tipo === 'abono' ? 'icon-in' : 'icon-out'}">
                ${m.tipo === 'abono' ? '↓' : '↑'}
              </div>
              <div class="mov-info">
                <div class="mov-desc">${cleanDesc(m.descripcion)}</div>
                <div class="mov-sub">${m.sucursal || m.cuenta || ''}</div>
              </div>
              <div class="mov-monto ${m.tipo === 'abono' ? 'monto-in' : 'monto-out'}">
                ${m.tipo === 'abono' ? '+' : '-'}${fmt(m.monto)}
              </div>
            </div>
          `).join('')}
        </div>
      `).join('');
  } catch (e) {
    el.innerHTML = `<div class="error">Error cargando movimientos</div>`;
  }
}

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
    showToast('Gasto agregado');
  } catch {
    showToast('Error al guardar', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar gasto';
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

// ── Utilidades ────────────────────────────────────────────────────────────────
function cleanDesc(desc) {
  return (desc || '')
    .replace(/^\d{10,}\s*/, '')  // quitar N°DCTO al inicio
    .replace(/^0+(\d)/, '$1')    // quitar ceros iniciales
    .trim() || desc;
}

function showToast(msg, error = false) {
  const t = document.createElement('div');
  t.className = `toast ${error ? 'toast-error' : 'toast-ok'}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ── Sync ──────────────────────────────────────────────────────────────────────
window.syncData = async () => {
  const btn = $('btn-sync');
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    const d = await syncEmail();
    const nuevas = (d.procesados || []).filter(p => !p.error).length;
    showToast(nuevas > 0 ? `${nuevas} cartola(s) nueva(s)` : 'Sin cartolas nuevas');
    if (nuevas > 0) loadResumen();
  } catch {
    showToast('Error al sincronizar', true);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄';
  }
};

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }

  // Navegación
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => navigate(b.dataset.tab));
  });

  // Mes selector en movimientos
  const mesInput = $('mes-selector');
  if (mesInput) {
    mesInput.value = `${state.anio}-${String(state.mes).padStart(2,'0')}`;
  }

  // Fecha por defecto en formulario
  const fechaInput = $('input-fecha');
  if (fechaInput) fechaInput.value = new Date().toISOString().split('T')[0];

  // Form tarjeta
  $('form-tc').addEventListener('submit', submitTarjeta);

  // Pantalla inicial
  navigate('resumen');
});
