// Frontend logic for the editorial expense ledger.

const fmtRupees = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function formatDateDMY(iso) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${String(d.getFullYear()).slice(2)}`;
}

function localDateISO(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDayName(iso) {
  const d = new Date(iso + 'T12:00:00');
  const today = new Date();
  const todayStr = localDateISO(today);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = localDateISO(yesterday);
  if (iso === todayStr) return 'Today';
  if (iso === yesterdayStr) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function periodLabel() {
  const d = new Date();
  const month = d.toLocaleString('en-US', { month: 'long' });
  return `${month.toLowerCase()} ${d.getFullYear()} · personal ledger`;
}

// ---------- Toast ----------
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className = `toast ${type}`;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2400);
}

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------- Palette ----------
const INK = '#1e1a14';
const INK_DIM = '#8b8472';
const HAIRLINE = '#cdc3ad';
const ACCENT = '#a94a26';

const CATEGORY_COLORS = {
  Food: '#a94a26',
  Transport: '#3a5a6b',
  Entertainment: '#6e4a6b',
  College: '#4e6f4a',
  Gym: '#7a3324',
  Shopping: '#9c6f54',
  Health: '#5b6f44',
  Skincare: '#a87263',
  Miscellaneous: '#7b6f5e',
};

// shared Chart.js defaults
Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
Chart.defaults.color = INK_DIM;
Chart.defaults.borderColor = HAIRLINE;

let categoryChart, dailyChart, weekDailyChart;

function renderCategoryChart(byCategory) {
  const ctx = document.getElementById('chart-category');
  const labels = byCategory.map((r) => r.category);
  const data = byCategory.map((r) => r.total);
  const colors = labels.map((l) => CATEGORY_COLORS[l] || '#7b6f5e');

  if (categoryChart) categoryChart.destroy();
  categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: '#ece4d4',
        borderWidth: 3,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: INK,
            font: { size: 11, family: 'Inter' },
            padding: 10,
            boxWidth: 8,
            boxHeight: 8,
            usePointStyle: true,
            pointStyle: 'circle',
          },
        },
        tooltip: {
          backgroundColor: INK,
          padding: 10,
          titleFont: { family: 'Inter', size: 11, weight: '500' },
          bodyFont: { family: 'Fraunces', size: 13 },
          displayColors: false,
          callbacks: { label: (ctx) => `${ctx.label} — ${fmtRupees(ctx.raw)}` },
        },
      },
    },
  });
}

function renderBarChart(canvasId, byDay, existingChart, labelFn) {
  const ctx = document.getElementById(canvasId);
  const labels = byDay.map((r) => labelFn ? labelFn(r.day) : r.day.slice(8));
  const data = byDay.map((r) => r.total);

  if (existingChart) existingChart.destroy();
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: ACCENT,
        hoverBackgroundColor: '#7a3324',
        borderRadius: 0,
        barThickness: 'flex',
        maxBarThickness: 14,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: INK,
          padding: 10,
          titleFont: { family: 'Inter', size: 11 },
          bodyFont: { family: 'Fraunces', size: 13 },
          displayColors: false,
          callbacks: {
            label: (ctx) => fmtRupees(ctx.raw),
          },
        },
      },
      scales: {
        x: {
          ticks: { color: INK_DIM, font: { size: 10, family: 'JetBrains Mono' } },
          grid: { display: false },
          border: { color: HAIRLINE },
        },
        y: {
          ticks: {
            color: INK_DIM,
            font: { size: 10, family: 'JetBrains Mono' },
            callback: (v) => '₹' + v,
            maxTicksLimit: 5,
          },
          grid: { color: 'rgba(30, 26, 20, 0.06)' },
          border: { display: false },
          beginAtZero: true,
        },
      },
    },
  });
}

// ---------- Category bars ----------
function renderCategoryBars(containerId, byCategory) {
  const container = document.getElementById(containerId);
  if (!byCategory.length) {
    container.innerHTML = '<div class="empty-state">No expenses yet</div>';
    return;
  }
  const maxTotal = Math.max(...byCategory.map((r) => r.total));
  container.innerHTML = byCategory
    .map((r) => {
      const color = CATEGORY_COLORS[r.category] || '#7b6f5e';
      const pct = maxTotal > 0 ? (r.total / maxTotal) * 100 : 0;
      const category = escapeHTML(r.category);
      return `
        <div class="cat-row">
          <div class="cat-label">
            <span class="cat-dot" style="background:${color}"></span>
            ${category}
          </div>
          <div class="cat-bar-track">
            <div class="cat-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="cat-amount">${fmtRupees(r.total)}</span>
        </div>`;
    })
    .join('');
}

// ---------- Renderers ----------
function escapeHTML(s) {
  return String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function categoryDotClass(category) {
  return Object.prototype.hasOwnProperty.call(CATEGORY_COLORS, category) ? category : 'Miscellaneous';
}

function renderCompactTable(tbodyId, rows, showDate) {
  const tbody = document.getElementById(tbodyId);
  const cols = showDate ? 4 : 3;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${cols}" class="muted center empty-state">No entries</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .slice(0, 30)
    .map((e) => `
      <tr>
        ${showDate ? `<td class="date">${formatDateDMY(e.date)}</td>` : ''}
        <td class="description">${escapeHTML(e.description) || '<span class="muted">—</span>'}</td>
        <td><span class="tag"><span class="tag-dot ${categoryDotClass(e.category)}"></span>${escapeHTML(e.category)}</span></td>
        <td class="right amount">${fmtRupees(e.amount)}</td>
      </tr>`)
    .join('');
}

function renderTable(rows) {
  const tbody = document.getElementById('expense-tbody');
  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="muted center" style="padding:2.5rem 0; font-style: italic;">No entries yet — send a Telegram message to begin.</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .slice(0, 20)
    .map(
      (e) => `
      <tr data-id="${e.id}">
        <td class="date">${formatDateDMY(e.date)}</td>
        <td class="description">${escapeHTML(e.description) || '<span class="muted">—</span>'}</td>
        <td>
          <span class="tag">
            <span class="tag-dot ${categoryDotClass(e.category)}"></span>${escapeHTML(e.category)}
          </span>
        </td>
        <td class="right amount">${fmtRupees(e.amount)}</td>
        <td class="right"><button class="row-x" data-delete="${e.id}" aria-label="Delete">×</button></td>
      </tr>`
    )
    .join('');
}

function renderBudget({ budget, spent, percent }) {
  const bar = document.getElementById('budget-bar');
  const pctEl = document.getElementById('budget-percent');
  const warn = document.getElementById('budget-warning');

  const pct = Math.min(percent, 100);
  bar.style.width = pct + '%';
  bar.classList.remove('warn', 'danger');
  warn.classList.add('hidden');
  warn.classList.remove('warn', 'danger');

  if (percent >= 100) {
    bar.classList.add('danger');
    warn.textContent = `Over budget — ${fmtRupees(spent)} of ${fmtRupees(budget)} spent.`;
    warn.classList.add('danger');
    warn.classList.remove('hidden');
  } else if (percent >= 80) {
    bar.classList.add('warn');
    warn.textContent = `${percent.toFixed(0)}% of budget used — easing close to the line.`;
    warn.classList.add('warn');
    warn.classList.remove('hidden');
  }

  pctEl.textContent = `${percent.toFixed(0)}% used`;

  const spentEl = document.getElementById('stat-spent');
  spentEl.textContent = fmtRupees(spent);
  spentEl.classList.toggle('bad', percent >= 100);

  document.getElementById('stat-budget').textContent = fmtRupees(budget);

  const remEl = document.getElementById('stat-remaining');
  remEl.textContent = fmtRupees(budget - spent);
  remEl.classList.toggle('bad', budget - spent < 0);
  remEl.classList.toggle('good', budget - spent >= 0);
}

// ---------- Tabs ----------
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');

// Cache data for re-rendering charts on tab switch
let cachedMonthSummary = null;
let cachedWeekData = null;

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    panels.forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');

    // Re-render charts after panel becomes visible (Chart.js needs visible canvas)
    requestAnimationFrame(() => {
      if (tab.dataset.tab === 'month' && cachedMonthSummary) {
        renderCategoryChart(cachedMonthSummary.byCategory);
        dailyChart = renderBarChart('chart-daily', cachedMonthSummary.byDay, dailyChart);
      }
      if (tab.dataset.tab === 'week' && cachedWeekData) {
        weekDailyChart = renderBarChart('chart-week-daily', cachedWeekData.byDay, weekDailyChart, formatDayName);
      }
    });
  });
});

// ---------- Loaders ----------
async function refreshAll() {
  try {
    document.getElementById('current-period').textContent = periodLabel();

    const [summary, budget, expenses, todayData, weekData] = await Promise.all([
      api(`/summary?month=${currentMonth()}`),
      api('/budget'),
      api(`/expenses?month=${currentMonth()}`),
      api('/summary/today'),
      api('/summary/week'),
    ]);

    // Hero
    document.getElementById('stat-count').textContent = summary.count;
    renderBudget(budget);

    // Quick totals
    document.getElementById('stat-today').textContent = fmtRupees(todayData.total);
    document.getElementById('stat-week').textContent = fmtRupees(weekData.total);

    // Today panel
    document.getElementById('panel-today-total').textContent = fmtRupees(todayData.total);
    document.getElementById('panel-today-count').textContent = `${todayData.count} entr${todayData.count === 1 ? 'y' : 'ies'}`;
    renderCategoryBars('today-categories', todayData.byCategory);
    renderCompactTable('today-tbody', todayData.expenses, false);

    // Week panel
    cachedWeekData = weekData;
    document.getElementById('panel-week-total').textContent = fmtRupees(weekData.total);
    document.getElementById('panel-week-count').textContent = `${weekData.count} entr${weekData.count === 1 ? 'y' : 'ies'}`;
    renderCategoryBars('week-categories', weekData.byCategory);
    // Only render week chart if panel is visible
    if (document.getElementById('panel-week').classList.contains('active')) {
      weekDailyChart = renderBarChart('chart-week-daily', weekData.byDay, weekDailyChart, formatDayName);
    }
    renderCompactTable('week-tbody', weekData.expenses, true);

    // Month panel
    cachedMonthSummary = summary;
    document.getElementById('panel-month-total').textContent = fmtRupees(summary.total);
    document.getElementById('panel-month-count').textContent = `${summary.count} entr${summary.count === 1 ? 'y' : 'ies'}`;
    // Only render month charts if panel is visible
    if (document.getElementById('panel-month').classList.contains('active')) {
      renderCategoryChart(summary.byCategory);
      dailyChart = renderBarChart('chart-daily', summary.byDay, dailyChart);
    }
    renderCategoryBars('month-categories', summary.byCategory);

    // Recent table
    renderTable(expenses);
  } catch (err) {
    console.error(err);
    toast(`Couldn't load — ${err.message}`, 'error');
  }
}

// ---------- Events ----------
document.getElementById('refresh-btn').addEventListener('click', refreshAll);

document.getElementById('expense-tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delete]');
  if (!btn) return;
  const id = btn.getAttribute('data-delete');
  if (!confirm('Delete this entry?')) return;
  try {
    await api(`/expenses/${id}`, { method: 'DELETE' });
    toast('Entry removed');
    refreshAll();
  } catch (err) {
    toast(`Couldn't delete — ${err.message}`, 'error');
  }
});

document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    amount: document.getElementById('add-amount').value,
    category: document.getElementById('add-category').value,
    description: document.getElementById('add-description').value,
    date: document.getElementById('add-date').value || undefined,
  };
  try {
    await api('/expenses', { method: 'POST', body: JSON.stringify(body) });
    e.target.reset();
    document.getElementById('add-date').valueAsDate = new Date();
    toast('Entry added');
    refreshAll();
  } catch (err) {
    toast(`Couldn't add — ${err.message}`, 'error');
  }
});

document.getElementById('budget-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = document.getElementById('budget-input').value;
  if (!amount) return;
  try {
    await api('/budget', { method: 'PUT', body: JSON.stringify({ amount }) });
    document.getElementById('budget-input').value = '';
    toast('Budget updated');
    refreshAll();
  } catch (err) {
    toast(`Couldn't update — ${err.message}`, 'error');
  }
});

document.getElementById('add-date').valueAsDate = new Date();
refreshAll();
