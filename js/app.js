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
  lineYears: [new Date().getFullYear()], // años seleccionados para el line chart
  hiddenLineCats: new Set(),             // categoria_ids ocultos en el line chart
  lineZoom: 1,                           // 1, 2, 4, 10 — zoom Y del line chart
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

window.selMes = (screen, mes) => {
  state.mes = mes;
  closeAllDropdowns();
  if (screen === 'resumen') loadResumen(); else loadMovimientos();
};

window.selAnio = (screen, anio) => {
  state.anio = anio;
  closeAllDropdowns();
  if (screen === 'resumen') loadResumen(); else loadMovimientos();
};

window.prevMes = screen => {
  state.mes--;
  if (state.mes < 1) { state.mes = 12; state.anio--; }
  if (screen === 'resumen') loadResumen(); else loadMovimientos();
};

window.nextMes = screen => {
  state.mes++;
  if (state.mes > 12) { state.mes = 1; state.anio++; }
  if (screen === 'resumen') loadResumen(); else loadMovimientos();
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
function pickColor(cid, color) {
  if (color && !_isDefaultColor(color)) return color;
  const key = String(cid ?? 'sin');
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return CAT_PALETTE[Math.abs(h) % CAT_PALETTE.length];
}

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

  // Top 8 categorías por total. Cualquiera puede ser ocultada vía leyenda.
  const allCats = Object.entries(catTotals)
    .sort((a,b) => b[1]-a[1])
    .slice(0, 8)
    .map(([cid]) => cid);
  const hidden = state.hiddenLineCats;
  const visibleCats = allCats.filter(cid => !hidden.has(cid));

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

  // Grid y eje Y (3 líneas: 0, max/2, max)
  const yLevels = [0, maxVal / 2, maxVal];
  const grid = yLevels.map((v, i) => {
    const y = padT + innerH - (v / maxVal) * innerH;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(120,120,255,.15)" stroke-dasharray="2 3"/>
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

  // Leyenda interactiva — clic para mostrar/ocultar categoría
  const legend = allCats.map(cid => {
    const cat = catInfo[cid];
    const color = pickColor(cid, cat?.color);
    const isHidden = hidden.has(cid);
    return `<button class="line-legend-item${isHidden ? ' hidden-cat' : ''}" onclick="toggleLineCat('${cid}')">
      <span class="line-legend-dot" style="background:${isHidden ? 'transparent' : color};border-color:${color};box-shadow:${isHidden ? 'none' : `0 0 6px ${color}`}"></span>
      <span>${cat?.nombre || 'Sin cat'}</span>
    </button>`;
  }).join('');

  return `
    <svg class="line-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
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
    </svg>
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

window.setLineZoom = (z) => {
  state.lineZoom = z;
  loadResumen();
};

function lineZoomSelectorHTML() {
  const opts = [1, 2, 4, 10];
  return opts.map(z => {
    const active = (state.lineZoom || 1) === z;
    return `<button class="line-zoom-pill${active ? ' active' : ''}" onclick="setLineZoom(${z})">${z}×</button>`;
  }).join('');
}

window.toggleLineCat = (cid) => {
  const key = String(cid);
  if (state.hiddenLineCats.has(key)) state.hiddenLineCats.delete(key);
  else state.hiddenLineCats.add(key);
  loadResumen();
};

window.toggleLineYear = (y) => {
  const i = state.lineYears.indexOf(y);
  if (i >= 0) {
    if (state.lineYears.length === 1) return; // siempre debe quedar al menos uno
    state.lineYears.splice(i, 1);
  } else {
    state.lineYears.push(y);
  }
  state.lineYears.sort();
  loadResumen();
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
    const [d, yearly, stackData, ...lineYearsData] = await Promise.all([
      getSummary(state.anio, state.mes),
      getYearlySummary(state.anio),
      getYearlyCategoryBreakdown(state.anio).catch(() => null),
      ...state.lineYears.map(y => getYearlyCategoryBreakdown(y).catch(() => null)),
    ]);

    const totalGasto  = parseInt(d.total_cargos);
    const totalAbonos = parseInt(d.total_abonos || 0);
    const gastoNeto   = parseInt(d.gasto_neto ?? d.total_cargos);
    const excluido    = parseInt(d.total_excluido || 0);

    // Barras de categorías
    const maxCat = Math.max(1, ...d.by_category.map(c => parseInt(c.total)));
    const catRows = d.by_category.map(c => {
      const pct = Math.round((parseInt(c.total) / maxCat) * 100);
      const cid = c.categoria_id ?? 0;
      const color = pickColor(cid, c.color);
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
            <span class="cat-row-count">${c.count} mov. ▼</span>
          </div>
        </div>
        <div id="cat-detail-${cid}" class="cat-detail hidden"></div>`;
    }).join('') || `<div class="empty" style="padding:16px">Sin gastos este mes</div>`;

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
        ${totalAbonos > 0 ? `<div class="total-excluido" style="color:var(--green)">-${fmt(totalAbonos)} reembolsado</div>` : ''}
        ${excluido > 0 ? `<div class="total-excluido">+${fmt(excluido)} excluido</div>` : ''}
        <div class="total-sub">${d.cantidad_movimientos} cargos${totalAbonos > 0 ? ` · bruto ${fmt(totalGasto)}` : ''}</div>
      </div>

      <div class="section-title">📊 GASTO POR CATEGORÍA</div>
      <div class="section-sub">Toca una categoría para ver sus movimientos del mes.</div>
      <div class="cat-list">${catRows}</div>

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
      <div class="line-controls">
        <div class="line-year-pills">${lineYearSelectorHTML()}</div>
        <div class="line-zoom-row">
          <span class="line-zoom-label">Zoom Y</span>
          <div class="line-zoom-pills">${lineZoomSelectorHTML()}</div>
        </div>
      </div>
      <div class="chart-card">${buildLineChartSVG(lineYearsData)}</div>
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
window.cerrarModalSync = () => $('modal-sync').classList.add('hidden');

function renderSyncResult(d) {
  const procs = d.procesados || [];
  const ok    = procs.filter(p => !p.error);
  const errs  = procs.filter(p =>  p.error);
  const ccCount = ok.filter(p => p.tipo === 'cc').length;
  const tcCount = ok.filter(p => p.tipo === 'tc').length;

  if (procs.length === 0) {
    return `<div class="sync-empty">
      <span class="sync-empty-icon">🐌</span>
      <div>Sin cartolas nuevas</div>
      <div style="font-size:13px;margin-top:6px">Todo al día — Gmail no tiene correos pendientes.</div>
    </div>`;
  }

  const summary = `<div class="sync-summary">
    <div class="sync-pill"><span class="sync-pill-num">${ok.length}</span><span class="sync-pill-label">📬 nuevas</span></div>
    <div class="sync-pill"><span class="sync-pill-num">${ccCount}</span><span class="sync-pill-label">🏦 CC</span></div>
    <div class="sync-pill"><span class="sync-pill-num">${tcCount}</span><span class="sync-pill-label">💳 TC</span></div>
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

  try { state.categorias = await getCategories(); } catch {}

  navigate('resumen');
});
