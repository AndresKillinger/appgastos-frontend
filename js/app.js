import { getSummary, getMovements, syncEmail, getCategories, setCategory, getYearlySummary, getYearlyCategoryBreakdown, createCategory, deleteCategory, addManual, deleteMovement } from './api.js';

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
  lineYears: [new Date().getFullYear()], // años seleccionados para el line chart
  visibleLineCats: new Set(),            // categoria_ids visibles en el line chart (vacío = ninguno)
  lineZoom: 1,                           // 1, 2, 4, 10 — zoom Y del line chart
  lineYearsDataCache: null,              // cache para re-renderizar sin volver a fetchar
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
  const mesOpts = MESES_CORTO.slice(1).map((n, i) => {
    const mes = i + 1;
    return `<div class="mes-option${mes === state.mes ? ' selected' : ''}" onclick="selMes('${screen}',${mes})">${n}</div>`;
  }).join('');
  const years = [2025, 2026, 2027, 2028, 2029];
  const yearOpts = years.map(y =>
    `<div class="mes-option${y === state.anio ? ' selected' : ''}" onclick="selAnio('${screen}',${y})">${y}</div>`
  ).join('');
  return `
    <div class="period-nav">
      <button class="nav-btn-sm" onclick="prevMes('${screen}')">◀</button>
      <div class="mes-dropdown" id="mes-dd-${screen}">
        <button class="mes-trigger" onclick="togglePeriodMenu('mes-dd-${screen}',event)">
          <span>${MESES[state.mes]}</span><span class="mes-arrow">▾</span>
        </button>
        <div class="mes-menu hidden">${mesOpts}</div>
      </div>
      <div class="mes-dropdown anio-dropdown" id="anio-dd-${screen}">
        <button class="mes-trigger anio-trigger" onclick="togglePeriodMenu('anio-dd-${screen}',event)">
          <span>${state.anio}</span><span class="mes-arrow">▾</span>
        </button>
        <div class="mes-menu mes-menu-anio hidden">${yearOpts}</div>
      </div>
      <button class="nav-btn-sm" onclick="nextMes('${screen}')">▶</button>
    </div>`;
}

window.togglePeriodMenu = (id, e) => {
  if (e) e.stopPropagation();
  const dd = $(id);
  if (!dd) return;
  document.querySelectorAll('.mes-dropdown.open').forEach(d => {
    if (d !== dd) { d.classList.remove('open'); d.querySelector('.mes-menu')?.classList.add('hidden'); }
  });
  const open = dd.classList.toggle('open');
  dd.querySelector('.mes-menu').classList.toggle('hidden', !open);
};

const closeAllDropdowns = () => {
  document.querySelectorAll('.mes-dropdown.open').forEach(d => {
    d.classList.remove('open'); d.querySelector('.mes-menu')?.classList.add('hidden');
  });
};

const _reloadFor = (screen) => {
  if (screen === 'resumen') return loadResumen();
  if (screen === 'plan')    return loadPlan();
  return loadMovimientos();
};

window.selMes = (screen, mes) => {
  state.mes = mes;
  closeAllDropdowns();
  _reloadFor(screen);
};

window.selAnio = (screen, anio) => {
  state.anio = anio;
  closeAllDropdowns();
  _reloadFor(screen);
};

window.prevMes = screen => {
  state.mes--;
  if (state.mes < 1) { state.mes = 12; state.anio--; }
  _reloadFor(screen);
};

window.nextMes = screen => {
  state.mes++;
  if (state.mes > 12) { state.mes = 1; state.anio++; }
  _reloadFor(screen);
};

document.addEventListener('click', e => {
  if (!e.target.closest('.mes-dropdown')) closeAllDropdowns();
});

// Paleta vibrante de fallback — usada cuando una categoría tiene el color
// por defecto (#888888) o ninguno. Determinística por id/nombre para que
// el mismo cat tenga siempre el mismo color.
const CAT_PALETTE = [
  '#ff4d6a', '#ff7733', '#ffb938', '#ffe34d',
  '#4dffa6', '#2dffd1', '#5cc6ff', '#5b8bff',
  '#a35bff', '#d864ff', '#ff5bd1', '#ff5b9b',
  '#7bff5b', '#5bd1ff'
];
const _isDefaultColor = c => !c || /^#?(8{3}|8{6})$/i.test(String(c).replace('#',''));
const CUSTOM_COLORS_KEY = 'maple-cat-colors';
let customCatColors = {};
try { customCatColors = JSON.parse(localStorage.getItem(CUSTOM_COLORS_KEY) || '{}'); } catch {}

// Presupuestos por categoría: { catId: monto_mensual_en_pesos }
const BUDGETS_KEY = 'maple-budgets';
let catBudgets = {};
try { catBudgets = JSON.parse(localStorage.getItem(BUDGETS_KEY) || '{}'); } catch {}

// Necesario vs deseable por categoría: { catId: 'nec' | 'des' }
const NECDES_KEY = 'maple-necdes';
let catNecDes = {};
try { catNecDes = JSON.parse(localStorage.getItem(NECDES_KEY) || '{}'); } catch {}

function pickColor(cid, color) {
  const key = String(cid ?? 'sin');
  if (customCatColors[key]) return customCatColors[key];
  if (color && !_isDefaultColor(color)) return color;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return CAT_PALETTE[Math.abs(h) % CAT_PALETTE.length];
}

window.setCatColor = (cid, hex) => {
  const key = String(cid);
  customCatColors[key] = hex;
  try { localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(customCatColors)); } catch {}
  if (typeof renderLineChartSection === 'function') renderLineChartSection();
};

// Construye un SVG de líneas: una línea por categoría a través de los meses (multi-año concatenado).
// `yearsData` = array de respuestas de getYearlyCategoryBreakdown ordenadas por año asc.
function buildLineChartSVG(yearsData) {
  if (!yearsData.length) return '';

  // Aplanar a serie cronológica de puntos: { label, anio, mes, byCat: {cid: total} }
  const series = [];
  yearsData.forEach(yd => {
    if (!yd) return;
    yd.meses.forEach(m => {
      const byCat = {};
      m.categorias.forEach(c => { byCat[c.categoria_id] = parseInt(c.total); });
      series.push({
        anio: yd.anio,
        mes: m.mes,
        label: `${m.nombre.slice(0,3)} ${String(yd.anio).slice(2)}`,
        byCat,
      });
    });
  });
  if (!series.length) return '<div class="empty" style="padding:8px">Sin datos</div>';

  // Categorías presentes (unión de todas las breakdowns) + total acumulado para rankear
  const catInfo = {};
  const catTotals = {};
  yearsData.forEach(yd => {
    if (!yd) return;
    Object.entries(yd.categorias).forEach(([cid, c]) => { catInfo[cid] = c; });
  });
  series.forEach(p => Object.entries(p.byCat).forEach(([cid, v]) => {
    catTotals[cid] = (catTotals[cid] || 0) + v;
  }));

  // Top 8 categorías por total. El usuario las activa una a una desde la leyenda.
  const allCats = Object.entries(catTotals)
    .sort((a,b) => b[1]-a[1])
    .slice(0, 8)
    .map(([cid]) => cid);
  const visibleCats = allCats.filter(cid => state.visibleLineCats.has(cid));

  // SVG layout
  const W = 360, H = 220;
  const padL = 42, padR = 14, padT = 14, padB = 38;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const N = series.length;
  const xStep = N > 1 ? innerW / (N - 1) : innerW;

  const autoMax = Math.max(1, ...series.flatMap(p => visibleCats.map(cid => p.byCat[cid] || 0)));
  const zoom = state.lineZoom || 1;
  const maxVal = autoMax / zoom;

  // Grid y eje Y (5 líneas: 0, 25%, 50%, 75%, 100% del max)
  const yLevels = [0, maxVal * 0.25, maxVal * 0.5, maxVal * 0.75, maxVal];
  const grid = yLevels.map((v) => {
    const y = padT + innerH - (v / maxVal) * innerH;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(120,120,255,.13)" stroke-dasharray="2 3"/>
            <text x="${padL - 4}" y="${y + 3}" text-anchor="end" fill="#b3b3dd" font-family="VT323" font-size="10">${fmtShort(v)}</text>`;
  }).join('');

  // Líneas por categoría (solo las visibles). Cuando zoom > 1, los valores que exceden
  // se clampan al tope del eje (padT) para indicar visualmente que están fuera de rango.
  const lines = visibleCats.map(cid => {
    const cat = catInfo[cid];
    const color = pickColor(cid, cat?.color);
    const pts = series.map((p, i) => {
      const x = padL + i * xStep;
      const v = p.byCat[cid] || 0;
      const y = Math.max(padT, padT + innerH - (v / maxVal) * innerH);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const dots = series.map((p, i) => {
      const x = padL + i * xStep;
      const v = p.byCat[cid] || 0;
      const overflow = v > maxVal;
      const y = Math.max(padT, padT + innerH - (v / maxVal) * innerH);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${overflow ? 1.5 : 2.4}" fill="${color}" opacity="${overflow ? 0.5 : 1}"><title>${cat?.nombre || 'Sin cat'} · ${p.label}: ${fmt(v)}${overflow ? ' (fuera de rango)' : ''}</title></circle>`;
    }).join('');
    return `<polyline points="${pts}" stroke="${color}" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round" filter="url(#lineGlow)"/>${dots}`;
  }).join('');

  // X-axis labels — para no saturar, mostrar máx ~12 etiquetas
  const labelEvery = Math.max(1, Math.ceil(N / 12));
  const xLabels = series.map((p, i) => {
    if (i % labelEvery !== 0 && i !== N - 1) return '';
    const x = padL + i * xStep;
    return `<text x="${x.toFixed(1)}" y="${H - 22}" text-anchor="middle" fill="#b3b3dd" font-family="VT323" font-size="10">${p.label.slice(0,3)}</text>
            <text x="${x.toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="#9999cc" font-family="VT323" font-size="9">'${p.label.slice(-2)}</text>`;
  }).join('');

  // Leyenda interactiva
  // - Toca el círculo de color → abre selector de color (HTML5 native picker)
  // - Toca el nombre → muestra/oculta la línea
  const legend = allCats.map(cid => {
    const cat = catInfo[cid];
    const color = pickColor(cid, cat?.color);
    const isVisible = state.visibleLineCats.has(cid);
    return `<div class="line-legend-item${isVisible ? '' : ' hidden-cat'}">
      <input type="color" class="line-legend-dot-input" value="${color}"
        onchange="setCatColor('${cid}', this.value)"
        onclick="event.stopPropagation()"
        title="Cambiar color"
        aria-label="Color de ${cat?.nombre || 'categoría'}">
      <button class="line-legend-name-btn" onclick="toggleLineCat('${cid}')">${cat?.nombre || 'Sin cat'}</button>
    </div>`;
  }).join('');

  const chartArea = visibleCats.length === 0
    ? `<div class="line-empty">
        <div class="line-empty-icon">📈</div>
        <div>Toca una categoría en la leyenda<br>para empezar a ver el gráfico</div>
      </div>`
    : `<svg class="line-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
        <defs>
          <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.4" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        ${grid}
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" stroke="rgba(120,120,255,.3)"/>
        <line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="rgba(120,120,255,.3)"/>
        ${lines}
        ${xLabels}
      </svg>`;

  return `
    ${chartArea}
    <div class="line-legend">${legend}</div>
  `;
}

function lineYearSelectorHTML() {
  const years = [2025, 2026, 2027, 2028, 2029];
  return years.map(y => {
    const active = state.lineYears.includes(y);
    return `<button class="line-year-pill${active ? ' active' : ''}" onclick="toggleLineYear(${y})">${y}</button>`;
  }).join('');
}

function lineZoomSelectorHTML() {
  const opts = [1, 2, 4, 10];
  return opts.map(z => {
    const active = (state.lineZoom || 1) === z;
    return `<button class="line-zoom-pill${active ? ' active' : ''}" onclick="setLineZoom(${z})">${z}×</button>`;
  }).join('');
}

// Re-renderiza solo el line chart (controles + gráfico) usando el cache de datos.
// Así al togglear categorías, zoom o cambiar color NO se recarga toda la pantalla
// y se preserva la posición de scroll.
function renderLineChartSection() {
  const el = document.getElementById('line-chart-section');
  if (!el) return;
  const data = state.lineYearsDataCache || [];
  el.innerHTML = `
    <div class="line-controls">
      <div class="line-year-pills">${lineYearSelectorHTML()}</div>
      <div class="line-zoom-row">
        <span class="line-zoom-label">Zoom Y</span>
        <div class="line-zoom-pills">${lineZoomSelectorHTML()}</div>
      </div>
    </div>
    <div class="chart-card">${buildLineChartSVG(data)}</div>
  `;
}

window.setLineZoom = (z) => {
  state.lineZoom = z;
  renderLineChartSection();
};

window.toggleLineCat = (cid) => {
  const key = String(cid);
  if (state.visibleLineCats.has(key)) state.visibleLineCats.delete(key);
  else state.visibleLineCats.add(key);
  renderLineChartSection();
};

window.toggleLineYear = async (y) => {
  const i = state.lineYears.indexOf(y);
  if (i >= 0) {
    if (state.lineYears.length === 1) return; // siempre debe quedar al menos uno
    state.lineYears.splice(i, 1);
  } else {
    state.lineYears.push(y);
  }
  state.lineYears.sort();
  // Re-fetch solo los años de la línea, sin volver a recargar todo el resumen
  state.lineYearsDataCache = await Promise.all(
    state.lineYears.map(yy => getYearlyCategoryBreakdown(yy).catch(() => null))
  );
  renderLineChartSection();
};

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
  if (tab === 'plan')        loadPlan();
  if (tab === 'movimientos') loadMovimientos();
}

// ── Pantalla: Resumen ─────────────────────────────────────────────────────────
async function loadResumen() {
  const el = $('resumen-content');
  el.innerHTML = `<div class="loading">🐌 Cargando...</div>`;
  try {
    // Asegurar que el año actualmente seleccionado esté en lineYears (mejor UX al cambiar de año)
    if (!state.lineYears.includes(state.anio)) state.lineYears.push(state.anio);
    state.lineYears.sort();
    // Últimos 3 meses para promedio histórico (mejor que solo el mes anterior)
    const monthsBack = [];
    for (let i = 1; i <= 3; i++) {
      let m = state.mes - i, a = state.anio;
      while (m < 1) { m += 12; a -= 1; }
      monthsBack.push({ a, m });
    }
    const prevMes  = monthsBack[0].m;
    const prevAnio = monthsBack[0].a;

    const [d, yearly, stackData, ...rest] = await Promise.all([
      getSummary(state.anio, state.mes),
      getYearlySummary(state.anio),
      getYearlyCategoryBreakdown(state.anio).catch(() => null),
      ...monthsBack.map(({a,m}) => getSummary(a, m).catch(() => null)),
      ...state.lineYears.map(y => getYearlyCategoryBreakdown(y).catch(() => null)),
    ]);
    const prevSummaries = rest.slice(0, monthsBack.length);
    const lineYearsData = rest.slice(monthsBack.length);
    state.lineYearsDataCache = lineYearsData;

    // Promedio últimos 3 meses por categoría
    const prevByCat = {};
    const validPrevs = prevSummaries.filter(s => s);
    if (validPrevs.length > 0) {
      const sumByCat = {};
      for (const s of validPrevs) {
        for (const c of (s.by_category || [])) {
          const cid = c.categoria_id ?? 0;
          sumByCat[cid] = (sumByCat[cid] || 0) + (parseInt(c.total) || 0);
        }
      }
      for (const [cid, sum] of Object.entries(sumByCat)) {
        prevByCat[cid] = Math.round(sum / validPrevs.length);
      }
    }
    const prevTotalNeto = validPrevs.length > 0
      ? Math.round(validPrevs.reduce((acc, s) => acc + (parseInt(s.gasto_neto ?? s.total_cargos) || 0), 0) / validPrevs.length)
      : 0;
    const prevD = prevSummaries[0];  // se mantiene para el label "vs Mes X"
    const promLabel = validPrevs.length === 1
      ? `vs ${MESES[prevMes]}`
      : `vs prom. últimos ${validPrevs.length} meses`;

    const totalGasto  = parseInt(d.total_cargos);
    const totalAbonos = parseInt(d.total_abonos || 0);
    const gastoNeto   = parseInt(d.gasto_neto ?? d.total_cargos);
    const excluido    = parseInt(d.total_excluido || 0);

    // Helper de delta vs mes anterior
    // Devuelve { text, klass } o null si no hay comparación útil
    const buildDelta = (currVal, prevVal) => {
      const curr = parseInt(currVal) || 0;
      const prev = parseInt(prevVal) || 0;
      if (prev === 0 && curr === 0) return null;
      if (prev === 0) return { text: 'NUEVO', klass: 'delta-new', diff: curr, pct: null };
      if (curr === 0) return { text: '— sin gasto', klass: 'delta-down', diff: -prev, pct: -100 };
      const diff = curr - prev;
      const pct = Math.round((diff / prev) * 100);
      const sign = pct > 0 ? '+' : '';
      return {
        text: `${pct > 0 ? '↑' : pct < 0 ? '↓' : '='} ${sign}${pct}%`,
        klass: pct > 5 ? 'delta-up' : pct < -5 ? 'delta-down' : 'delta-flat',
        diff, pct,
      };
    };

    // Barras de categorías
    const maxCat = Math.max(1, ...d.by_category.map(c => parseInt(c.total)));
    const catRows = d.by_category.map(c => {
      const pct = Math.round((parseInt(c.total) / maxCat) * 100);
      const cid = c.categoria_id ?? 0;
      const color = pickColor(cid, c.color);
      const delta = buildDelta(c.total, prevByCat[cid]);
      const deltaBadge = delta
        ? `<span class="delta-badge ${delta.klass}" title="${prevByCat[cid] !== undefined ? 'Mes anterior: ' + fmt(prevByCat[cid]) : 'No había gasto el mes anterior'}">${delta.text}</span>`
        : '';
      return `
        <div class="cat-row" onclick="toggleCatDetail(${cid},${state.mes},${state.anio})">
          <div class="cat-row-icon">${mobImg(c.mob_id, c.icono, 26)}</div>
          <div class="cat-row-body">
            <div class="cat-row-header">
              <span class="cat-row-name" style="color:${color}">${c.nombre}</span>
              <span class="cat-row-total">${fmt(c.total)}</span>
            </div>
            <div class="cat-bar-bg">
              <div class="cat-bar-fill" style="width:${pct}%;background:${color}"></div>
            </div>
            <div class="cat-row-footer">
              <span class="cat-row-count">${c.count} mov. ▼</span>
              ${deltaBadge}
            </div>
          </div>
        </div>
        <div id="cat-detail-${cid}" class="cat-detail hidden"></div>`;
    }).join('') || `<div class="empty" style="padding:16px">Sin gastos este mes</div>`;

    // Top categorías que más subieron vs mes anterior (alertas)
    const topMovers = d.by_category
      .map(c => {
        const cid = c.categoria_id ?? 0;
        const prev = prevByCat[cid] || 0;
        const curr = parseInt(c.total) || 0;
        const delta = buildDelta(curr, prev);
        return { ...c, cid, prev, curr, delta };
      })
      .filter(c => c.delta && c.delta.diff > 0 && (c.delta.pct === null || c.delta.pct >= 20) && c.delta.diff >= 5000)
      .sort((a, b) => b.delta.diff - a.delta.diff)
      .slice(0, 5);

    const topMoversHTML = (validPrevs.length > 0 && topMovers.length > 0) ? `
      <div class="section-title" style="margin-top:20px">🚨 SUBIERON ${promLabel}</div>
      <div class="section-sub">Categorías que crecieron — apúntale a estas si quieres bajar el gasto.</div>
      <div class="movers-list">
        ${topMovers.map(c => {
          const color = pickColor(c.cid, c.color);
          const isNew = c.delta.pct === null;
          const pctText = isNew ? 'NUEVO' : `+${c.delta.pct}%`;
          return `
            <div class="mover-row" onclick="toggleCatDetail(${c.cid},${state.mes},${state.anio})">
              <div class="mover-icon">${mobImg(c.mob_id, c.icono, 24)}</div>
              <div class="mover-body">
                <div class="mover-name" style="color:${color}">${c.nombre}</div>
                <div class="mover-detail">${isNew ? 'No había gasto' : fmt(c.prev)} → <b>${fmt(c.curr)}</b></div>
              </div>
              <div class="mover-delta">
                <div class="mover-pct">${pctText}</div>
                <div class="mover-diff">+${fmt(c.delta.diff)}</div>
              </div>
            </div>`;
        }).join('')}
      </div>` : '';

    // Barras mes a mes — totales + estadísticas año
    const mesNums = yearly.meses.map(m => parseInt(m.total));
    const maxMes = Math.max(1, ...mesNums);
    const mesesConGasto = mesNums.filter(v => v > 0);
    const totalAnio = mesNums.reduce((a,b) => a+b, 0);
    const promedio  = mesesConGasto.length ? Math.round(totalAnio / mesesConGasto.length) : 0;
    const mesMaxIdx = mesNums.indexOf(maxMes);
    const mesActual = state.mes;
    const mesRows = yearly.meses.map(m => {
      const pct = Math.round((parseInt(m.total) / maxMes) * 100);
      const isActual = m.mes === mesActual;
      return `
        <div class="mes-row ${isActual ? 'mes-actual' : ''}" onclick="irAMes(${m.mes})">
          <span class="mes-row-label">${m.nombre}</span>
          <div class="mes-bar-bg">
            <div class="mes-bar-fill" style="width:${pct}%"></div>
          </div>
          <span class="mes-row-total">${parseInt(m.total) > 0 ? fmt(m.total) : '—'}</span>
        </div>`;
    }).join('');

    // Gráfico de barras apiladas vertical por categoría y mes
    let stackTotalAnio = 0;
    const catTotalsAnio = {};
    if (stackData) {
      stackData.meses.forEach(m => {
        m.categorias.forEach(c => {
          const v = parseInt(c.total);
          stackTotalAnio += v;
          catTotalsAnio[c.categoria_id] = (catTotalsAnio[c.categoria_id] || 0) + v;
        });
      });
    }

    const stackRows = stackData
      ? (() => {
          const mesesConDatos = stackData.meses.filter(m => parseInt(m.total) > 0);
          const maxTotal = Math.max(1, ...mesesConDatos.map(m => parseInt(m.total)));
          // Altura aprox del area de barras: 200px chart - ~22px total - ~18px label = ~160px
          const BAR_AREA_PX = 160;
          return mesesConDatos.map(m => {
            const isActual = m.mes === mesActual;
            const pct = Math.round((parseInt(m.total) / maxTotal) * 100);
            const segs = m.categorias.map(c => {
              const valor = parseInt(c.total);
              const info = stackData.categorias[String(c.categoria_id)];
              const color = pickColor(c.categoria_id, info?.color);
              const segHeight = (valor / maxTotal) * BAR_AREA_PX;
              const showName = segHeight >= 18;
              const showBoth = segHeight >= 30;
              const nombre = info?.nombre || 'Sin cat';
              const inner = showBoth
                ? `<span class="vstack-seg-name">${nombre}</span><span class="vstack-seg-amt">${fmtShort(valor)}</span>`
                : showName ? `<span class="vstack-seg-name">${nombre}</span>` : '';
              return `<div class="vstack-seg" style="flex:${valor};background:${color}" title="${nombre}: ${fmt(valor)}">${inner}</div>`;
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

    // Leyenda enriquecida con totales por categoría
    const stackLegend = stackData
      ? Object.entries(stackData.categorias)
          .map(([cid, c]) => ({ cid, ...c, total: catTotalsAnio[cid] || 0, _color: pickColor(cid, c.color) }))
          .sort((a,b) => b.total - a.total)
          .map(c => `
            <span class="vstack-legend-item">
              <span class="vstack-legend-dot" style="background:${c._color};color:${c._color}"></span>
              <span class="vstack-legend-name">${c.nombre}</span>
            </span>`).join('')
      : '';

    el.innerHTML = `
      ${periodNavHTML('resumen')}

      <div class="total-card">
        <div class="total-label">💥 GASTO DEL MES</div>
        <div class="total-value">${fmt(gastoNeto)}</div>
        ${(() => {
          const td = buildDelta(gastoNeto, prevTotalNeto);
          if (!td || validPrevs.length === 0) return '';
          const sign = (td.diff || 0) > 0 ? '+' : '';
          return `<div class="total-delta ${td.klass}">
            ${td.text} <span class="total-delta-abs">(${sign}${fmt(td.diff)} ${promLabel})</span>
          </div>`;
        })()}
        ${totalAbonos > 0 ? `<div class="total-excluido" style="color:var(--green)">-${fmt(totalAbonos)} reembolsado</div>` : ''}
        ${excluido > 0 ? `<div class="total-excluido">+${fmt(excluido)} excluido</div>` : ''}
        <div class="total-sub">${d.cantidad_movimientos} cargos${totalAbonos > 0 ? ` · bruto ${fmt(totalGasto)}` : ''}</div>
      </div>

      <div class="section-title">📊 GASTO POR CATEGORÍA</div>
      <div class="section-sub">Toca una categoría para ver sus movimientos del mes. La pill al lado muestra la variación ${promLabel}.</div>
      <div class="cat-list">${catRows}</div>

      ${topMoversHTML}

      <div class="section-title" style="margin-top:22px">📅 ${state.anio} MES A MES</div>
      <div class="section-sub">
        Total año <b>${fmt(totalAnio)}</b> · Promedio mensual <b>${fmt(promedio)}</b> · Máximo
        <b>${MESES[mesMaxIdx+1] || '—'} ${maxMes>0?fmtShort(maxMes):''}</b>
      </div>
      <div class="mes-axis-label"><span>$0</span><span>${fmtShort(maxMes)}</span></div>
      <div class="mes-list">${mesRows}</div>

      ${stackData ? (() => {
        const maxStack = Math.max(1, ...stackData.meses.map(m=>parseInt(m.total)));
        return `
      <div class="section-title" style="margin-top:22px">🎯 APILADO POR CATEGORÍA</div>
      <div class="section-sub">Cada columna es un mes. La altura es el gasto y los colores son las categorías. Toca para ir al detalle.</div>
      <div class="chart-card">
        <div class="vstack-chart-area">
          <div class="vstack-yaxis">
            <span>${fmtShort(maxStack)}</span>
            <span>${fmtShort(maxStack/2)}</span>
            <span>$0</span>
          </div>
          <div class="vstack-chart">${stackRows}</div>
        </div>
        <div class="vstack-legend" style="margin-top:14px;border-bottom:none;padding-bottom:0">${stackLegend}</div>
      </div>`;
      })() : ''}

      <div class="section-title" style="margin-top:22px">📈 EVOLUCIÓN POR CATEGORÍA</div>
      <div class="section-sub">Cada línea es una categoría a través de los meses. Selecciona uno o varios años para comparar.</div>
      <div id="line-chart-section">
        <div class="line-controls">
          <div class="line-year-pills">${lineYearSelectorHTML()}</div>
          <div class="line-zoom-row">
            <span class="line-zoom-label">Zoom Y</span>
            <div class="line-zoom-pills">${lineZoomSelectorHTML()}</div>
          </div>
        </div>
        <div class="chart-card">${buildLineChartSVG(lineYearsData)}</div>
      </div>
    `;
  } catch(e) {
    el.innerHTML = `<div class="error">Error cargando datos</div>`;
  }
}

window.toggleCatDetail = async (catId, mes, anio) => {
  const el = $(`cat-detail-${catId}`);
  if (!el) return;
  if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = `<div class="cat-detail-row" style="color:var(--muted)">🐌 Cargando...</div>`;
  try {
    const desde = `${anio}-${String(mes).padStart(2,'0')}-01`;
    const hasta  = `${anio}-${String(mes).padStart(2,'0')}-${new Date(anio, mes, 0).getDate()}`;
    const d = await getMovements({ desde, hasta, categoria_id: catId, limite: 100 });
    if (!d.data?.length) { el.innerHTML = `<div class="cat-detail-row" style="color:var(--muted)">Sin movimientos</div>`; return; }
    el.innerHTML = d.data.map(m => {
      const abono = m.tipo === 'abono';
      return `<div class="cat-detail-row">
        <span class="cat-detail-fecha">${fmtFecha(m.fecha)}</span>
        <span class="cat-detail-desc">${cleanDesc(m.descripcion)}</span>
        <span class="cat-detail-monto${abono ? ' cat-detail-abono' : ''}">${abono ? '+' : ''}${fmt(m.monto)}</span>
      </div>`;
    }).join('');
  } catch { el.innerHTML = `<div class="cat-detail-row" style="color:var(--red)">Error</div>`; }
};

window.irAMes = mes => { state.mes = mes; navigate('movimientos'); };

// ── Pantalla: Plan ────────────────────────────────────────────────────────────

const DOW_NAMES = ['DOM','LUN','MAR','MIE','JUE','VIE','SAB'];

function calcProjection(gastoActual, anio, mes, avgPrev = 0) {
  const today = new Date();
  const isCurrentMonth = anio === today.getFullYear() && mes === (today.getMonth()+1);
  const lastDay = new Date(anio, mes, 0).getDate();
  if (!isCurrentMonth) {
    return { proyectado: gastoActual, dayOfMonth: lastDay, lastDay, finished: true, linear: gastoActual, smart: false };
  }
  const dayOfMonth = today.getDate();
  const progress = dayOfMonth / lastDay;
  // Extrapolación lineal pura (el método "ingenuo")
  const linear = Math.round(gastoActual / Math.max(1, dayOfMonth) * lastDay);

  if (avgPrev <= 0) {
    // Sin historial → solo podemos usar la extrapolación lineal
    return { proyectado: linear, linear, dayOfMonth, lastDay, finished: false, smart: false };
  }

  // Blend ponderado: más peso al ritmo actual a medida que avanza el mes.
  // progress^1.5 es cauto al principio (día 1: ~0.6% peso lineal, día 30: 100%).
  const weightLinear = Math.pow(progress, 1.5);
  let blended = Math.round(weightLinear * linear + (1 - weightLinear) * avgPrev);

  // Tope: nunca proyectar más de 2× el promedio histórico (cap contra spikes absurdos)
  blended = Math.min(blended, Math.round(avgPrev * 2));
  // Piso: nunca menos de lo que ya gastaste
  blended = Math.max(blended, gastoActual);

  return {
    proyectado: blended,
    linear,
    dayOfMonth,
    lastDay,
    finished: false,
    smart: true,
    avgPrev,
    weightLinearPct: Math.round(weightLinear * 100),
  };
}

function topMerchants(movs, n = 10) {
  const grouped = {};
  for (const m of movs) {
    if (m.tipo !== 'cargo') continue;
    const key = cleanDesc(m.descripcion).toLowerCase().replace(/\d+/g,'').trim().slice(0, 40);
    if (!key) continue;
    if (!grouped[key]) grouped[key] = { name: cleanDesc(m.descripcion), total: 0, count: 0 };
    grouped[key].total += Math.abs(parseInt(m.monto));
    grouped[key].count += 1;
  }
  return Object.values(grouped).sort((a,b) => b.total - a.total).slice(0, n);
}

function dayOfWeekTotals(movs) {
  const tot = [0,0,0,0,0,0,0];
  for (const m of movs) {
    if (m.tipo !== 'cargo') continue;
    // Parse "YYYY-MM-DD" como local para evitar shift de timezone
    const [y, mo, d] = m.fecha.split('-').map(Number);
    const dow = new Date(y, mo-1, d).getDay();
    tot[dow] += Math.abs(parseInt(m.monto));
  }
  return tot;
}

async function loadPlan() {
  const el = $('plan-content');
  el.innerHTML = `<div class="loading">🐌 Cargando...</div>`;
  try {
    const desde = `${state.anio}-${String(state.mes).padStart(2,'0')}-01`;
    const lastDay = new Date(state.anio, state.mes, 0).getDate();
    const hasta = `${state.anio}-${String(state.mes).padStart(2,'0')}-${lastDay}`;

    // 3 meses anteriores para promedio histórico
    const monthsBack = [];
    for (let i = 1; i <= 3; i++) {
      let m = state.mes - i, a = state.anio;
      while (m < 1) { m += 12; a -= 1; }
      monthsBack.push({ a, m });
    }

    const [d, movsResp, ...prevSummaries] = await Promise.all([
      getSummary(state.anio, state.mes),
      getMovements({ desde, hasta, limite: 500 }),
      ...monthsBack.map(({a,m}) => getSummary(a, m).catch(() => null)),
    ]);

    const movs = movsResp.data || [];
    const gastoNeto = parseInt(d.gasto_neto ?? d.total_cargos) || 0;

    // ── 1. Header con periodNav + botón agregar gasto

    // ── 2. Proyección
    const promPrev3 = prevSummaries.filter(s => s).map(s => parseInt(s.gasto_neto ?? s.total_cargos) || 0);
    const promAvg = promPrev3.length ? Math.round(promPrev3.reduce((a,b)=>a+b,0) / promPrev3.length) : 0;
    const proj = calcProjection(gastoNeto, state.anio, state.mes, promAvg);
    const { proyectado, dayOfMonth, finished, linear, smart, weightLinearPct } = proj;

    let projDiff = null, projDiffPct = null;
    if (promAvg > 0) {
      projDiff = proyectado - promAvg;
      projDiffPct = Math.round((projDiff / promAvg) * 100);
    }
    const projLevel = promAvg > 0
      ? (projDiffPct > 20 ? 'proj-danger' : projDiffPct > 0 ? 'proj-warn' : '')
      : '';
    const projPct = promAvg > 0 ? Math.min(150, Math.round(proyectado / promAvg * 100)) : 0;

    // Si la lineal pura difiere mucho del blended (>30%), mostramos un aviso
    const linearDifference = smart && linear > proyectado * 1.3
      ? `<div style="font-size:11px;color:var(--muted);margin-top:6px;font-style:italic">
          (Ritmo lineal puro proyectaría ${fmt(linear)}, pero ajustamos con tu historial — confianza actual ${weightLinearPct}%)
         </div>`
      : '';

    // Suma de presupuestos por categoría (para marcador en la barra de proyección)
    const sumCatBudgets = Object.entries(catBudgets)
      .filter(([k]) => k !== '_total')
      .reduce((s, [_, v]) => s + (parseInt(v) || 0), 0);

    // Posición del marcador en la barra (0-150% del promedio histórico)
    let budgetMarker = '';
    if (promAvg > 0 && sumCatBudgets > 0) {
      const markerPct = Math.min(150, Math.round(sumCatBudgets / promAvg * 100));
      budgetMarker = `
        <div class="proj-marker" style="left:${(markerPct / 150) * 100}%">
          <div class="proj-marker-line"></div>
          <div class="proj-marker-label">🎯 ${fmtShort(sumCatBudgets)}<br><span>tu tope</span></div>
        </div>`;
    }

    const projHTML = `
      <div class="proj-card ${projLevel}">
        <div class="proj-label">${finished ? '💥 GASTO TOTAL DEL MES' : '🔮 PROYECCIÓN FIN DE MES'}</div>
        <div class="proj-value">${fmt(proyectado)}</div>
        <div class="proj-sub">
          ${finished ? 'Mes cerrado.' : `Vas en <b>${fmt(gastoNeto)}</b> al día ${dayOfMonth} de ${lastDay}.`}
          ${promAvg > 0
            ? ` Promedio últimos ${promPrev3.length} meses: <b>${fmt(promAvg)}</b>${projDiffPct !== null
              ? ` (${projDiffPct > 0 ? '↑' : projDiffPct < 0 ? '↓' : '='} ${projDiffPct > 0 ? '+' : ''}${projDiffPct}%)`
              : ''}`
            : ' (no hay datos previos para comparar)'}
        </div>
        ${linearDifference}
        ${promAvg > 0 ? `
          <div class="proj-progress-wrap">
            <div class="proj-progress"><div class="proj-progress-fill" style="width:${(projPct / 150) * 100}%"></div></div>
            ${budgetMarker}
          </div>
          <div class="proj-progress-scale">
            <span>0</span>
            <span style="left:66.67%">${fmtShort(promAvg)} (100%)</span>
            <span style="right:0">${fmtShort(promAvg * 1.5)} (150%)</span>
          </div>` : ''}
      </div>`;

    // ── 3. Presupuestos por categoría
    const budgetCats = state.categorias.filter(c => c.es_gasto && catBudgets[c.id] > 0);
    const budgetByCat = {}; d.by_category.forEach(c => { budgetByCat[c.categoria_id] = parseInt(c.total) || 0; });

    // 3a. Presupuesto TOTAL (independiente de los por-categoría)
    const totalBudget = catBudgets['_total'] || 0;
    let totalBudgetHTML = '';
    if (totalBudget > 0) {
      const segmentsRaw = d.by_category
        .filter(c => parseInt(c.total) > 0)
        .map(c => ({
          cid: c.categoria_id ?? 0,
          name: c.nombre,
          color: pickColor(c.categoria_id ?? 0, c.color),
          total: parseInt(c.total),
        }))
        .sort((a,b) => b.total - a.total);
      const overPct = Math.round(gastoNeto / totalBudget * 100);
      // Cada segmento ocupa su % del presupuesto. Si excede 100% se trunca visualmente al 100%.
      let acumPct = 0;
      const segmentsHTML = segmentsRaw.map(s => {
        const segPct = s.total / totalBudget * 100;
        if (acumPct >= 100) return '';
        const visiblePct = Math.min(segPct, 100 - acumPct);
        acumPct += visiblePct;
        return `<div class="total-budget-seg" style="width:${visiblePct}%;background:${s.color}" title="${s.name}: ${fmt(s.total)} (${Math.round(segPct)}%)"></div>`;
      }).join('');
      const overFlow = overPct > 100
        ? `<div class="total-budget-overflow">+${overPct - 100}% sobre presupuesto</div>`
        : '';
      totalBudgetHTML = `
        <div class="total-budget-card ${overPct > 100 ? 'over' : overPct >= 90 ? 'warn' : ''}">
          <div class="total-budget-header">
            <span class="total-budget-label">💎 PRESUPUESTO TOTAL</span>
            <button class="budget-edit-btn" onclick="editBudget('_total')">✏️</button>
          </div>
          <div class="total-budget-amounts">
            <b>${fmt(gastoNeto)}</b> / <b>${fmt(totalBudget)}</b>
            <span class="total-budget-pct ${overPct > 100 ? 'over' : ''}">${overPct}%</span>
          </div>
          <div class="total-budget-bar">${segmentsHTML}</div>
          ${overFlow}
          <div class="total-budget-legend">Cada color = una categoría apilando su % del presupuesto. Toca un segmento para ver detalle.</div>
        </div>`;
    } else {
      totalBudgetHTML = `
        <div class="total-budget-card empty">
          <button class="plan-add-btn" style="width:100%;font-size:7px;padding:14px;color:var(--gold);border-color:var(--gold);background:rgba(255,185,56,.08);box-shadow:0 0 14px rgba(255,185,56,.2)" onclick="editBudget('_total')">
            💎 DEFINIR PRESUPUESTO TOTAL MENSUAL
          </button>
        </div>`;
    }

    let budgetHTML = '';
    if (budgetCats.length === 0) {
      budgetHTML = `<div class="empty" style="padding:16px;text-align:center">
        Sin presupuestos por categoría.<br>Toca <b>"Editar"</b> en cualquier categoría para asignarle un tope mensual.
      </div>`;
    } else {
      budgetHTML = budgetCats.map(c => {
        const spent = budgetByCat[c.id] || 0;
        const limit = catBudgets[c.id];
        const pct = Math.min(100, Math.round(spent / limit * 100));
        const overPct = Math.round(spent / limit * 100);
        const lvl = pct >= 100 ? 'over' : pct >= 70 ? 'warn' : 'ok';
        return `
          <div class="budget-row">
            <div class="budget-row-header">
              <div class="budget-row-icon">${mobImg(c.mob_id, c.icono, 22)}</div>
              <span class="budget-row-name">${c.nombre}</span>
              <span class="budget-row-amounts"><b>${fmtShort(spent)}</b> / ${fmtShort(limit)}</span>
              <button class="budget-edit-btn" onclick="editBudget(${c.id})">✏️</button>
            </div>
            <div class="budget-bar"><div class="budget-bar-fill ${lvl}" style="width:${pct}%"></div></div>
            <div class="budget-row-pct ${overPct > 100 ? 'over' : ''}">${overPct}% del presupuesto</div>
          </div>`;
      }).join('');
    }
    // Botón "agregar presupuesto" — abre selector de categoría
    const catsSinBudget = state.categorias.filter(c => c.es_gasto && !catBudgets[c.id]);
    const addBudgetBtn = catsSinBudget.length > 0
      ? `<button class="budget-edit-btn" style="margin-top:8px;padding:8px 12px;font-size:7px;width:100%" onclick="addBudgetPrompt()">➕ AGREGAR PRESUPUESTO</button>`
      : '';

    // ── 4. Top comercios
    const tops = topMerchants(movs, 10);
    const topHTML = tops.length
      ? tops.map((t, i) => `
          <div class="top-row">
            <span class="top-row-rank">#${i+1}</span>
            <span class="top-row-name">${t.name}<span class="top-row-count">· ${t.count} ${t.count === 1 ? 'vez' : 'veces'}</span></span>
            <span class="top-row-total">${fmt(t.total)}</span>
          </div>`).join('')
      : `<div class="empty" style="padding:16px">Sin movimientos este mes</div>`;

    // ── 5. Heatmap día de la semana
    const dow = dayOfWeekTotals(movs);
    const maxDow = Math.max(1, ...dow);
    const heatHTML = `<div class="heatmap-row">
      ${DOW_NAMES.map((name, i) => {
        const isPeak = dow[i] === maxDow && maxDow > 0;
        return `<div class="heatmap-cell ${isPeak ? 'peak' : ''}">
          <div class="heatmap-day">${name}</div>
          <div class="heatmap-amt">${dow[i] > 0 ? fmtShort(dow[i]) : '—'}</div>
        </div>`;
      }).join('')}
    </div>`;

    // ── 6. Necesario vs Deseable
    let totNec = 0, totDes = 0, totUnc = 0;
    d.by_category.forEach(c => {
      const cid = c.categoria_id ?? 0;
      const v = parseInt(c.total) || 0;
      const tipo = catNecDes[cid];
      if (tipo === 'nec') totNec += v;
      else if (tipo === 'des') totDes += v;
      else totUnc += v;
    });
    const totND = totNec + totDes + totUnc;
    const pctOf = v => totND > 0 ? Math.round(v / totND * 100) : 0;
    const ndSummary = `<div class="nd-summary">
      <div class="nd-card nec">
        <div class="nd-label">✅ NECESARIO</div>
        <div class="nd-amt">${fmt(totNec)}</div>
        <div class="nd-pct">${pctOf(totNec)}% del total</div>
      </div>
      <div class="nd-card des">
        <div class="nd-label">🎯 DESEABLE</div>
        <div class="nd-amt">${fmt(totDes)}</div>
        <div class="nd-pct">${pctOf(totDes)}% del total — acá puedes recortar</div>
      </div>
      ${totUnc > 0 ? `<div class="nd-card unc">
        <div class="nd-label">❓ SIN CLASIFICAR — ${fmt(totUnc)}</div>
        <div class="nd-pct">Marca abajo cada categoría como necesaria o deseable para mejor análisis</div>
      </div>` : ''}
    </div>`;

    // Lista de categorías con pills para asignar
    const ndCats = d.by_category.map(c => {
      const cid = c.categoria_id ?? 0;
      const tipo = catNecDes[cid];
      return `<div class="nd-cat-row">
        <div class="nd-cat-icon">${mobImg(c.mob_id, c.icono, 22)}</div>
        <span class="nd-cat-name">${c.nombre} <span style="color:var(--muted);font-size:12px">${fmtShort(c.total)}</span></span>
        <div class="nd-cat-tipo-pills">
          <button class="nd-pill nec ${tipo === 'nec' ? 'active' : ''}" onclick="setNecDes(${cid}, 'nec')">NEC</button>
          <button class="nd-pill des ${tipo === 'des' ? 'active' : ''}" onclick="setNecDes(${cid}, 'des')">DES</button>
        </div>
      </div>`;
    }).join('');

    // ── Render
    el.innerHTML = `
      ${periodNavHTML('plan')}
      <div class="plan-header">
        <span class="plan-title">⚔️ MI PLAN</span>
        <button class="plan-add-btn" onclick="abrirModalManual()">➕ GASTO</button>
      </div>

      ${projHTML}

      <div class="section-title">💰 PRESUPUESTOS</div>
      <div class="section-sub">Tope mensual total + por categoría. La barra del total se rellena con cada categoría según cuánto consume.</div>
      ${totalBudgetHTML}
      <div class="budget-list">${budgetHTML}</div>
      ${addBudgetBtn}

      <div class="section-title" style="margin-top:22px">🏪 TOP COMERCIOS DEL MES</div>
      <div class="section-sub">Dónde más gastaste. Útil para identificar gastos repetitivos.</div>
      <div class="top-list">${topHTML}</div>

      <div class="section-title" style="margin-top:22px">📅 GASTO POR DÍA DE LA SEMANA</div>
      <div class="section-sub">Cuándo gastas más. El día rojo es tu pico.</div>
      ${heatHTML}

      <div class="section-title" style="margin-top:22px">⚖️ NECESARIO vs DESEABLE</div>
      <div class="section-sub">Marca qué categorías son necesarias y cuáles deseables. Las deseables son tu blanco para reducir.</div>
      ${ndSummary}
      <div class="nd-cat-list">${ndCats}</div>
    `;
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="error">Error cargando datos</div>`;
  }
}

// ── Acciones PLAN ─────────────────────────────────────────────────────────────

window.editBudget = (catId) => {
  const key = catId === '_total' ? '_total' : catId;
  const label = catId === '_total'
    ? 'Presupuesto total mensual'
    : (state.categorias.find(c => c.id === catId)?.nombre
        ? `Presupuesto mensual de "${state.categorias.find(c => c.id === catId).nombre}"`
        : null);
  if (!label) return;
  const current = catBudgets[key] || '';
  const val = prompt(`${label} en pesos\n(escribe 0 o vacío para borrarlo)`, current);
  if (val === null) return;
  const n = parseInt(String(val).replace(/\D/g,'')) || 0;
  if (n <= 0) delete catBudgets[key];
  else catBudgets[key] = n;
  localStorage.setItem(BUDGETS_KEY, JSON.stringify(catBudgets));
  loadPlan();
};

window.addBudgetPrompt = () => {
  const sinBudget = state.categorias.filter(c => c.es_gasto && !catBudgets[c.id]);
  if (sinBudget.length === 0) return;
  const list = sinBudget.map((c, i) => `${i+1}. ${c.nombre}`).join('\n');
  const idx = prompt(`Elegir categoría:\n${list}`, '1');
  if (!idx) return;
  const n = parseInt(idx) - 1;
  if (n < 0 || n >= sinBudget.length) return;
  editBudget(sinBudget[n].id);
};

window.setNecDes = (catId, tipo) => {
  const key = String(catId);
  if (catNecDes[key] === tipo) delete catNecDes[key];
  else catNecDes[key] = tipo;
  localStorage.setItem(NECDES_KEY, JSON.stringify(catNecDes));
  loadPlan();
};

// ── Modal manual ──────────────────────────────────────────────────────────────

window.abrirModalManual = () => {
  // default fecha = hoy
  const today = new Date();
  const isoToday = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  $('manual-desc').value = '';
  $('manual-monto').value = '';
  $('manual-fecha').value = isoToday;
  state._manualTipo = 'cargo';
  document.querySelectorAll('.manual-tipo-btn').forEach(b => b.classList.toggle('active', b.dataset.tipo === 'cargo'));
  $('modal-manual').classList.remove('hidden');
};

window.cerrarModalManual = () => $('modal-manual').classList.add('hidden');

window.setManualTipo = (tipo) => {
  state._manualTipo = tipo;
  document.querySelectorAll('.manual-tipo-btn').forEach(b => b.classList.toggle('active', b.dataset.tipo === tipo));
};

window.guardarManual = async () => {
  const desc = $('manual-desc').value.trim();
  const monto = parseInt(($('manual-monto').value || '').replace(/\D/g,'')) || 0;
  const fecha = $('manual-fecha').value || null;
  const tipo = state._manualTipo || 'cargo';
  if (!desc) { showToast('Falta descripción', true); return; }
  if (monto <= 0) { showToast('Monto inválido', true); return; }
  try {
    await addManual({ descripcion: desc, monto, fecha, tipo });
    showToast(`✓ ${tipo === 'cargo' ? 'Gasto' : 'Abono'} agregado: ${fmt(monto)}`);
    cerrarModalManual();
    if (state.tab === 'plan') loadPlan();
  } catch (err) {
    showToast('Error al guardar', true);
  }
};

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

window.eliminarMovActual = async () => {
  const movId = window._currentMovId;
  if (movId == null) return;
  const mov = state.movimientosList.find(m => m.id === movId);
  const label = mov ? `${cleanDesc(mov.descripcion)} · ${fmt(mov.monto)}` : `movimiento ${movId}`;
  if (!confirm(`¿Eliminar este movimiento?\n\n${label}\n\nEsta acción no se puede deshacer.`)) return;
  try {
    await deleteMovement(movId);
    // Sacarlo de la lista en memoria
    state.movimientosList = state.movimientosList.filter(m => m.id !== movId);
    showToast('✓ Movimiento eliminado');
    // Si quedan sin categoría, abrir el siguiente; si no, cerrar modal
    const next = state.movimientosList.find(m => !m.categoria_id);
    if (next) abrirModalDesde(next.id);
    else cerrarModal();
    renderMovimientos();
  } catch {
    showToast('Error al eliminar', true);
  }
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
window.cerrarModalSync = () => $('modal-sync').classList.add('hidden');

function renderSyncResult(d) {
  const procs = d.procesados || [];
  const ok    = procs.filter(p => !p.error);
  const errs  = procs.filter(p =>  p.error);
  const ccCount = ok.filter(p => p.tipo === 'cc').length;
  const tcCount = ok.filter(p => p.tipo === 'tc').length;
  const mergedCount = d.apple_pay_merged || 0;
  const dedupCount  = d.auto_dedupe_removed || 0;

  if (procs.length === 0) {
    return `<div class="sync-empty">
      <span class="sync-empty-icon">🐌</span>
      <div>Sin cartolas nuevas</div>
      <div style="font-size:13px;margin-top:6px">Todo al día — Gmail no tiene correos pendientes.</div>
      ${mergedCount > 0 ? `<div style="font-size:13px;margin-top:8px;color:var(--green)">🔗 ${mergedCount} apple-pay fusionado${mergedCount === 1 ? '' : 's'} con TC</div>` : ''}
      ${dedupCount > 0 ? `<div style="font-size:13px;margin-top:4px;color:var(--green)">🧹 ${dedupCount} duplicado${dedupCount === 1 ? '' : 's'} eliminado${dedupCount === 1 ? '' : 's'}</div>` : ''}
    </div>`;
  }

  const summary = `<div class="sync-summary">
    <div class="sync-pill"><span class="sync-pill-num">${ok.length}</span><span class="sync-pill-label">📬 nuevas</span></div>
    <div class="sync-pill"><span class="sync-pill-num">${ccCount}</span><span class="sync-pill-label">🏦 CC</span></div>
    <div class="sync-pill"><span class="sync-pill-num">${tcCount}</span><span class="sync-pill-label">💳 TC</span></div>
    ${mergedCount > 0 ? `<div class="sync-pill"><span class="sync-pill-num">${mergedCount}</span><span class="sync-pill-label">🔗 fusionados</span></div>` : ''}
    ${dedupCount > 0 ? `<div class="sync-pill"><span class="sync-pill-num">${dedupCount}</span><span class="sync-pill-label">🧹 dedupe</span></div>` : ''}
  </div>`;

  const rows = procs.map(p => {
    if (p.error) {
      return `<div class="sync-row error">
        <span class="sync-row-icon">⚠️</span>
        <div class="sync-row-body">
          <span class="sync-row-tipo sync-row-${p.tipo || 'cc'}">${(p.tipo || '??').toUpperCase()}</span>
          <span class="sync-row-periodo">Error</span>
          <div class="sync-row-detail">${(p.error || '').slice(0,80)}</div>
        </div>
      </div>`;
    }
    const isCC = p.tipo === 'cc';
    return `<div class="sync-row">
      <span class="sync-row-icon">${isCC ? '🏦' : '💳'}</span>
      <div class="sync-row-body">
        <span class="sync-row-tipo sync-row-${p.tipo}">${p.tipo.toUpperCase()}</span>
        <span class="sync-row-periodo">${p.periodo || '—'}</span>
        <div class="sync-row-detail">${p.movimientos || 0} movimiento${p.movimientos === 1 ? '' : 's'} importado${p.movimientos === 1 ? '' : 's'}</div>
      </div>
    </div>`;
  }).join('');

  return summary + `<div class="sync-rows">${rows}</div>`;
}

window.syncData = async () => {
  const btn = $('btn-sync');
  btn.disabled = true; btn.textContent = '⏳';
  try {
    const d = await syncEmail();
    $('sync-result-content').innerHTML = renderSyncResult(d);
    $('modal-sync').classList.remove('hidden');
    const nuevas = (d.procesados || []).filter(p => !p.error).length;
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
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});

  document.querySelectorAll('.tab-btn').forEach(b =>
    b.addEventListener('click', () => navigate(b.dataset.tab)));

  $('modal-categoria').addEventListener('click', e => {
    if (e.target === $('modal-categoria')) cerrarModal();
  });

  $('modal-sync').addEventListener('click', e => {
    if (e.target === $('modal-sync')) cerrarModalSync();
  });

  $('modal-manual').addEventListener('click', e => {
    if (e.target === $('modal-manual')) cerrarModalManual();
  });

  try { state.categorias = await getCategories(); } catch {}

  navigate('resumen');
});
