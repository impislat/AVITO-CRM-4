(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
  const asArray = (value) => Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined && item !== '') : (value ? [value] : []);
  const textValue = (value, fallback = '—') => {
    if (Array.isArray(value)) return value.length ? value.join(', ') : fallback;
    if (value && typeof value === 'object') return JSON.stringify(value);
    return value === null || value === undefined || value === '' ? fallback : String(value);
  };
  const toNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const match = String(value ?? '').replace(/\u00a0/g, ' ').match(/[\d\s.,]+/);
    if (!match) return 0;
    const normalized = match[0].replace(/\s/g, '').replace(',', '.').replace(/\.(?=.*\.)/g, '');
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  };
  const formatMoney = (value) => {
    const number = toNumber(value);
    return number ? `${new Intl.NumberFormat('ru-RU').format(Math.round(number))} ₽` : '—';
  };
  const parseDate = (value) => {
    if (!value) return 0;
    if (value instanceof Date) return value.getTime();
    const raw = String(value).trim();
    const iso = Date.parse(raw.replace(/(\d{2})\.(\d{2})\.(\d{4})/, '$3-$2-$1'));
    return Number.isFinite(iso) ? iso : 0;
  };
  const formatDate = (value) => {
    const timestamp = parseDate(value);
    if (!timestamp) return textValue(value, '—');
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(timestamp));
  };
  const formatDateTime = (value) => {
    const timestamp = parseDate(value);
    if (!timestamp) return textValue(value, '—');
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
  };
  const initials = (value) => {
    const words = String(value || 'Клиент').trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'К';
  };
  const capitalize = (value) => {
    const str = String(value || '');
    return str ? str[0].toUpperCase() + str.slice(1) : str;
  };

  const statusMap = {
    work: ['В работе', 'badge-blue'],
    wait: ['Ожидает', 'badge-amber'],
    done: ['Завершён', 'badge-green'],
    cancel: ['Отказ', 'badge-red'],
    unknown: ['Не определено', 'badge-neutral']
  };
  const stageMap = {
    payment_confirmed: ['Оплата подтверждена', 'badge-green'],
    agreed_or_docs: ['Согласование / документы', 'badge-blue'],
    work_in_progress: ['В работе', 'badge-blue'],
    paused: ['Пауза', 'badge-amber'],
    refused: ['Отказ', 'badge-red'],
    unknown: ['Не определено', 'badge-neutral'],
    completed: ['Завершён', 'badge-green']
  };
  const paymentMap = {
    confirmed_textual_account_message: ['Подтверждено в чате', 'badge-green'],
    marked_paid_in_legacy_crm: ['Оплачено в старой CRM', 'badge-green'],
    unknown_or_not_confirmed: ['Не подтверждено', 'badge-neutral']
  };
  const categoryMap = {
    'Юридический клиент': ['Клиент', 'badge-blue'],
    'Посторонняя переписка': ['Постороннее', 'badge-neutral'],
    'Служебная переписка': ['Служебное', 'badge-violet'],
    'Недостаточно содержания': ['Недостаточно данных', 'badge-amber']
  };

  const state = {
    data: null,
    records: [],
    view: 'dashboard',
    query: '',
    status: 'all',
    payment: 'all',
    category: 'all',
    topic: 'all',
    sort: 'recent',
    selectedId: null,
    showAllMessages: false,
    theme: localStorage.getItem('avito-crm-theme') || 'light'
  };

  const soundState = {
    enabled: localStorage.getItem('avito-crm-sounds') === 'on',
    context: null
  };

  function updateSoundUI() {
    const button = $('#soundToggle');
    if (!button) return;
    button.classList.toggle('is-on', soundState.enabled);
    button.setAttribute('aria-pressed', String(soundState.enabled));
    const stateLabel = $('.sound-toggle-state', button);
    if (stateLabel) stateLabel.textContent = soundState.enabled ? 'Вкл.' : 'Выкл.';
  }

  function playUiSound(kind = 'click') {
    if (!soundState.enabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!soundState.context) soundState.context = new AudioContext();
      const context = soundState.context;
      if (context.state === 'suspended') context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      const tones = { click: [440, 0.045], open: [520, 0.07], success: [660, 0.12], warning: [240, 0.12] };
      const [frequency, duration] = tones[kind] || tones.click;
      oscillator.type = kind === 'success' ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, now);
      if (kind === 'success') oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.35, now + duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.055, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    } catch {
      // Audio is an optional enhancement; it must never interrupt CRM work.
    }
  }

  function recordId(record) {
    return record.source_dialogue_id || record.sourceDialogue || record.auditId || record.dialogueId || record.avito_dialogue_id || record.name;
  }
  function recordName(record) { return record.nick || record.name || 'Без имени'; }
  function recordIssue(record) {
    if (record.service && !/^https?:\/\//i.test(String(record.service))) return String(record.service);
    const incoming = getMessages(record).find((message) => message.direction === 'incoming' && message.text);
    return incoming?.text || record.advertisement || record.adId || 'Вопрос не указан';
  }
  function recordCategory(record) { return record.category || (record.is_client === false ? 'Посторонняя переписка' : 'Юридический клиент'); }
  function getMessages(record) { return Array.isArray(record.messages) ? record.messages : []; }
  function latestMessage(record) {
    return getMessages(record).filter((message) => message.text).slice(-1)[0] || null;
  }
  function latestIncoming(record) {
    return getMessages(record).filter((message) => message.direction === 'incoming' && message.text).slice(-1)[0] || null;
  }
  function lastActivity(record) { return record.lastMessageAt || latestMessage(record)?.timestamp || record.date; }
  function statusMeta(record) { return statusMap[record.status] || statusMap.unknown; }
  function stageMeta(record) { return stageMap[record.lifecycle_stage] || stageMap.unknown; }
  function paymentMeta(record) { return paymentMap[record.payment_status] || (record.paid ? paymentMap.marked_paid_in_legacy_crm : paymentMap.unknown_or_not_confirmed); }
  function badge(label, className = 'badge-neutral') { return `<span class="badge ${className}">${escapeHtml(label)}</span>`; }
  function badgeFor(mapEntry) { return badge(mapEntry[0], mapEntry[1]); }
  function topics(record) { return asArray(record.topics).map(String).filter(Boolean); }
  function allText(record) {
    const audit = record.derived_analysis || {};
    return [recordName(record), record.nick, record.name, record.service, record.advertisement, record.adId, record.source_dialogue_id, record.sourceDialogue, record.category, record.lifecycle_stage, record.payment_status, ...topics(record), ...asArray(record.client_intents), ...asArray(record.objections), audit.summary_topics, audit.questions, audit.stages_text, audit.outcome, ...getMessages(record).map((message) => message.text)].join(' ').toLowerCase();
  }

  function getFilteredRecords() {
    const query = state.query.trim().toLowerCase();
    const filtered = state.records.filter((record) => {
      if (query && !allText(record).includes(query)) return false;
      if (state.status !== 'all' && (record.status || 'unknown') !== state.status) return false;
      if (state.payment !== 'all' && (record.payment_status || (record.paid ? 'marked_paid_in_legacy_crm' : 'unknown_or_not_confirmed')) !== state.payment) return false;
      if (state.category !== 'all' && recordCategory(record) !== state.category) return false;
      if (state.topic !== 'all' && !topics(record).includes(state.topic)) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      if (state.sort === 'amount') return toNumber(b.price) - toNumber(a.price);
      if (state.sort === 'messages') return (b.messageCount || getMessages(b).length) - (a.messageCount || getMessages(a).length);
      if (state.sort === 'oldest') return parseDate(lastActivity(a)) - parseDate(lastActivity(b));
      return parseDate(lastActivity(b)) - parseDate(lastActivity(a));
    });
  }

  function showToast(message) {
    const region = $('#toastRegion');
    if (!region) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    region.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  function viewMeta(view) {
    return {
      dashboard: ['РАБОЧИЙ КАБИНЕТ', 'Обзор'],
      clients: ['ПОРТФЕЛЬ КЛИЕНТОВ', 'Клиенты'],
      conversations: ['РАБОТА С ЧАТОМ', 'Переписки'],
      finance: ['КОНТРОЛЬ ОПЛАТ', 'Финансы'],
      analytics: ['АНАЛИТИКА ПРАКТИКИ', 'Аналитика'],
      settings: ['ИМПОРТ И ДАННЫЕ', 'Данные и импорт']
    }[view] || ['AVITO LEGAL OS', 'CRM'];
  }
  function setView(view) {
    state.view = view;
    $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
    const [eyebrow, title] = viewMeta(view);
    $('#viewEyebrow').textContent = eyebrow;
    $('#viewTitle').textContent = title;
    $('#sidebar').classList.remove('open');
    render();
  }

  function render() {
    if (!state.data) return;
    $('#navClientCount').textContent = state.records.length;
    const content = $('#appContent');
    if (state.view === 'dashboard') content.innerHTML = renderDashboard();
    else if (state.view === 'clients') content.innerHTML = renderClients();
    else if (state.view === 'conversations') content.innerHTML = renderConversations();
    else if (state.view === 'finance') content.innerHTML = renderFinance();
    else if (state.view === 'analytics') content.innerHTML = renderAnalytics();
    else content.innerHTML = renderSettings();
    if (state.view === 'settings') bindDropZone();
  }

  function renderDashboard() {
    const records = state.records;
    const paid = records.filter((record) => record.paid || record.payment_status === 'confirmed_textual_account_message' || record.payment_status === 'marked_paid_in_legacy_crm');
    const paidSum = paid.reduce((sum, record) => sum + toNumber(record.price), 0);
    const totalPotential = records.reduce((sum, record) => sum + toNumber(record.price), 0);
    const active = records.filter((record) => ['work', 'done'].includes(record.status)).length;
    const statusCounts = ['done', 'work', 'wait', 'cancel'].map((status) => [status, records.filter((record) => record.status === status).length]);
    const total = Math.max(records.length, 1);
    let angle = 0;
    const colorMap = { done: 'var(--green)', work: 'var(--blue)', wait: 'var(--amber)', cancel: 'var(--red)' };
    const segments = statusCounts.map(([key, count]) => {
      const start = angle;
      angle += count / total * 360;
      return `${colorMap[key]} ${start}deg ${angle}deg`;
    });
    if (!segments.length) segments.push('var(--line) 0deg 360deg');
    const topicCounts = new Map();
    records.forEach((record) => topics(record).forEach((topic) => topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1)));
    const topTopics = [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
    const recent = [...records].sort((a, b) => parseDate(lastActivity(b)) - parseDate(lastActivity(a))).slice(0, 6);
    const attention = [...records].filter((record) => record.status === 'wait').sort((a, b) => parseDate(lastActivity(b)) - parseDate(lastActivity(a))).slice(0, 5);
    return `
      <div class="page-intro"><div><h2>Рабочий кабинет</h2><p>Ваши ручные статусы сохранены; архивные новые обращения закрыты как «Завершён» или «Отказ».</p></div><div class="page-actions"><button class="button button-soft" data-action="add-client">Добавить клиента</button><button class="button button-primary" data-action="go-import">Импортировать базу</button></div></div>
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Юридические клиенты <span class="kpi-icon">◉</span></div><div class="kpi-value">${records.length}</div><div class="kpi-meta">в рабочем реестре</div></div>
        <div class="kpi-card green"><div class="kpi-label">Оплата отмечена <span class="kpi-icon">✓</span></div><div class="kpi-value">${formatMoney(paidSum)}</div><div class="kpi-meta">${paid.length} клиент${paid.length === 1 ? '' : 'ов'} с отметкой оплаты</div></div>
        <div class="kpi-card amber"><div class="kpi-label">Сумма по карточкам <span class="kpi-icon">₽</span></div><div class="kpi-value">${formatMoney(totalPotential)}</div><div class="kpi-meta">исторические цены из базы</div></div>
        <div class="kpi-card violet"><div class="kpi-label">Активные / завершённые <span class="kpi-icon">↗</span></div><div class="kpi-value">${active}</div><div class="kpi-meta">из ${records.length} клиентских записей</div></div>
      </div>
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><div><h3>Воронка обращений</h3><p>Статусы из исходной CRM-карточки</p></div><span class="badge badge-neutral">${records.length} записей</span></div><div class="panel-body status-chart"><div class="donut" style="background: conic-gradient(${segments.join(',')})"><div class="donut-center"><strong>${records.length}</strong><span>клиентов</span></div></div><div class="legend">${statusCounts.map(([key, count]) => `<div class="legend-row"><span class="legend-label"><i class="legend-dot" style="background:${colorMap[key]}"></i>${statusMap[key][0]}</span><strong class="legend-value">${count}</strong></div>`).join('')}</div></div></section>
        <section class="panel"><div class="panel-head"><div><h3>Требуют внимания</h3><p>Паузы и ожидающие решения</p></div><button class="mini-button" data-action="go-clients">Все клиенты</button></div><div class="panel-body"><div class="list">${attention.length ? attention.map((record) => `<div class="list-row" data-action="edit-record" data-id="${escapeHtml(recordId(record))}"><div class="list-main"><div class="list-title">${escapeHtml(recordName(record))}</div><div class="list-sub">${escapeHtml(recordIssue(record))}</div></div><div class="list-value">${badgeFor(statusMeta(record))}<small>${formatDate(lastActivity(record))}</small></div></div>`).join('') : '<div class="empty-state">Нет записей, требующих внимания.</div>'}</div></div></section>
      </div>
      <div class="grid-2 section-gap">
        <section class="panel"><div class="panel-head"><div><h3>Последнее изменение</h3><p>Карточки, обновлённые последними</p></div><button class="mini-button" data-action="go-clients">Открыть все</button></div><div class="panel-body"><div class="list">${recent.map((record) => `<div class="list-row" data-action="edit-record" data-id="${escapeHtml(recordId(record))}"><div class="client-cell"><div class="avatar">${escapeHtml(initials(recordName(record)))}</div><div class="list-main"><div class="list-title">${escapeHtml(recordName(record))}</div><div class="list-sub">${escapeHtml(recordIssue(record))}</div></div></div><div class="list-value">${badgeFor(statusMeta(record))}<small>${formatDateTime(lastActivity(record))}</small></div></div>`).join('')}</div></div></section>
        <section class="panel"><div class="panel-head"><div><h3>Темы обращений</h3><p>По меткам клиентских карточек</p></div><button class="mini-button" data-action="go-analytics">Аналитика</button></div><div class="panel-body"><div class="topic-list">${topTopics.length ? topTopics.map(([topic, count]) => `<div class="topic-row"><div class="topic-head"><span>${escapeHtml(topic)}</span><strong>${count}</strong></div><div class="bar"><span style="width:${Math.max(8, Math.round(count / topTopics[0][1] * 100))}%"></span></div></div>`).join('') : '<div class="empty-state">Темы не определены.</div>'}</div></div></section>
      </div>`;
  }

  function filterOptions() {
    const topicSet = new Set(state.records.flatMap((record) => topics(record)));
    const categorySet = new Set(state.records.map(recordCategory));
    return { topics: [...topicSet].sort((a, b) => a.localeCompare(b, 'ru')), categories: [...categorySet].sort((a, b) => a.localeCompare(b, 'ru')) };
  }
  function renderClients() {
    const records = getFilteredRecords();
    const options = filterOptions();
    return `<div class="page-intro"><div><h2>Клиенты</h2><p>Ваши 97 исходных CRM-карточек сохранены. Новые записи находятся только в «Завершён» или «Отказ».</p></div><div class="page-actions"><button class="button button-primary" data-action="add-client">Добавить клиента</button></div></div>
      <div class="toolbar"><input class="field" id="clientSearch" value="${escapeHtml(state.query)}" placeholder="Имя, ник, услуга, тема или текст сообщения" /><select class="select" id="statusFilter"><option value="all">Все статусы</option>${Object.entries(statusMap).filter(([key]) => key !== 'unknown').map(([key, item]) => `<option value="${key}" ${state.status === key ? 'selected' : ''}>${item[0]}</option>`).join('')}</select><select class="select" id="paymentFilter"><option value="all">Любая оплата</option><option value="confirmed_textual_account_message" ${state.payment === 'confirmed_textual_account_message' ? 'selected' : ''}>Подтверждено в чате</option><option value="marked_paid_in_legacy_crm" ${state.payment === 'marked_paid_in_legacy_crm' ? 'selected' : ''}>Оплачено в старой CRM</option><option value="unknown_or_not_confirmed" ${state.payment === 'unknown_or_not_confirmed' ? 'selected' : ''}>Не подтверждено</option></select><select class="select" id="categoryFilter"><option value="all">Все категории</option>${options.categories.map((category) => `<option value="${escapeHtml(category)}" ${state.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select><select class="select" id="topicFilter"><option value="all">Все темы</option>${options.topics.map((topic) => `<option value="${escapeHtml(topic)}" ${state.topic === topic ? 'selected' : ''}>${escapeHtml(topic)}</option>`).join('')}</select><select class="select" id="sortFilter"><option value="recent" ${state.sort === 'recent' ? 'selected' : ''}>Сначала новые</option><option value="oldest" ${state.sort === 'oldest' ? 'selected' : ''}>Сначала старые</option><option value="amount" ${state.sort === 'amount' ? 'selected' : ''}>По сумме</option><option value="messages" ${state.sort === 'messages' ? 'selected' : ''}>По объёму чата</option></select><span class="result-count">Показано ${records.length} из ${state.records.length}</span></div>
      <section class="panel table-panel"><table class="data-table"><thead><tr><th>Клиент</th><th>Вопрос / услуга</th><th>Статус</th><th>Оплата</th><th>Тип карточки</th><th>Последнее изменение</th></tr></thead><tbody>${records.length ? records.map((record) => `<tr data-action="edit-record" data-id="${escapeHtml(recordId(record))}"><td><div class="client-cell"><div class="avatar">${escapeHtml(initials(recordName(record)))}</div><div><div class="client-name">${escapeHtml(recordName(record))}</div><div class="client-nick">${escapeHtml(record.nick || record.name || 'Ник не указан')} · ${escapeHtml(record.source_dialogue_id || '')}</div></div></div></td><td class="issue-cell"><div class="issue-title">${escapeHtml(recordIssue(record))}</div><div class="issue-meta">${escapeHtml(record.advertisement || record.adId || 'Объявление не указано')}</div></td><td>${badgeFor(statusMeta(record))}</td><td>${badgeFor(paymentMeta(record))}</td><td>${record.record_type === 'new_archive_client' ? badge('Архивная карточка', 'badge-violet') : badge('CRM-карточка', 'badge-neutral')}</td><td>${formatDate(lastActivity(record))}</td></tr>`).join('') : '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">⌕</div>Ничего не найдено. Измените запрос или фильтры.</div></td></tr>'}</tbody></table></section>`;
  }

  function renderConversations() {
    const records = getFilteredRecords();
    if (!state.selectedId || !records.some((record) => recordId(record) === state.selectedId)) state.selectedId = records[0] ? recordId(records[0]) : null;
    const selected = state.records.find((record) => recordId(record) === state.selectedId) || records[0];
    return `<div class="page-intro"><div><h2>Переписки</h2><p>Выберите диалог, чтобы увидеть историю и подготовить ответ для Gemini.</p></div><div class="page-actions"><button class="button button-soft" data-action="copy-latest" ${selected ? '' : 'disabled'}>Скопировать последнее сообщение</button></div></div><div class="detail-layout"><section class="panel"><div class="panel-head"><div><h3>Диалоги</h3><p>${records.length} доступно после фильтров</p></div><span class="badge badge-neutral">${state.records.length} всего</span></div><div class="panel-body" style="padding-top:8px"><input class="field" id="conversationSearch" value="${escapeHtml(state.query)}" placeholder="Поиск по перепискам" style="width:100%;margin-bottom:10px" /><div class="list">${records.length ? records.slice(0, 100).map((record) => `<div class="list-row ${recordId(record) === state.selectedId ? 'selected-row' : ''}" data-action="select-record" data-id="${escapeHtml(recordId(record))}" style="cursor:pointer"><div class="client-cell"><div class="avatar">${escapeHtml(initials(recordName(record)))}</div><div class="list-main"><div class="list-title">${escapeHtml(recordName(record))}</div><div class="list-sub">${escapeHtml(recordIssue(record))}</div></div></div><div class="list-value">${badgeFor(statusMeta(record))}<small>${formatDate(lastActivity(record))}</small></div></div>`).join('') : '<div class="empty-state">Диалоги не найдены.</div>'}</div></div></section>${selected ? renderRecordDetail(selected) : '<section class="panel"><div class="empty-state">Выберите диалог.</div></section>'}</div>`;
  }

  function renderRecordDetail(record) {
    const msgs = getMessages(record);
    const visible = state.showAllMessages ? msgs : msgs.slice(-100);
    const audit = record.derived_analysis || {};
    const contacts = asArray(record.contacts_found);
    const amountMentions = asArray(record.amount_mentions);
    const stage = stageMeta(record);
    return `<section class="panel profile-card"><div class="profile-top"><div class="profile-id"><div class="avatar">${escapeHtml(initials(recordName(record)))}</div><div><div class="profile-name">${escapeHtml(recordName(record))}</div><div class="profile-nick">${escapeHtml(record.nick || 'Ник не указан')} · ${escapeHtml(record.source_dialogue_id || record.sourceDialogue || '')}</div></div></div><div class="profile-actions"><button class="button button-soft" data-action="edit-record" data-id="${escapeHtml(recordId(record))}">Изменить</button><button class="button" data-action="export-record" data-id="${escapeHtml(recordId(record))}">JSON</button></div></div><div class="tags" style="margin-top:14px">${badgeFor(stage)}${badgeFor(paymentMeta(record))}${badgeFor(statusMeta(record))}</div><div class="info-grid"><div class="info-item"><div class="info-label">Услуга / первый вопрос</div><div class="info-value">${escapeHtml(recordIssue(record))}</div></div><div class="info-item"><div class="info-label">Сумма в карточке</div><div class="info-value">${formatMoney(record.price)}</div></div><div class="info-item"><div class="info-label">Активность</div><div class="info-value">${formatDate(record.firstMessageAt)} — ${formatDate(lastActivity(record))}</div></div><div class="info-item"><div class="info-label">История переписки</div><div class="info-value">Не хранится</div></div><div class="info-item"><div class="info-label">Объявление</div><div class="info-value">${escapeHtml(record.advertisement || record.adId || '—')}</div></div><div class="info-item"><div class="info-label">Источник</div><div class="info-value">${escapeHtml(record.source_files?.[0] || 'Avito export')}</div></div></div><div class="detail-block"><h4>Темы</h4><div class="tags">${topics(record).slice(0, 20).map((topic) => `<span class="tag">${escapeHtml(topic)}</span>`).join('') || '<span class="muted">Не определены</span>'}</div></div><div class="detail-block"><h4>Контакты и платёжные сигналы</h4><div class="tags">${contacts.map((contact) => `<span class="tag">${escapeHtml(typeof contact === 'string' ? contact : JSON.stringify(contact))}</span>`).join('')}${amountMentions.map((amount) => `<span class="tag">Сумма: ${escapeHtml(typeof amount === 'string' ? amount : JSON.stringify(amount))}</span>`).join('')}${!contacts.length && !amountMentions.length ? '<span class="muted">В доступных данных не найдено.</span>' : ''}</div></div><div class="detail-block"><h4>История сообщений</h4><div class="message-stream">${visible.length ? visible.map((message) => `<article class="message ${escapeHtml(message.direction || 'unknown')}"><div class="message-meta"><span class="message-sender">${escapeHtml(message.sender || (message.direction === 'incoming' ? recordName(record) : 'Аккаунт'))}</span><span>${escapeHtml(formatDateTime(message.timestamp_display || message.timestamp))}</span></div><div class="message-text">${escapeHtml(message.text || `[${message.type_label || 'сообщение без текста'}]`)}</div><div class="message-tools"><button class="mini-button" data-action="copy-message" data-message="${escapeHtml(message.text || '')}">Копировать</button></div></article>`).join('') : '<div class="empty-state">Текстовых сообщений нет.</div>'}</div>${msgs.length > 100 ? `<div style="text-align:center;margin-top:9px"><button class="button button-soft" data-action="toggle-messages">${state.showAllMessages ? 'Показать последние 100' : `Показать все ${msgs.length} сообщений`}</button></div>` : ''}</div><div class="detail-block"><h4>Производная аналитика аудита</h4><div class="audit-box"><p><span class="audit-label">Итог</span><br>${escapeHtml(textValue(audit.outcome || audit.summary_topics || audit.full_text_reading, 'Нет отдельного итога'))}</p><p><span class="audit-label">Вопросы</span><br>${escapeHtml(textValue(audit.questions, 'Не выделены'))}</p><p><span class="audit-label">Этапы / ограничения</span><br>${escapeHtml(textValue(audit.stages_text || audit.problems_and_limits, 'Не выделены'))}</p><p><span class="audit-label">Уровень проверки</span><br>Поля аудита являются производной разметкой; юридические факты и банковская оплата автоматически не подтверждаются.</p></div></div></section>`;
  }

  function renderFinance() {
    const finance = Array.isArray(state.data.finance) ? state.data.finance : [];
    const payments = Array.isArray(state.data.payments) ? state.data.payments : [];
    const paid = state.records.filter((record) => record.paid || record.payment_status === 'confirmed_textual_account_message' || record.payment_status === 'marked_paid_in_legacy_crm');
    const paidSum = paid.reduce((sum, record) => sum + toNumber(record.price), 0);
    const potential = state.records.reduce((sum, record) => sum + toNumber(record.price), 0);
    return `<div class="page-intro"><div><h2>Финансы</h2><p>Исходные финансовые строки и платёжные сигналы из переписок.</p></div><div class="page-actions"><button class="button button-primary" data-action="export-data">Экспорт JSON</button></div></div><div class="finance-summary"><div class="finance-card"><span>Текстовые подтверждения оплаты</span><strong>${formatMoney(paidSum)}</strong><small>${paid.length} карточек</small></div><div class="finance-card"><span>Сумма по историческим ценам</span><strong>${formatMoney(potential)}</strong><small>не прогноз выручки</small></div><div class="finance-card"><span>Исходные финансовые записи</span><strong>${finance.length}</strong><small>сохранены без потери полей</small></div></div><section class="panel table-panel"><div class="panel-head"><div><h3>Исходный финансовый реестр</h3><p>Данные из резервной копии CRM</p></div></div><table class="data-table finance-table"><thead><tr><th>Запись</th><th>Поля</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>${finance.length ? finance.map((row, index) => { const values = Object.entries(row || {}); const amount = values.find(([key]) => /amount|sum|price|стоим|сумм/i.test(key)); return `<tr><td>Finance ${index + 1}</td><td><div class="issue-title">${escapeHtml(values.slice(0, 3).map(([key, value]) => `${key}: ${textValue(value)}`).join(' · '))}</div></td><td class="money">${escapeHtml(amount ? textValue(amount[1]) : '—')}</td><td>${badge('Исходная запись', 'badge-neutral')}</td></tr>`; }).join('') : '<tr><td colspan="4"><div class="empty-state">Финансовых строк нет.</div></td></tr>'}</tbody></table></section><section class="panel table-panel section-gap"><div class="panel-head"><div><h3>Платёжные сигналы</h3><p>Текстовые подтверждения аккаунта; не банковская сверка.</p></div><span class="badge badge-amber">${payments.length}</span></div><table class="data-table finance-table"><thead><tr><th>Диалог</th><th>Тип сигнала</th><th>Источник</th><th>Комментарий</th></tr></thead><tbody>${payments.length ? payments.map((payment) => `<tr><td>${escapeHtml(payment.source_dialogue_id || payment.dialogueId || payment.client || '—')}</td><td>${badge('Текстовое подтверждение', 'badge-green')}</td><td>${escapeHtml(payment.message_id || payment.payment_evidence_message_id || '—')}</td><td>${escapeHtml(textValue(payment.note || payment.evidence || payment.status, 'Сверить вручную'))}</td></tr>`).join('') : '<tr><td colspan="4"><div class="empty-state">Платёжных сигналов нет.</div></td></tr>'}</tbody></table></section><p class="finance-note">Оплата в этом разделе считается подтверждённой только как текстовый сигнал из данных аккаунта или старая отметка CRM. Скриншоты, просьбы отправить реквизиты и упоминания суммы не превращаются в банковскую выписку.</p>`;
  }

  function metricRows(entries, max = 8) {
    const rows = entries.slice(0, max);
    const highest = Math.max(...rows.map(([, count]) => count), 1);
    return rows.length ? rows.map(([label, count]) => `<div class="metric-list-row"><span class="label">${escapeHtml(label)}</span><div class="bar"><span style="width:${Math.max(5, Math.round(count / highest * 100))}%"></span></div><strong class="count">${count}</strong></div>`).join('') : '<div class="empty-state">Нет данных.</div>';
  }
  function renderAnalytics() {
    const records = state.records;
    const categoryCounts = [...new Map(records.map((record) => [recordCategory(record), records.filter((item) => recordCategory(item) === recordCategory(record)).length])).entries()].sort((a, b) => b[1] - a[1]);
    const stageCounts = Object.entries(statusMap).filter(([key]) => key !== 'unknown').map(([key, meta]) => [meta[0], records.filter((record) => record.status === key).length]).sort((a, b) => b[1] - a[1]);
    const topicCounts = [...records.flatMap((record) => topics(record)).reduce((map, topic) => map.set(topic, (map.get(topic) || 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1]);
    return `<div class="page-intro"><div><h2>Аналитика</h2><p>Рабочий реестр: ${records.length} карточек. Переписки сознательно исключены из этой версии CRM.</p></div><div class="page-actions"><button class="button button-soft" data-action="go-clients">Открыть реестр</button></div></div><div class="grid-3"><div class="kpi-card"><div class="kpi-label">Переписки в CRM</div><div class="kpi-value">Нет</div><div class="kpi-meta">текстовые истории удалены</div></div><div class="kpi-card green"><div class="kpi-label">Темы карточек</div><div class="kpi-value">${topicCounts.length}</div><div class="kpi-meta">метки сохранены без текста чатов</div></div><div class="kpi-card amber"><div class="kpi-label">Платёжные сигналы</div><div class="kpi-value">${state.data.payments?.length || 0}</div><div class="kpi-meta">без текстовых доказательств</div></div></div><div class="analytics-grid section-gap"><section class="panel"><div class="panel-head"><div><h3>Темы карточек</h3><p>Краткие метки без истории переписки</p></div></div><div class="panel-body"><div class="metric-list">${metricRows(topicCounts, 14)}</div></div></section><section class="panel"><div class="panel-head"><div><h3>Статусы клиентов</h3><p>Ручные статусы и закрытые архивные записи</p></div></div><div class="panel-body"><div class="metric-list">${metricRows(stageCounts, 8)}</div></div></section></div><div class="analytics-grid section-gap"><section class="panel"><div class="panel-head"><div><h3>Категории архива</h3><p>Вне рабочего реестра сохранено ${state.data.nonClientRecordCount || 0} служебных записей без текста</p></div></div><div class="panel-body"><div class="metric-list">${metricRows(categoryCounts, 8)}</div></div></section><section class="panel"><div class="panel-head"><div><h3>Состав данных</h3><p>В CRM оставлены только поля карточки</p></div></div><div class="panel-body"><div class="settings-list"><div class="setting-row"><span>Тексты переписок</span><strong>Удалены</strong></div><div class="setting-row"><span>Архив диалогов</span><strong>Не загружается</strong></div><div class="setting-row"><span>Платёжные доказательства</span><strong>Только метаданные</strong></div><div class="setting-row"><span>Редактирование карточек</span><strong>Доступно</strong></div></div></div></section></div>`;
  }

  function renderSettings() {
    const source = state.data.source || {};
    return `<div class="page-intro"><div><h2>Данные и импорт</h2><p>Управляйте локальной копией CRM и экспортом для GitHub.</p></div><div class="page-actions"><button class="button button-primary" data-action="export-data">Экспорт текущей базы</button><button class="button button-danger" data-action="reset-data">Сбросить локальный импорт</button></div></div><div class="settings-grid"><section class="panel"><div class="panel-head"><div><h3>Импорт JSON</h3><p>Подходит файл с разделом <code>clients</code>; дополнительные разделы сохраняются.</p></div></div><div class="panel-body"><div class="import-zone" id="dropZone"><strong>Загрузите экспорт CRM</strong><p>Выберите JSON-файл или перетащите его сюда. После импорта база используется в этой вкладке; браузер пытается сохранить её локально.</p><button class="button button-primary" data-action="go-import">Выбрать JSON</button></div><div class="warning-box" style="margin-top:15px">В базе есть персональные данные и рабочие CRM-поля. Используйте приватный репозиторий GitHub и не публикуйте <code>data/crm.json</code> открыто.</div></div></section><section class="panel"><div class="panel-head"><div><h3>Состояние базы</h3><p>Текущий набор данных в браузере</p></div></div><div class="panel-body"><div class="settings-list"><div class="setting-row"><span>Юридические клиенты</span><strong>${state.records.length}</strong></div><div class="setting-row"><span>Диалоги вне клиентского реестра</span><strong>${state.data.nonClientRecordCount || state.data.nonClientRecords?.length || 0}</strong></div><div class="setting-row"><span>Старые карточки из резервной копии</span><strong>${state.data.legacyClients?.length || 0}</strong></div><div class="setting-row"><span>Тексты переписок</span><strong>Удалены</strong></div><div class="setting-row"><span>Источник</span><strong>${escapeHtml(source.chatExport || 'Avito export')}</strong></div><div class="setting-row"><span>Период</span><strong>${escapeHtml(source.sourcePeriod ? `${source.sourcePeriod.from} — ${source.sourcePeriod.to}` : '—')}</strong></div></div></div></section></div><section class="panel section-gap"><div class="panel-head"><div><h3>Как обновлять</h3><p>Рекомендуемый порядок работы с GitHub-версией</p></div></div><div class="panel-body"><div class="settings-list"><div class="setting-row"><span>1</span><strong>Импортируйте новый JSON через этот раздел</strong></div><div class="setting-row"><span>2</span><strong>Проверьте карточки, фильтры и статусы</strong></div><div class="setting-row"><span>3</span><strong>Нажмите «Экспорт текущей базы» и замените data/crm.json в приватном репозитории</strong></div></div></div></section>`;
  }

  function bindDropZone() {
    const zone = $('#dropZone');
    if (!zone) return;
    zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('is-dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
    zone.addEventListener('drop', async (event) => {
      event.preventDefault();
      zone.classList.remove('is-dragover');
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      try {
        const imported = JSON.parse(await file.text());
        importData(imported);
        showToast(`Файл ${file.name} загружен`);
      } catch (error) { showToast(`Ошибка импорта: ${error.message}`); }
    });
  }

  function closeClientEditor() {
    const modal = $('#clientEditorModal');
    if (modal) modal.remove();
  }

  function openClientEditor(record = null) {
    closeClientEditor();
    const isNew = !record;
    const draft = record || {
      date: new Intl.DateTimeFormat('ru-RU').format(new Date()),
      name: '', nick: '', adId: '', service: '', price: 0, paid: false,
      status: 'wait', followUp: '', source_dialogue_id: `manual-${Date.now()}`
    };
    const modal = document.createElement('div');
    modal.id = 'clientEditorModal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="clientEditorTitle"><div class="modal-head"><div><span class="eyebrow">${isNew ? 'НОВАЯ КАРТОЧКА' : 'РЕДАКТИРОВАНИЕ'}</span><h2 id="clientEditorTitle">${isNew ? 'Добавить клиента' : 'Изменить карточку'}</h2></div><button class="icon-button" type="button" data-action="close-editor" aria-label="Закрыть">×</button></div><form id="clientEditorForm"><input type="hidden" name="id" value="${escapeHtml(record ? recordId(record) : draft.source_dialogue_id)}" /><div class="form-grid"><label class="form-field"><span>Имя клиента</span><input name="name" required value="${escapeHtml(draft.name || '')}" placeholder="Например, Мария" /></label><label class="form-field"><span>Никнейм Avito</span><input name="nick" value="${escapeHtml(draft.nick || '')}" placeholder="Ник клиента" /></label><label class="form-field"><span>Дата</span><input name="date" value="${escapeHtml(draft.date || '')}" placeholder="20.11.2026" /></label><label class="form-field"><span>Город / объявление</span><input name="adId" value="${escapeHtml(draft.adId || '')}" placeholder="Город или название объявления" /></label><label class="form-field"><span>Цена, ₽</span><input name="price" type="number" min="0" step="500" value="${escapeHtml(toNumber(draft.price))}" /></label><label class="form-field"><span>Статус</span><select name="status"><option value="wait" ${draft.status === 'wait' ? 'selected' : ''}>Ожидание</option><option value="work" ${draft.status === 'work' ? 'selected' : ''}>В работе</option><option value="done" ${draft.status === 'done' ? 'selected' : ''}>Завершён</option><option value="cancel" ${draft.status === 'cancel' ? 'selected' : ''}>Отказ</option></select></label><label class="form-field"><span>Следующее действие / срок</span><input name="followUp" value="${escapeHtml(draft.followUp || '')}" placeholder="Дата или заметка" /></label><label class="form-field"><span>Оплата</span><select name="payment_status"><option value="unknown_or_not_confirmed" ${draft.payment_status === 'unknown_or_not_confirmed' && !draft.paid || (!draft.payment_status && !draft.paid) ? 'selected' : ''}>Не подтверждено</option><option value="confirmed_textual_account_message" ${draft.payment_status === 'confirmed_textual_account_message' ? 'selected' : ''}>Подтверждено в чате</option><option value="marked_paid_in_legacy_crm" ${draft.payment_status === 'marked_paid_in_legacy_crm' || (!draft.payment_status && draft.paid) ? 'selected' : ''}>Оплачено вручную / старая CRM</option></select></label></div><label class="form-field"><span>Описание услуги или заметка</span><textarea name="service" rows="5" placeholder="Что нужно сделать клиенту">${escapeHtml(draft.service || '')}</textarea></label><div class="modal-note">Статус можно менять вручную в любой момент. Архивные новые записи при загрузке автоматически получают только «Завершён» или «Отказ».</div><div class="modal-actions"><button class="button" type="button" data-action="close-editor">Отмена</button><button class="button button-primary" type="button" id="saveClientButton">${isNew ? 'Создать карточку' : 'Сохранить изменения'}</button></div></form></section>`;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('is-visible'));
    const form = $('#clientEditorForm', modal);
    const saveButton = $('#saveClientButton', modal);
    saveButton.addEventListener('click', (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      try {
        saveClientForm(form);
      } catch (error) {
        console.error('CRM client save failed:', error);
        showToast('Ошибка сохранения: ' + (error?.message || 'неизвестная ошибка'));
      }
    });
    const first = $('input[name="name"]', modal);
    if (first) first.focus();
  }

  function saveClientForm(form) {
    const formData = new FormData(form);
    const id = String(formData.get('id') || `manual-${Date.now()}`);
    const existingIndex = state.records.findIndex((record) => recordId(record) === id);
    const previous = existingIndex >= 0 ? state.records[existingIndex] : null;
    const record = {
      ...(previous || {}),
      date: String(formData.get('date') || ''),
      name: String(formData.get('name') || '').trim(),
      nick: String(formData.get('nick') || '').trim() || String(formData.get('name') || '').trim(),
      adId: String(formData.get('adId') || '').trim(),
      service: String(formData.get('service') || '').trim(),
      price: toNumber(formData.get('price')),
      paid: ['confirmed_textual_account_message', 'marked_paid_in_legacy_crm'].includes(String(formData.get('payment_status') || 'unknown_or_not_confirmed')),
      status: String(formData.get('status') || 'wait'),
      followUp: String(formData.get('followUp') || '').trim(),
      source_dialogue_id: previous?.source_dialogue_id || id,
      record_type: previous?.record_type || 'manual_client',
      is_client: true,
      manual_status_preserved: true,
      updated_manually_at: new Date().toISOString(),
      payment_status: String(formData.get('payment_status') || 'unknown_or_not_confirmed'),
      lifecycle_stage: ({ wait: 'paused', work: 'work_in_progress', done: 'completed', cancel: 'refused' })[String(formData.get('status') || 'wait')],
      messages: previous?.messages || [],
      messageCount: previous?.messageCount || (previous?.messages || []).length
    };
    if (!record.name) { showToast('Введите имя клиента'); return; }
    if (existingIndex >= 0) state.records[existingIndex] = record;
    else state.records.unshift(record);
    state.data.clients = state.records;
    persistManualOverrides();
    try { localStorage.setItem('avito-crm-data-v1', JSON.stringify(state.data)); } catch (error) { console.warn('CRM changes kept for this session; local cache is full.', error); }
    closeClientEditor();
    state.selectedId = recordId(record);
    // После сохранения сразу показываем карточку: сбрасываем фильтры, которые могли скрыть новую запись.
    state.query = '';
    state.status = 'all';
    state.payment = 'all';
    state.category = 'all';
    state.topic = 'all';
    state.sort = 'recent';
    playUiSound('success');
    setView('clients');
    showToast(existingIndex >= 0 ? 'Карточка обновлена' : 'Новый клиент добавлен');
  }

  function manualOverridePayload(record) {
    return {
      id: recordId(record), source_dialogue_id: record.source_dialogue_id, record_type: record.record_type,
      date: record.date || '', name: record.name || '', nick: record.nick || '', adId: record.adId || '',
      service: record.service || '', price: record.price || 0, paid: !!record.paid, status: record.status || 'wait',
      followUp: record.followUp || '', payment_status: record.payment_status || 'unknown_or_not_confirmed',
      lifecycle_stage: record.lifecycle_stage || 'unknown', manual_status_preserved: true, updated_manually_at: record.updated_manually_at || new Date().toISOString()
    };
  }

  function persistManualOverrides() {
    const overrides = state.records.filter((record) => record.updated_manually_at || record.record_type === 'manual_client').map(manualOverridePayload);
    try { localStorage.setItem('avito-crm-overrides-v1', JSON.stringify(overrides)); } catch (error) { console.warn('Could not persist manual CRM overrides.', error); }
  }

  function applyManualOverrides(records) {
    let overrides = [];
    try { overrides = JSON.parse(localStorage.getItem('avito-crm-overrides-v1') || '[]'); } catch { overrides = []; }
    if (!Array.isArray(overrides) || !overrides.length) return records;
    const result = records.slice();
    overrides.forEach((override) => {
      const index = result.findIndex((record) => recordId(record) === (override.id || override.source_dialogue_id));
      if (index >= 0) result[index] = { ...result[index], ...override };
      else if (override.record_type === 'manual_client') result.unshift({ ...override, is_client: true, messages: [], messageCount: 0 });
    });
    return result;
  }

  function copyText(text, success = 'Скопировано в буфер обмена') {
    if (!text) return;
    const done = () => showToast(success);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    try { document.execCommand('copy'); done(); } catch { showToast('Не удалось скопировать автоматически'); }
    area.remove();
  }
  function geminiPrompt(record) {
    const message = latestIncoming(record)?.text || latestMessage(record)?.text || '';
    return `ВХОД НА ТЕКУЩИЙ ОТВЕТ\n\nНИКНЕЙМ КЛИЕНТА В AVITO:\n${record.nick || record.name || ''}\n\nНОВОЕ СООБЩЕНИЕ КЛИЕНТА:\n${message}`;
  }
  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  function importData(payload) {
    if (!payload || !Array.isArray(payload.clients)) throw new Error('В JSON не найден массив clients');
    state.data = payload;
    state.records = payload.clients.filter((record) => record && (record.is_client !== false || record.record_type === 'legal_client' || record.category === 'Юридический клиент'));
    if (!state.records.length) state.records = payload.clients;
    state.records = applyManualOverrides(state.records);
    state.records.forEach((record) => {
      if ((record.is_new_archive_record || record.record_type === 'new_archive_client') && !record.manual_status_preserved && !record.updated_manually_at) {
        record.status = ['payment_confirmed', 'agreed_or_docs'].includes(record.lifecycle_stage) ? 'done' : 'cancel';
        record.followUp = '';
      }
    });
    state.selectedId = null;
    try {
      localStorage.setItem('avito-crm-data-v1', JSON.stringify(payload));
    } catch (storageError) {
      // Full chat archives can exceed the browser's localStorage quota; keep them in memory.
      console.warn('CRM data was loaded for this session but could not be cached locally:', storageError);
    }
    render();
    showToast(`Импортировано записей: ${state.records.length}`);
  }

  async function loadData() {
    document.documentElement.dataset.theme = state.theme;
    try {
      const cached = localStorage.getItem('avito-crm-data-v1');
      if (cached) {
        try {
          const cachedData = JSON.parse(cached);
          if (cachedData.schemaVersion === 'avito-crm-working-v4-no-conversations' || cachedData.schemaVersion === 'avito-crm-working-v4-no-conversations-strict') { importData(cachedData); return; }
          localStorage.removeItem('avito-crm-data-v1');
        } catch { localStorage.removeItem('avito-crm-data-v1'); }
      }
      const response = await fetch('data/crm.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      importData(await response.json());
    } catch (error) {
      $('#appContent').innerHTML = `<div class="panel"><div class="empty-state"><div class="empty-icon">!</div><h3>Не удалось загрузить базу</h3><p>${escapeHtml(error.message)}. Запустите через GitHub Pages или локальный HTTP-сервер, затем повторите импорт.</p><button class="button button-primary" data-action="go-import">Импортировать JSON</button></div></div>`;
    }
  }


  document.addEventListener('click', (event) => {
    if (event.target.closest('.button, .icon-button, .nav-item, .mini-button, .list-row, .data-table tbody tr')) playUiSound('click');
    const nav = event.target.closest('.nav-item');
    if (nav) { playUiSound('open'); setView(nav.dataset.view); return; }
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;
    const action = actionElement.dataset.action;
    if (action === 'go-clients') setView('clients');
    else if (action === 'go-conversations') setView('conversations');
    else if (action === 'go-analytics') setView('analytics');
    else if (action === 'go-import') $('#fileInput').click();
    else if (action === 'add-client') openClientEditor();
    else if (action === 'close-editor') closeClientEditor();
    else if (action === 'edit-record') { const record = state.records.find((item) => recordId(item) === actionElement.dataset.id); if (record) openClientEditor(record); }
    else if (action === 'open-record' || action === 'select-record') { state.selectedId = actionElement.dataset.id; setView('conversations'); }
    else if (action === 'copy-gemini') { const record = state.records.find((item) => recordId(item) === actionElement.dataset.id); if (record) { playUiSound('success'); copyText(geminiPrompt(record), 'Блок для Gemini скопирован'); } }
    else if (action === 'copy-latest') { const record = state.records.find((item) => recordId(item) === state.selectedId) || state.records[0]; if (record) copyText(latestIncoming(record)?.text || latestMessage(record)?.text || '', 'Последнее сообщение скопировано'); }
    else if (action === 'copy-message') copyText(actionElement.dataset.message || '');
    else if (action === 'toggle-messages') { state.showAllMessages = !state.showAllMessages; render(); }
    else if (action === 'export-data') downloadJson(state.data, `avito-crm-export-${new Date().toISOString().slice(0,10)}.json`);
    else if (action === 'export-record') { const record = state.records.find((item) => recordId(item) === actionElement.dataset.id); if (record) downloadJson(record, `${recordId(record)}-client.json`); }
    else if (action === 'reset-data') { localStorage.removeItem('avito-crm-data-v1'); localStorage.removeItem('avito-crm-overrides-v1'); showToast('Локальный импорт и ручные изменения удалены; перезагружаю исходную базу'); setTimeout(() => location.reload(), 450); }
  });

  document.addEventListener('submit', (event) => {
    if (event.target.id === 'clientEditorForm') {
      event.preventDefault();
      saveClientForm(event.target);
    }
  });
  document.addEventListener('click', (event) => {
    if (event.target.id === 'clientEditorModal') closeClientEditor();
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'globalSearch' || event.target.id === 'clientSearch' || event.target.id === 'conversationSearch') {
      state.query = event.target.value;
      if ($('#globalSearch') && $('#globalSearch').value !== state.query) $('#globalSearch').value = state.query;
      if (event.target.id !== 'globalSearch') render();
    }
  });
  document.addEventListener('change', (event) => {
    const id = event.target.id;
    if (id === 'statusFilter') state.status = event.target.value;
    if (id === 'paymentFilter') state.payment = event.target.value;
    if (id === 'categoryFilter') state.category = event.target.value;
    if (id === 'topicFilter') state.topic = event.target.value;
    if (id === 'sortFilter') state.sort = event.target.value;
    if (['statusFilter','paymentFilter','categoryFilter','topicFilter','sortFilter'].includes(id)) render();
  });
  $('#globalSearch').addEventListener('input', (event) => { state.query = event.target.value; if (state.view !== 'clients' && state.view !== 'conversations') setView('clients'); else render(); });
  $('#quickImport').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { importData(JSON.parse(await file.text())); showToast(`Файл ${file.name} загружен`); }
    catch (error) { showToast(`Ошибка импорта: ${error.message}`); }
    event.target.value = '';
  });
  $('#themeToggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    localStorage.setItem('avito-crm-theme', state.theme);
  });
  $('#soundToggle').addEventListener('click', () => {
    soundState.enabled = !soundState.enabled;
    localStorage.setItem('avito-crm-sounds', soundState.enabled ? 'on' : 'off');
    updateSoundUI();
    if (soundState.enabled) playUiSound('success');
  });
  $('#mobileMenu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#globalSearch').focus(); }
    if (event.key === 'Escape') $('#sidebar').classList.remove('open');
  });

  updateSoundUI();
  loadData();
})();
