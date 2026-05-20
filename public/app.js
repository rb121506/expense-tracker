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

function monthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' }).toLowerCase();
}

function periodLabel(monthStr) {
  return `${monthLabel(monthStr)} · personal ledger`;
}

function prevMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------- Auth ----------
let authToken = localStorage.getItem('expense_auth') || '';

async function checkAuth() {
  try {
    const { required } = await (await fetch('/api/auth/check')).json();
    if (!required) {
      document.getElementById('app-wrap').classList.remove('hidden');
      return true;
    }
    // Try stored token
    if (authToken) {
      const res = await fetch('/api/budget', { headers: { 'x-passcode': authToken } });
      if (res.ok) {
        document.getElementById('app-wrap').classList.remove('hidden');
        return true;
      }
    }
    // Show login
    document.getElementById('auth-overlay').classList.remove('hidden');
    document.getElementById('app-wrap').classList.add('hidden');
    return false;
  } catch (e) {
    document.getElementById('app-wrap').classList.remove('hidden');
    return true;
  }
}

document.getElementById('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const passcode = document.getElementById('auth-input').value;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode }),
    });
    const data = await res.json();
    if (data.ok) {
      authToken = data.token || passcode;
      localStorage.setItem('expense_auth', authToken);
      document.getElementById('auth-overlay').classList.add('hidden');
      document.getElementById('app-wrap').classList.remove('hidden');
      refreshAll();
    } else {
      document.getElementById('auth-error').textContent = data.error || 'Wrong passcode';
      document.getElementById('auth-error').classList.remove('hidden');
    }
  } catch (err) {
    document.getElementById('auth-error').textContent = 'Connection error';
    document.getElementById('auth-error').classList.remove('hidden');
  }
});

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
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (authToken) headers['x-passcode'] = authToken;
  const res = await fetch(`/api${path}`, { ...opts, headers });
  if (res.status === 401) {
    localStorage.removeItem('expense_auth');
    authToken = '';
    checkAuth();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------- State ----------
let selectedMonth = currentMonth();

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
        <td class="right">
          <button class="row-edit" data-edit="${e.id}" data-amount="${e.amount}" data-category="${escapeHTML(e.category)}" data-description="${escapeHTML(e.description || '')}" data-date="${(e.date || '').slice(0, 10)}" aria-label="Edit">&#9998;</button>
          <button class="row-x" data-delete="${e.id}" aria-label="Delete">&times;</button>
        </td>
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

// ---------- Insights ----------
function renderInsights(data) {
  document.getElementById('insight-avg').textContent = fmtRupees(data.avgDaily);
  document.getElementById('insight-projected').textContent = fmtRupees(data.projected);

  const highestEl = document.getElementById('insight-highest');
  const highestDayEl = document.getElementById('insight-highest-day');
  if (data.highestDay) {
    highestEl.textContent = fmtRupees(data.highestDay.total);
    highestDayEl.textContent = formatDayName(data.highestDay.day);
  } else {
    highestEl.textContent = '—';
    highestDayEl.textContent = '';
  }

  const changeEl = document.getElementById('insight-change');
  if (data.prevTotal === 0 && data.currentTotal === 0) {
    changeEl.textContent = '—';
    changeEl.className = 'insight-value serif';
  } else if (data.prevTotal === 0) {
    changeEl.textContent = 'new';
    changeEl.className = 'insight-value serif';
  } else {
    const sign = data.monthChange > 0 ? '+' : '';
    changeEl.textContent = `${sign}${data.monthChange}%`;
    changeEl.className = `insight-value serif ${data.monthChange > 0 ? 'bad' : 'good'}`;
  }
}

// ---------- Alerts ----------
function renderAlerts(data) {
  const container = document.getElementById('alerts-list');
  const countEl = document.getElementById('alerts-count');
  const items = [];

  // Budget alerts
  const d = data.dailyDigest;
  if (d.budgetPercent >= 100) {
    items.push({ type: 'danger', icon: '🚨', text: `<strong>Over budget!</strong> ${fmtRupees(d.monthSpent)} of ${fmtRupees(d.budget)} spent (${d.budgetPercent}%)` });
  } else if (d.budgetPercent >= 80) {
    items.push({ type: 'warn', icon: '⚠️', text: `<strong>Budget warning:</strong> ${d.budgetPercent}% used — ${fmtRupees(d.monthRemaining)} remaining` });
  }

  // Unusual spending
  for (const u of data.unusualSpending) {
    items.push({
      type: 'info',
      icon: '📈',
      text: `<strong>${escapeHTML(u.category)}:</strong> ${fmtRupees(u.thisWeek)} this week — ${u.ratio}× your weekly avg (${fmtRupees(u.weeklyAvg)})`,
    });
  }

  // Recurring reminders
  for (const r of data.recurringReminders) {
    const when = r.dueIn === 0 ? 'due <strong>today</strong>' : `due in <strong>${r.dueIn} day${r.dueIn > 1 ? 's' : ''}</strong>`;
    items.push({
      type: 'remind',
      icon: '🔔',
      text: `<strong>${escapeHTML(r.description)}</strong> of ${fmtRupees(r.amount)} ${when}`,
    });
  }

  // Daily summary (always show)
  if (d.todaySpent > 0) {
    items.push({
      type: '',
      icon: '💰',
      text: `Today: ${fmtRupees(d.todaySpent)} · Week: ${fmtRupees(d.weekSpent)} · Month: ${fmtRupees(d.monthSpent)}`,
    });
  }

  countEl.textContent = items.length ? `${items.length} alert${items.length > 1 ? 's' : ''}` : '';

  if (!items.length) {
    container.innerHTML = '<p class="alerts-empty">All clear — no alerts right now.</p>';
    return;
  }

  container.innerHTML = items.map(a =>
    `<div class="alert-item alert-${a.type}">
      <span class="alert-icon">${a.icon}</span>
      <span class="alert-text">${a.text}</span>
    </div>`
  ).join('');
}

// ---------- Category Budgets ----------
function renderCategoryBudgets(budgets) {
  const container = document.getElementById('catbudget-list');
  if (!budgets.length) {
    container.innerHTML = '<div class="empty-state">No category budgets set</div>';
    return;
  }
  container.innerHTML = budgets.map(b => {
    const color = CATEGORY_COLORS[b.category] || '#7b6f5e';
    const pct = Math.min(b.percent, 100);
    const warn = b.percent >= 100 ? 'danger' : b.percent >= 80 ? 'warn' : '';
    return `
      <div class="catbudget-row">
        <div class="cat-label">
          <span class="cat-dot" style="background:${color}"></span>
          ${escapeHTML(b.category)}
        </div>
        <div class="catbudget-bar-wrap">
          <div class="thin-bar" style="flex:1">
            <div class="thin-bar-fill ${warn}" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="kicker catbudget-pct">${Math.round(b.percent)}%</span>
        </div>
        <span class="cat-amount">${fmtRupees(b.spent)} / ${fmtRupees(b.budget)}</span>
        <button class="row-x" data-delete-catbudget="${escapeHTML(b.category)}" aria-label="Remove">&times;</button>
      </div>`;
  }).join('');
}

// ---------- Recurring Expenses ----------
function renderRecurring(items) {
  const container = document.getElementById('recurring-list');
  if (!items.length) {
    container.innerHTML = '<div class="empty-state">No recurring expenses</div>';
    return;
  }
  container.innerHTML = items.map(r => {
    const color = CATEGORY_COLORS[r.category] || '#7b6f5e';
    return `
      <div class="recurring-row ${r.active ? '' : 'paused'}">
        <div class="cat-label">
          <span class="cat-dot" style="background:${color}"></span>
          ${escapeHTML(r.description || r.category)}
        </div>
        <span class="kicker">day ${r.day_of_month}</span>
        <span class="cat-amount">${fmtRupees(r.amount)}</span>
        <div class="recurring-actions">
          <button class="link-btn small" data-toggle-recurring="${r.id}" data-active="${r.active}">${r.active ? 'pause' : 'resume'}</button>
          <button class="row-x" data-delete-recurring="${r.id}">&times;</button>
        </div>
      </div>`;
  }).join('');
}

// ---------- Tabs ----------
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');

let cachedMonthSummary = null;
let cachedWeekData = null;

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    panels.forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');

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

// ---------- Month switcher ----------
function updateMonthUI() {
  document.getElementById('month-label').textContent = monthLabel(selectedMonth);
  document.getElementById('current-period').textContent = periodLabel(selectedMonth);

  // Hide quick totals if not current month
  const isNow = selectedMonth === currentMonth();
  document.getElementById('quick-totals-section').classList.toggle('hidden', !isNow);
}

document.getElementById('month-prev').addEventListener('click', () => {
  selectedMonth = prevMonth(selectedMonth);
  updateMonthUI();
  refreshAll();
});

document.getElementById('month-next').addEventListener('click', () => {
  selectedMonth = nextMonth(selectedMonth);
  updateMonthUI();
  refreshAll();
});

// ---------- Loaders ----------
async function refreshAll() {
  try {
    updateMonthUI();

    const isNow = selectedMonth === currentMonth();

    const promises = [
      api(`/summary?month=${selectedMonth}`),
      api(`/budget?month=${selectedMonth}`),
      api(`/expenses?month=${selectedMonth}`),
      api(`/insights?month=${selectedMonth}`),
      api(`/category-budgets?month=${selectedMonth}`),
      api('/recurring'),
      api(`/alerts?month=${selectedMonth}`),
    ];

    if (isNow) {
      promises.push(api('/summary/today'));
      promises.push(api('/summary/week'));
    }

    const results = await Promise.all(promises);
    const [summary, budget, expenses, insights, catBudgets, recurring, alerts, todayData, weekData] = results;

    // Hero
    document.getElementById('stat-count').textContent = summary.count;
    renderBudget(budget);

    // Quick totals (only current month)
    if (isNow && todayData && weekData) {
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
      if (document.getElementById('panel-week').classList.contains('active')) {
        weekDailyChart = renderBarChart('chart-week-daily', weekData.byDay, weekDailyChart, formatDayName);
      }
      renderCompactTable('week-tbody', weekData.expenses, true);
    }

    // Month panel
    cachedMonthSummary = summary;
    document.getElementById('panel-month-total').textContent = fmtRupees(summary.total);
    document.getElementById('panel-month-count').textContent = `${summary.count} entr${summary.count === 1 ? 'y' : 'ies'}`;
    if (document.getElementById('panel-month').classList.contains('active')) {
      renderCategoryChart(summary.byCategory);
      dailyChart = renderBarChart('chart-daily', summary.byDay, dailyChart);
    }
    renderCategoryBars('month-categories', summary.byCategory);

    // Alerts
    renderAlerts(alerts);

    // Insights
    renderInsights(insights);

    // Category budgets
    renderCategoryBudgets(catBudgets);

    // Recurring
    renderRecurring(recurring);

    // Recent table
    renderTable(expenses);
  } catch (err) {
    console.error(err);
    if (err.message !== 'Unauthorized') {
      toast(`Couldn't load — ${err.message}`, 'error');
    }
  }
}

// ---------- Events ----------
document.getElementById('refresh-btn').addEventListener('click', refreshAll);

// Delete expense
document.getElementById('expense-tbody').addEventListener('click', async (e) => {
  const delBtn = e.target.closest('[data-delete]');
  if (delBtn) {
    const id = delBtn.getAttribute('data-delete');
    if (!confirm('Delete this entry?')) return;
    try {
      await api(`/expenses/${id}`, { method: 'DELETE' });
      toast('Entry removed');
      refreshAll();
    } catch (err) {
      toast(`Couldn't delete — ${err.message}`, 'error');
    }
    return;
  }

  // Edit expense
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) {
    document.getElementById('edit-id').value = editBtn.dataset.edit;
    document.getElementById('edit-amount').value = editBtn.dataset.amount;
    document.getElementById('edit-category').value = editBtn.dataset.category;
    document.getElementById('edit-description').value = editBtn.dataset.description;
    document.getElementById('edit-date').value = editBtn.dataset.date;
    document.getElementById('edit-modal').classList.remove('hidden');
  }
});

// Edit modal
document.getElementById('edit-close').addEventListener('click', () => {
  document.getElementById('edit-modal').classList.add('hidden');
});

document.getElementById('edit-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('edit-modal')) {
    document.getElementById('edit-modal').classList.add('hidden');
  }
});

document.getElementById('edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('edit-id').value;
  const body = {
    amount: document.getElementById('edit-amount').value,
    category: document.getElementById('edit-category').value,
    description: document.getElementById('edit-description').value,
    date: document.getElementById('edit-date').value || undefined,
  };
  try {
    await api(`/expenses/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    document.getElementById('edit-modal').classList.add('hidden');
    toast('Entry updated');
    refreshAll();
  } catch (err) {
    toast(`Couldn't update — ${err.message}`, 'error');
  }
});

// Add expense
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

// Budget form
document.getElementById('budget-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = document.getElementById('budget-input').value;
  if (!amount) return;
  try {
    await api('/budget', { method: 'PUT', body: JSON.stringify({ amount, month: selectedMonth }) });
    document.getElementById('budget-input').value = '';
    toast('Budget updated');
    refreshAll();
  } catch (err) {
    toast(`Couldn't update — ${err.message}`, 'error');
  }
});

// ---------- Category Budget events ----------
document.getElementById('toggle-catbudget-form').addEventListener('click', () => {
  document.getElementById('catbudget-form').classList.toggle('hidden');
});

document.getElementById('catbudget-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    category: document.getElementById('catbudget-category').value,
    budget: document.getElementById('catbudget-amount').value,
    month: selectedMonth,
  };
  try {
    await api('/category-budgets', { method: 'PUT', body: JSON.stringify(body) });
    document.getElementById('catbudget-form').classList.add('hidden');
    document.getElementById('catbudget-form').reset();
    toast('Category budget set');
    refreshAll();
  } catch (err) {
    toast(`Couldn't set — ${err.message}`, 'error');
  }
});

document.getElementById('catbudget-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delete-catbudget]');
  if (!btn) return;
  const cat = btn.dataset.deleteCatbudget;
  try {
    await api(`/category-budgets/${encodeURIComponent(cat)}?month=${selectedMonth}`, { method: 'DELETE' });
    toast('Category budget removed');
    refreshAll();
  } catch (err) {
    toast(`Couldn't remove — ${err.message}`, 'error');
  }
});

// ---------- Recurring events ----------
document.getElementById('toggle-recurring-form').addEventListener('click', () => {
  document.getElementById('recurring-form').classList.toggle('hidden');
});

document.getElementById('recurring-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    amount: document.getElementById('rec-amount').value,
    category: document.getElementById('rec-category').value,
    description: document.getElementById('rec-description').value,
    day_of_month: document.getElementById('rec-day').value,
  };
  try {
    await api('/recurring', { method: 'POST', body: JSON.stringify(body) });
    document.getElementById('recurring-form').classList.add('hidden');
    document.getElementById('recurring-form').reset();
    toast('Recurring expense added');
    refreshAll();
  } catch (err) {
    toast(`Couldn't add — ${err.message}`, 'error');
  }
});

document.getElementById('recurring-list').addEventListener('click', async (e) => {
  const toggleBtn = e.target.closest('[data-toggle-recurring]');
  if (toggleBtn) {
    const id = toggleBtn.dataset.toggleRecurring;
    const isActive = toggleBtn.dataset.active === 'true';
    try {
      await api(`/recurring/${id}`, { method: 'PUT', body: JSON.stringify({ active: !isActive }) });
      toast(isActive ? 'Paused' : 'Resumed');
      refreshAll();
    } catch (err) {
      toast(`Couldn't update — ${err.message}`, 'error');
    }
    return;
  }

  const delBtn = e.target.closest('[data-delete-recurring]');
  if (delBtn) {
    if (!confirm('Delete this recurring expense?')) return;
    try {
      await api(`/recurring/${delBtn.dataset.deleteRecurring}`, { method: 'DELETE' });
      toast('Recurring expense deleted');
      refreshAll();
    } catch (err) {
      toast(`Couldn't delete — ${err.message}`, 'error');
    }
  }
});

// ---------- Search & Filter events ----------
document.getElementById('toggle-filters').addEventListener('click', () => {
  const panel = document.getElementById('filter-panel');
  const btn = document.getElementById('toggle-filters');
  panel.classList.toggle('hidden');
  btn.textContent = panel.classList.contains('hidden') ? 'show filters' : 'hide filters';
});

document.getElementById('filter-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await runSearch();
});

document.getElementById('filter-clear').addEventListener('click', () => {
  document.getElementById('filter-form').reset();
  document.getElementById('search-results').classList.add('hidden');
});

async function runSearch() {
  const params = new URLSearchParams();
  const cat = document.getElementById('filter-category').value;
  const search = document.getElementById('filter-search').value;
  const dateFrom = document.getElementById('filter-date-from').value;
  const dateTo = document.getElementById('filter-date-to').value;
  const amtMin = document.getElementById('filter-amount-min').value;
  const amtMax = document.getElementById('filter-amount-max').value;

  if (cat) params.set('category', cat);
  if (search) params.set('search', search);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (amtMin) params.set('amountMin', amtMin);
  if (amtMax) params.set('amountMax', amtMax);
  if (selectedMonth) params.set('month', selectedMonth);

  try {
    const rows = await api(`/expenses/search?${params}`);
    document.getElementById('search-results').classList.remove('hidden');
    const total = rows.reduce((s, r) => s + r.amount, 0);
    document.getElementById('search-results-count').textContent = `${rows.length} results · ${fmtRupees(total)} total`;
    renderCompactTable('search-tbody', rows, true);
  } catch (err) {
    toast(`Search failed — ${err.message}`, 'error');
  }
}

// Export CSV
document.getElementById('filter-export').addEventListener('click', () => {
  const params = new URLSearchParams();
  const cat = document.getElementById('filter-category').value;
  const search = document.getElementById('filter-search').value;
  const dateFrom = document.getElementById('filter-date-from').value;
  const dateTo = document.getElementById('filter-date-to').value;
  const amtMin = document.getElementById('filter-amount-min').value;
  const amtMax = document.getElementById('filter-amount-max').value;

  if (cat) params.set('category', cat);
  if (search) params.set('search', search);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (amtMin) params.set('amountMin', amtMin);
  if (amtMax) params.set('amountMax', amtMax);
  if (selectedMonth) params.set('month', selectedMonth);
  if (authToken) params.set('_passcode', authToken);

  window.location.href = `/api/expenses/export?${params}`;
});

// ---------- Import events ----------
document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

let pendingImportEntries = [];

document.getElementById('import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      toast('CSV must have a header row and at least one data row', 'error');
      return;
    }

    // Parse header
    const header = lines[0].toLowerCase();
    const hasHeader = header.includes('date') || header.includes('amount') || header.includes('category');
    const startLine = hasHeader ? 1 : 0;

    pendingImportEntries = [];
    const tbody = document.getElementById('import-tbody');
    let html = '';

    for (let i = startLine; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 2) continue;

      // Try to detect column order: Date, Amount, Category, Description
      let date = '', amount = '', category = '', description = '';
      if (cols.length >= 4) {
        [date, amount, category, description] = cols;
      } else if (cols.length === 3) {
        [date, amount, category] = cols;
      } else {
        [amount, category] = cols;
      }

      const amt = parseFloat(amount);
      const valid = amt > 0 && category.trim();
      const status = valid ? 'ok' : 'invalid';

      const entry = {
        date: date.trim() || localDateISO(),
        amount: amt || 0,
        category: category.trim() || 'Miscellaneous',
        description: (description || '').trim(),
      };
      if (valid) pendingImportEntries.push(entry);

      html += `<tr class="${valid ? '' : 'import-invalid'}">
        <td class="date">${escapeHTML(entry.date)}</td>
        <td>${entry.amount}</td>
        <td>${escapeHTML(entry.category)}</td>
        <td>${escapeHTML(entry.description)}</td>
        <td class="kicker">${status}</td>
      </tr>`;
    }

    tbody.innerHTML = html;
    document.getElementById('import-preview-count').textContent = `${pendingImportEntries.length} valid rows of ${lines.length - (hasHeader ? 1 : 0)} total`;
    document.getElementById('import-preview').classList.remove('hidden');
  };
  reader.readAsText(file);
});

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

document.getElementById('import-confirm').addEventListener('click', async () => {
  if (!pendingImportEntries.length) return;
  try {
    const res = await api('/expenses/import', {
      method: 'POST',
      body: JSON.stringify({ entries: pendingImportEntries }),
    });
    toast(`Imported ${res.imported} entries`);
    document.getElementById('import-preview').classList.add('hidden');
    document.getElementById('import-file').value = '';
    pendingImportEntries = [];
    refreshAll();
  } catch (err) {
    toast(`Import failed — ${err.message}`, 'error');
  }
});

document.getElementById('import-cancel').addEventListener('click', () => {
  document.getElementById('import-preview').classList.add('hidden');
  document.getElementById('import-file').value = '';
  pendingImportEntries = [];
});

// ---------- PDF Report Generation ----------
document.getElementById('generate-report').addEventListener('click', async () => {
  try {
    toast('Generating report...');
    const data = await api(`/report-data?month=${selectedMonth}`);
    generatePDF(data);
  } catch (err) {
    toast(`Report failed — ${err.message}`, 'error');
  }
});

function generatePDF(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const INK = [30, 26, 20];
  const ACCENT_RGB = [169, 74, 38];
  const MUTED = [139, 132, 114];
  const pageW = doc.internal.pageSize.getWidth();

  // --- Header ---
  const [y0, m0] = data.month.split('-').map(Number);
  const monthName = new Date(y0, m0 - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...INK);
  doc.text('Expense Report', 14, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...MUTED);
  doc.text(monthName, 14, 30);

  doc.setDrawColor(...ACCENT_RGB);
  doc.setLineWidth(0.5);
  doc.line(14, 34, pageW - 14, 34);

  // --- Summary Box ---
  let y = 44;
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text('SUMMARY', 14, y);
  y += 8;

  doc.setFontSize(12);
  doc.setTextColor(...INK);
  const budgetPct = data.budget ? Math.round((data.total / data.budget) * 100) : 0;
  const summaryRows = [
    ['Total Spent', fmtRupees(data.total)],
    ['Budget', fmtRupees(data.budget)],
    ['Remaining', fmtRupees(data.remaining)],
    ['Budget Used', `${budgetPct}%`],
    ['Entries', String(data.count)],
    ['Avg Daily', fmtRupees(data.insights.avgDaily)],
    ['Projected', fmtRupees(data.insights.projected)],
  ];

  doc.autoTable({
    startY: y,
    head: [],
    body: summaryRows,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 2, textColor: INK },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 40 },
      1: { halign: 'left' },
    },
    margin: { left: 14, right: 14 },
  });

  y = doc.lastAutoTable.finalY + 12;

  // --- Category Breakdown ---
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text('CATEGORY BREAKDOWN', 14, y);
  y += 4;

  const catRows = data.byCategory.map(c => {
    const pct = data.total ? ((c.total / data.total) * 100).toFixed(1) : '0';
    return [c.category, fmtRupees(c.total), `${pct}%`, String(c.count)];
  });

  doc.autoTable({
    startY: y,
    head: [['Category', 'Amount', '%', 'Entries']],
    body: catRows,
    theme: 'striped',
    headStyles: { fillColor: ACCENT_RGB, textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 3, textColor: INK },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });

  y = doc.lastAutoTable.finalY + 12;

  // --- Top 5 Merchants ---
  if (data.topMerchants.length) {
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text('TOP MERCHANTS', 14, y);
    y += 4;

    const merchRows = data.topMerchants.map((m, i) => [
      `${i + 1}`, m.description, fmtRupees(m.total), `${m.count}×`,
    ]);

    doc.autoTable({
      startY: y,
      head: [['#', 'Merchant', 'Total', 'Txns']],
      body: merchRows,
      theme: 'striped',
      headStyles: { fillColor: ACCENT_RGB, textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 3, textColor: INK },
      columnStyles: { 0: { cellWidth: 10 }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });

    y = doc.lastAutoTable.finalY + 12;
  }

  // --- Month-over-Month Trend ---
  if (data.trend.length) {
    // Check if we need a new page
    if (y > 240) { doc.addPage(); y = 20; }

    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text('MONTH-OVER-MONTH TREND', 14, y);
    y += 4;

    const trendRows = data.trend.map(t => {
      const [ty, tm] = t.month.split('-').map(Number);
      const label = new Date(ty, tm - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
      return [label, fmtRupees(t.total), String(t.count)];
    });

    doc.autoTable({
      startY: y,
      head: [['Month', 'Total', 'Entries']],
      body: trendRows,
      theme: 'striped',
      headStyles: { fillColor: ACCENT_RGB, textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 3, textColor: INK },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });

    y = doc.lastAutoTable.finalY + 12;
  }

  // --- Category Budgets ---
  if (data.categoryBudgets && data.categoryBudgets.length) {
    if (y > 240) { doc.addPage(); y = 20; }

    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text('CATEGORY BUDGETS', 14, y);
    y += 4;

    const cbRows = data.categoryBudgets.map(b => {
      const pct = b.budget ? Math.round((b.spent / b.budget) * 100) : 0;
      return [b.category, fmtRupees(b.spent), fmtRupees(b.budget), `${pct}%`];
    });

    doc.autoTable({
      startY: y,
      head: [['Category', 'Spent', 'Budget', 'Used']],
      body: cbRows,
      theme: 'striped',
      headStyles: { fillColor: ACCENT_RGB, textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 3, textColor: INK },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
  }

  // --- Footer ---
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(
      `Generated ${new Date().toLocaleDateString('en-IN')} · Page ${i}/${pageCount}`,
      pageW / 2, doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }

  // Save
  const filename = `expenses-${data.month}.pdf`;
  doc.save(filename);
  toast(`Report downloaded: ${filename}`);
}

// ---------- Populate category dropdowns ----------
function populateCategorySelect(selectId) {
  const sel = document.getElementById(selectId);
  if (sel.options.length > 1) return; // already populated
  const cats = ['Food', 'Transport', 'Entertainment', 'College', 'Gym', 'Shopping', 'Health', 'Skincare', 'Miscellaneous'];
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
}

// ---------- Init ----------
document.getElementById('add-date').valueAsDate = new Date();
populateCategorySelect('catbudget-category');

(async () => {
  const authed = await checkAuth();
  if (authed) refreshAll();
})();
