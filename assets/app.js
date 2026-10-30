/* ==========================================================================
   Шахматка по неделе — планировщик мероприятий строительного контроля
   Vanilla JS, без сборки и внешних зависимостей.
   ========================================================================== */
(function () {
  'use strict';

  /* ── Справочники ────────────────────────────────────────────────────────── */
  const STORE_KEY = 'shahmatka.weekplan.v1';

  const MONTHS = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];

  const DAYS = [
    { name: 'Понедельник', code: 'ПН' },
    { name: 'Вторник', code: 'ВТ' },
    { name: 'Среда', code: 'СР' },
    { name: 'Четверг', code: 'ЧТ' },
    { name: 'Пятница', code: 'ПТ' },
    { name: 'Суббота', code: 'СБ' },
    { name: 'Воскресенье', code: 'ВС' }
  ];

  const TYPES = [
    { id: 'walk', label: 'Обход' },
    { id: 'staff', label: 'Штаб' },
    { id: 'vks', label: 'ВКС' }
  ];

  const TYPE_BY_ID = Object.fromEntries(TYPES.map((t) => [t.id, t]));

  /* ── Мелкие утилиты ─────────────────────────────────────────────────────── */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  const pad2 = (n) => String(n).padStart(2, '0');
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;

  function plural(n, forms) {
    const n10 = Math.abs(n) % 10;
    const n100 = Math.abs(n) % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
    return forms[2];
  }

  /* ── Дата и время ───────────────────────────────────────────────────────── */
  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function startOfWeek(date) {
    const d = startOfDay(date);
    const shift = (d.getDay() + 6) % 7; // 0 = понедельник
    d.setDate(d.getDate() - shift);
    return d;
  }

  function addDays(date, amount) {
    const d = startOfDay(date);
    d.setDate(d.getDate() + amount);
    return d;
  }

  const dateKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

  function parseDateKey(key) {
    const parts = String(key).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function isoWeekNumber(date) {
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayNum = (target.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNum + 3); // четверг этой недели
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const firstDayNum = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
    return 1 + Math.round((target - firstThursday) / (7 * 86400000));
  }

  function padTime(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return '09:00';
    return `${pad2(Math.min(23, Number(match[1])))}:${pad2(Math.min(59, Number(match[2])))}`;
  }

  function dayDate(date) {
    return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  }

  function weekRangeLabel(monday, length) {
    const last = addDays(monday, length - 1);
    const year = last.getFullYear();
    if (monday.getMonth() === last.getMonth()) {
      return `${monday.getDate()}–${last.getDate()} ${MONTHS[last.getMonth()]} ${year}`;
    }
    return `${monday.getDate()} ${MONTHS[monday.getMonth()]} – ${last.getDate()} ${MONTHS[last.getMonth()]} ${year}`;
  }

  /* ── Состояние ──────────────────────────────────────────────────────────── */
  function defaultSettings() {
    return {
      title: 'Шахматка по неделе',
      subtitle: 'График обходов, совещаний и ВКС',
      org: 'Строительный контроль',
      note: 'Неделя: ПН — ПТ',
      showWeekend: false
    };
  }

  function defaultState() {
    return {
      v: 1,
      current: dateKey(startOfWeek(new Date())),
      settings: defaultSettings(),
      weeks: {}
    };
  }

  function sanitizeEvent(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : uid(),
      day: Number.isInteger(raw.day) && raw.day >= 0 && raw.day <= 6 ? raw.day : 0,
      time: padTime(raw.time),
      type: TYPE_BY_ID[raw.type] ? raw.type : 'staff',
      person: typeof raw.person === 'string' ? raw.person.slice(0, 70) : '',
      desc: typeof raw.desc === 'string' ? raw.desc.slice(0, 400) : ''
    };
  }

  function normalizeState(raw) {
    const base = defaultState();
    const settings = Object.assign(defaultSettings(), (raw && raw.settings) || {});
    settings.showWeekend = Boolean(settings.showWeekend);
    // обновляем подзаголовок у тех, кто открывал сервис до правки текста
    if (settings.subtitle === 'График обходов, совещаний (штабов) и ВКС') {
      settings.subtitle = defaultSettings().subtitle;
    }

    let current = base.current;
    if (raw && typeof raw.current === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.current)) {
      const parsed = parseDateKey(raw.current);
      if (!Number.isNaN(parsed.getTime())) current = dateKey(startOfWeek(parsed));
    }

    const state = { v: 1, current, settings, weeks: {} };
    const weeks = (raw && raw.weeks && typeof raw.weeks === 'object') ? raw.weeks : {};
    Object.keys(weeks).forEach((key) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
      const normalizedKey = dateKey(startOfWeek(parseDateKey(key)));
      const list = Array.isArray(weeks[key]) ? weeks[key] : [];
      state.weeks[normalizedKey] = list.map(sanitizeEvent).filter(Boolean);
    });
    return state;
  }

  function demoEvents() {
    const rows = [
      [0, '07:15', 'walk', 'Генералов В.И.', 'Кровля, отопление, окна, фасады, бетон'],
      [0, '08:30', 'staff', 'Осипов Н.А.', 'Комплекс ПМ'],
      [0, '10:00', 'staff', 'Осипов Н.А.', 'Типовые этажи, отделочные и сопутствующие работы'],
      [0, '14:00', 'vks', 'Осипов Н.А.', 'Фасады'],
      [1, '08:30', 'staff', 'Осипов Н.А.', 'Закуп материалов'],
      [1, '10:00', 'staff', 'Осипов Н.А.', '1, 2 этажи, отделочные и сопутствующие работы'],
      [2, '07:15', 'walk', 'Генералов В.И.', 'Благоустройство, 1, 2 этажи отделочные и сопутствующие работы, фасады'],
      [2, '08:30', 'staff', 'Осипов Н.А.', 'Комплекс ПМ'],
      [2, '10:00', 'vks', 'Осипов Н.А.', 'Фасады'],
      [2, '14:00', 'walk', 'Осипов Н.А.', 'Благоустройство и наружные сети'],
      [3, '09:45', 'vks', 'Шапранов М.Ю.', 'Списание давальческих мат-ов'],
      [3, '10:30', 'staff', 'Осипов Н.А.', 'Устройство кровли'],
      [3, '14:15', 'vks', 'Генералов К.В.', 'Фасады'],
      [3, '15:00', 'vks', 'Генералов К.В.', 'Общий отчет (подрядчики+ПМ)'],
      [4, '07:15', 'walk', 'Генералов В.И.', 'Типовые этажи, отделочные и сопутствующие работы'],
      [4, '08:30', 'staff', 'Осипов Н.А.', 'Комплекс ПМ']
    ];
    return rows.map(([day, time, type, person, desc]) => ({ id: uid(), day, time, type, person, desc }));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return normalizeState(parsed);
      }
    } catch (err) {
      console.warn('Не удалось прочитать сохранённый план:', err);
    }
    const seeded = defaultState();
    seeded.weeks[seeded.current] = demoEvents();
    return seeded;
  }

  let state = loadState();
  let lastType = 'staff';
  let undoSnapshot = null;
  let editingId = null;
  let draft = null;

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Не удалось сохранить план в браузере:', err);
    }
  }

  function weekEvents() {
    if (!state.weeks[state.current]) state.weeks[state.current] = [];
    return state.weeks[state.current];
  }

  function findEvent(id) {
    return weekEvents().find((ev) => ev.id === id) || null;
  }

  function visibleDayCount() {
    return state.settings.showWeekend ? 7 : 5;
  }

  /* ── Рендер ─────────────────────────────────────────────────────────────── */
  function render() {
    renderPoster();
    renderWeek();
    renderFooter();
    renderToolbar();
    renderPersonOptions();
    document.documentElement.classList.toggle('weekend-on', Boolean(state.settings.showWeekend));
    document.title = `${state.settings.title} · ${weekRangeLabel(parseDateKey(state.current), visibleDayCount())}`;
  }

  function renderPoster() {
    $('#posterTitle').textContent = state.settings.title;
    $('#posterSubtitle').textContent = state.settings.subtitle;
    $('#posterOrg').textContent = state.settings.org;
    $('#posterNote').textContent = state.settings.note;
  }

  function byTime(a, b) {
    return a.time.localeCompare(b.time);
  }

  function eventCard(ev) {
    const type = TYPE_BY_ID[ev.type] || TYPES[0];

    return `<article class="ev ev--${type.id}" data-id="${esc(ev.id)}" draggable="true" tabindex="0"
      aria-label="${esc(ev.time + ' ' + type.label + ', ' + ev.person)}">
      <div class="ev__time">${icon('clock')}<span>${esc(ev.time)}</span><span class="ev__sep">·</span><span>${esc(type.label)}</span></div>
      <div class="ev__person">${esc(ev.person || 'Без ответственного')}</div>
      ${ev.desc ? `<p class="ev__desc">${esc(ev.desc)}</p>` : ''}
      <div class="ev__actions">
        <button type="button" data-act="edit" title="Изменить" aria-label="Изменить">${icon('pencil')}</button>
        <button type="button" data-act="dup" title="Дублировать" aria-label="Дублировать">${icon('copy')}</button>
        <button type="button" data-act="del" title="Удалить" aria-label="Удалить">${icon('trash')}</button>
      </div>
    </article>`;
  }

  function renderWeek() {
    const weekEl = $('#week');
    const monday = parseDateKey(state.current);
    const days = visibleDayCount();
    const todayKey = dateKey(new Date());
    const events = weekEvents();

    weekEl.style.setProperty('--days', String(days));
    weekEl.innerHTML = DAYS.slice(0, days).map((day, index) => {
      const date = addDays(monday, index);
      const isToday = dateKey(date) === todayKey;
      const list = events.filter((ev) => ev.day === index).sort(byTime);
      const dateLabel = days > 5
        ? `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}`
        : dayDate(date);

      return `<section class="day${isToday ? ' is-today' : ''}" data-day="${index}">
        <header class="day__head">
          <div class="day__name">${day.name}</div>
          <div class="day__meta">
            <span class="day__code">${day.code}</span>
            <span class="day__date">${dateLabel}</span>
            ${isToday ? '<span class="day__today">сегодня</span>' : ''}
            <button type="button" class="day__plus" data-act="add" title="Добавить мероприятие" aria-label="Добавить мероприятие: ${day.name}">${icon('plus')}</button>
          </div>
        </header>
        <div class="day__list">
          ${list.length
            ? list.map(eventCard).join('')
            : `<button type="button" class="day__empty" data-act="add">${icon('plus')}<span>Добавить мероприятие</span></button>`}
        </div>
      </section>`;
    }).join('');
  }

  function renderFooter() {
    const events = weekEvents();

    $('#legend').innerHTML = TYPES.map((type) => {
      const count = events.filter((ev) => ev.type === type.id).length;
      const cls = type.id === 'walk' ? 'var(--blue)' : type.id === 'staff' ? 'var(--teal)' : 'var(--orange)';
      return `<div class="legend__item">
        <span class="legend__dot" style="--c:${cls}"></span>
        <span>${type.label}</span>
        <span class="legend__count">${count}</span>
      </div>`;
    }).join('');

    $('#totalNum').textContent = String(events.length);
    $('#totalCap').textContent = plural(events.length, ['мероприятие', 'мероприятия', 'мероприятий']);
    $('#totalSub').textContent = `за неделю · ПН–${state.settings.showWeekend ? 'ВС' : 'ПТ'}`;
  }

  function renderToolbar() {
    const monday = parseDateKey(state.current);
    const range = weekRangeLabel(monday, visibleDayCount());
    $('#weekLabel').innerHTML = `Неделя <b>${isoWeekNumber(monday)}</b> · ${esc(range)}`;
    const isCurrent = dateKey(startOfWeek(new Date())) === state.current;
    $('#todayBtn').disabled = isCurrent;
  }

  function renderPersonOptions() {
    const names = new Set();
    Object.keys(state.weeks).forEach((key) => {
      (state.weeks[key] || []).forEach((ev) => {
        if (ev.person) names.add(ev.person);
      });
    });
    $('#personsList').innerHTML = Array.from(names)
      .sort((a, b) => a.localeCompare(b, 'ru'))
      .map((name) => `<option value="${esc(name)}"></option>`)
      .join('');
  }

  /* ── Навигация по неделям ───────────────────────────────────────────────── */
  function shiftWeek(amount) {
    const monday = addDays(parseDateKey(state.current), amount * 7);
    state.current = dateKey(startOfWeek(monday));
    persist();
    render();
  }

  function goToday() {
    state.current = dateKey(startOfWeek(new Date()));
    persist();
    render();
  }

  /* ── Действия с мероприятиями ───────────────────────────────────────────── */
  function pushUndo() {
    undoSnapshot = {
      weeks: JSON.parse(JSON.stringify(state.weeks)),
      settings: Object.assign({}, state.settings),
      current: state.current
    };
  }

  function applyUndo() {
    if (!undoSnapshot) return;
    state.weeks = undoSnapshot.weeks;
    state.settings = undoSnapshot.settings;
    state.current = undoSnapshot.current;
    undoSnapshot = null;
    persist();
    render();
    toast('Действие отменено');
  }

  function removeEvent(id) {
    const events = weekEvents();
    const index = events.findIndex((ev) => ev.id === id);
    if (index === -1) return;
    pushUndo();
    events.splice(index, 1);
    persist();
    render();
    toast('Мероприятие удалено', { label: 'Отменить', run: applyUndo });
  }

  function duplicateEvent(id) {
    const source = findEvent(id);
    if (!source) return;
    pushUndo();
    weekEvents().push({
      id: uid(),
      day: source.day,
      time: source.time,
      type: source.type,
      person: source.person,
      desc: source.desc
    });
    persist();
    render();
    toast('Мероприятие продублировано', { label: 'Отменить', run: applyUndo });
  }

  function moveEvent(id, day) {
    const ev = findEvent(id);
    if (!ev || ev.day === day) return;
    pushUndo();
    ev.day = day;
    persist();
    render();
    toast(`Перенесено на ${DAYS[day].name.toLowerCase()}`, { label: 'Отменить', run: applyUndo });
  }

  /* ── Редактор мероприятия ───────────────────────────────────────────────── */
  const editorDialog = $('#editorDialog');
  const editorForm = $('#editorForm');

  function buildEditorStatic() {
    $('#edType').innerHTML = TYPES.map((type) =>
      `<button type="button" class="seg__btn" data-type="${type.id}">${type.label}</button>`
    ).join('');

    $('#edDay').innerHTML = DAYS.map((day, index) =>
      `<button type="button" class="seg__btn" data-day="${index}" title="${day.name}">${day.code}</button>`
    ).join('');
  }

  function defaultDayIndex() {
    const monday = parseDateKey(state.current);
    const diff = Math.round((startOfDay(new Date()) - monday) / 86400000);
    return diff >= 0 && diff < visibleDayCount() ? diff : 0;
  }

  function updateEditorHeading() {
    const monday = parseDateKey(state.current);
    const date = addDays(monday, draft.day);
    $('#edEyebrow').textContent = editingId ? 'Редактирование мероприятия' : 'Новое мероприятие';
    $('#edTitle').textContent = `${DAYS[draft.day].name}, ${dayDate(date)}`;
  }

  function syncEditorControls() {
    $$('#edType .seg__btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.type === draft.type);
    });
    $$('#edDay .seg__btn').forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.dataset.day) === draft.day);
    });
  }

  function openEditor(options) {
    const opts = options || {};
    const source = opts.id ? findEvent(opts.id) : null;
    editingId = source ? source.id : null;
    lastType = source ? source.type : (lastType || 'staff');

    draft = source
      ? {
        day: source.day,
        time: source.time,
        type: source.type,
        person: source.person,
        desc: source.desc || ''
      }
      : {
        day: Number.isInteger(opts.day) ? opts.day : defaultDayIndex(),
        time: opts.time || '09:00',
        type: lastType,
        person: '',
        desc: ''
      };

    $('#edTime').value = draft.time;
    $('#edPerson').value = draft.person;
    $('#edDesc').value = draft.desc;
    $('#edPerson').classList.remove('is-invalid');
    $('#edPersonError').hidden = true;
    $('#edDelete').hidden = !editingId;
    $('#edSave').textContent = editingId ? 'Сохранить' : 'Добавить';

    syncEditorControls();
    updateEditorHeading();

    if (typeof editorDialog.showModal === 'function' && !editorDialog.open) editorDialog.showModal();
    else if (!editorDialog.open) editorDialog.setAttribute('open', '');

    setTimeout(() => $('#edPerson').focus(), 40);
  }

  function closeEditor() {
    if (typeof editorDialog.close === 'function' && editorDialog.open) editorDialog.close();
    else editorDialog.removeAttribute('open');
    editingId = null;
    draft = null;
  }

  function saveEditor() {
    if (!draft) return;
    const person = $('#edPerson').value.trim();
    if (!person) {
      $('#edPerson').classList.add('is-invalid');
      $('#edPersonError').hidden = false;
      $('#edPerson').focus();
      return;
    }

    const payload = {
      day: draft.day,
      time: padTime($('#edTime').value),
      type: draft.type,
      person: person.slice(0, 70),
      desc: $('#edDesc').value.trim().slice(0, 400)
    };

    let note = '';
    if (payload.day > 4 && !state.settings.showWeekend) {
      state.settings.showWeekend = true;
      note = ' · включены выходные';
    }

    if (editingId) {
      const target = findEvent(editingId);
      if (target) Object.assign(target, payload);
      toast('Мероприятие обновлено' + note);
    } else {
      weekEvents().push(Object.assign({ id: uid() }, payload));
      lastType = payload.type;
      toast('Мероприятие добавлено' + note);
    }

    persist();
    render();
    closeEditor();
  }

  /* ── Настройки плаката ──────────────────────────────────────────────────── */
  const settingsDialog = $('#settingsDialog');

  function openSettings() {
    $('#setTitleInput').value = state.settings.title;
    $('#setSubtitle').value = state.settings.subtitle;
    $('#setOrg').value = state.settings.org;
    $('#setNote').value = state.settings.note;
    $('#setWeekend').checked = state.settings.showWeekend;
    if (typeof settingsDialog.showModal === 'function' && !settingsDialog.open) settingsDialog.showModal();
    else if (!settingsDialog.open) settingsDialog.setAttribute('open', '');
  }

  function closeSettings() {
    if (typeof settingsDialog.close === 'function' && settingsDialog.open) settingsDialog.close();
    else settingsDialog.removeAttribute('open');
  }

  function saveSettings() {
    const before = state.settings.showWeekend;
    const nextWeekend = $('#setWeekend').checked;
    const noteInput = $('#setNote').value.trim();
    const noteWasDefault = state.settings.note === `Неделя: ПН — ${before ? 'ВС' : 'ПТ'}`;

    state.settings.title = $('#setTitleInput').value.trim() || 'Шахматка по неделе';
    state.settings.subtitle = $('#setSubtitle').value.trim();
    state.settings.org = $('#setOrg').value.trim();
    state.settings.showWeekend = nextWeekend;
    state.settings.note = (noteWasDefault && nextWeekend !== before)
      ? `Неделя: ПН — ${nextWeekend ? 'ВС' : 'ПТ'}`
      : noteInput;

    persist();
    render();
    closeSettings();

    const hiddenWeekendEvents = weekEvents().filter((ev) => ev.day > 4).length;
    if (before && !state.settings.showWeekend && hiddenWeekendEvents > 0) {
      toast(`В выходных ${hiddenWeekendEvents} ${plural(hiddenWeekendEvents, ['мероприятие', 'мероприятия', 'мероприятий'])} — они скрыты`, {
        label: 'Показать',
        run: () => {
          state.settings.showWeekend = true;
          persist();
          render();
        }
      });
    } else {
      toast('Оформление обновлено');
    }
  }

  /* ── Импорт / экспорт / ссылка ──────────────────────────────────────────── */
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function fromBase64(text) {
    const binary = atob(text);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) { /* переходим к резервному способу */ }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }

  function pageUrl() {
    if (location.protocol === 'file:') return location.href.split('#')[0];
    return location.origin + location.pathname + location.search;
  }

  function shareLink() {
    const payload = {
      app: 'shahmatka-week-planner',
      v: 1,
      current: state.current,
      settings: state.settings,
      weeks: state.weeks
    };
    const hash = '#d=' + toBase64(JSON.stringify(payload));
    const link = pageUrl() + hash;
    copyText(link).then((ok) => {
      if (ok) {
        toast('Ссылка на план скопирована');
      } else {
        skipSharedLink = true;
        location.hash = hash;
        toast('Ссылка в адресной строке — скопируйте её');
      }
    });
  }

  function exportJson() {
    const payload = {
      app: 'shahmatka-week-planner',
      v: 1,
      exportedAt: new Date().toISOString(),
      current: state.current,
      settings: state.settings,
      weeks: state.weeks
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `shahmatka-${state.current}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    toast('Файл с планом сохранён');
  }

  function importJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data || typeof data !== 'object' || !data.weeks) throw new Error('bad file');
        pushUndo();
        const incoming = normalizeState(data);
        state.weeks = incoming.weeks;
        state.settings = Object.assign(defaultSettings(), incoming.settings);
        state.current = incoming.current;
        persist();
        render();
        toast('План загружен из файла', { label: 'Отменить', run: applyUndo });
      } catch (err) {
        toast('Не удалось прочитать файл — нужен JSON из этого сервиса');
      }
    };
    reader.onerror = () => toast('Не удалось прочитать файл');
    reader.readAsText(file);
  }

  function copyPreviousWeek() {
    const previousKey = dateKey(addDays(parseDateKey(state.current), -7));
    const previous = state.weeks[previousKey] || [];
    if (!previous.length) {
      toast('Прошлая неделя пуста — нечего копировать');
      return;
    }
    pushUndo();
    const target = weekEvents();
    previous.forEach((ev) => {
      target.push({
        id: uid(),
        day: ev.day,
        time: ev.time,
        type: ev.type,
        person: ev.person,
        desc: ev.desc
      });
    });
    persist();
    render();
    toast(`Добавлено ${previous.length} ${plural(previous.length, ['мероприятие', 'мероприятия', 'мероприятий'])} из прошлой недели`, {
      label: 'Отменить',
      run: applyUndo
    });
  }

  function clearWeek() {
    if (!weekEvents().length) {
      toast('Неделя уже пуста');
      return;
    }
    pushUndo();
    state.weeks[state.current] = [];
    persist();
    render();
    toast('Неделя очищена', { label: 'Отменить', run: applyUndo });
  }

  function loadDemo() {
    pushUndo();
    state.weeks[state.current] = demoEvents();
    persist();
    render();
    toast('Загружен демонстрационный план', { label: 'Отменить', run: applyUndo });
  }

  /* ── Тосты ──────────────────────────────────────────────────────────────── */
  let toastTimer = null;
  let toastHideTimer = null;
  let toastAction = null;

  function toast(message, action) {
    const el = $('#toast');
    $('#toastText').textContent = message;
    const actionBtn = $('#toastAction');
    if (action && typeof action.run === 'function') {
      actionBtn.hidden = false;
      actionBtn.textContent = action.label || 'Отменить';
      toastAction = action.run;
    } else {
      actionBtn.hidden = true;
      toastAction = null;
    }
    clearTimeout(toastHideTimer);
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 6500 : 2600);
  }

  function hideToast() {
    const el = $('#toast');
    el.classList.remove('is-visible');
    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => { el.hidden = true; }, 220);
  }

  /* ── Меню ───────────────────────────────────────────────────────────────── */
  function setMenu(open) {
    const list = $('#menuList');
    list.hidden = !open;
    $('#menuBtn').setAttribute('aria-expanded', String(open));
  }

  function closeMenu() {
    setMenu(false);
  }

  /* ── События DOM ────────────────────────────────────────────────────────── */
  function wire() {
    $('#prevWeek').addEventListener('click', () => shiftWeek(-1));
    $('#nextWeek').addEventListener('click', () => shiftWeek(1));
    $('#todayBtn').addEventListener('click', goToday);
    $('#addBtn').addEventListener('click', () => openEditor({ day: defaultDayIndex() }));
    $('#printBtn').addEventListener('click', () => { closeMenu(); window.print(); });

    const menuBtn = $('#menuBtn');
    menuBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      setMenu($('#menuList').hidden);
    });

    document.addEventListener('click', (event) => {
      if (!$('#menu').contains(event.target)) closeMenu();
    });

    $('#menuList').addEventListener('click', (event) => {
      const item = event.target.closest('[data-menu]');
      if (!item) return;
      closeMenu();
      const action = item.dataset.menu;
      if (action === 'share') shareLink();
      else if (action === 'export') exportJson();
      else if (action === 'import') $('#importFile').click();
      else if (action === 'copyPrev') copyPreviousWeek();
      else if (action === 'demo') loadDemo();
      else if (action === 'clear') clearWeek();
      else if (action === 'settings') openSettings();
    });

    $('#importFile').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      importJson(file);
    });

    // Неделя: клики, клавиатура, drag & drop
    const weekEl = $('#week');

    weekEl.addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-act]');
      const card = event.target.closest('.ev');
      if (actionEl && actionEl.dataset.act === 'add') {
        openEditor({ day: Number(actionEl.closest('.day').dataset.day) });
        return;
      }
      if (actionEl && card) {
        const id = card.dataset.id;
        if (actionEl.dataset.act === 'edit') openEditor({ id });
        else if (actionEl.dataset.act === 'dup') duplicateEvent(id);
        else if (actionEl.dataset.act === 'del') removeEvent(id);
        return;
      }
      if (card) openEditor({ id: card.dataset.id });
    });

    weekEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest('.ev');
      if (!card || event.target !== card) return;
      event.preventDefault();
      openEditor({ id: card.dataset.id });
    });

    let draggedId = null;

    weekEl.addEventListener('dragstart', (event) => {
      const card = event.target.closest('.ev');
      if (!card) return;
      draggedId = card.dataset.id;
      card.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedId);
    });

    weekEl.addEventListener('dragend', () => {
      draggedId = null;
      $$('.ev.is-dragging').forEach((card) => card.classList.remove('is-dragging'));
      $$('.day.is-drop').forEach((day) => day.classList.remove('is-drop'));
    });

    weekEl.addEventListener('dragover', (event) => {
      const day = event.target.closest('.day');
      if (!day || !draggedId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      $$('.day.is-drop').forEach((item) => { if (item !== day) item.classList.remove('is-drop'); });
      day.classList.add('is-drop');
    });

    weekEl.addEventListener('dragleave', (event) => {
      const day = event.target.closest('.day');
      if (day && !day.contains(event.relatedTarget)) day.classList.remove('is-drop');
    });

    weekEl.addEventListener('drop', (event) => {
      const day = event.target.closest('.day');
      if (!day || !draggedId) return;
      event.preventDefault();
      day.classList.remove('is-drop');
      const id = draggedId;
      draggedId = null;
      moveEvent(id, Number(day.dataset.day));
    });

    // Редактор
    editorForm.addEventListener('submit', (event) => {
      event.preventDefault();
      saveEditor();
    });

    $('#edType').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-type]');
      if (!btn || !draft) return;
      draft.type = btn.dataset.type;
      syncEditorControls();
    });

    $('#edDay').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-day]');
      if (!btn || !draft) return;
      draft.day = Number(btn.dataset.day);
      syncEditorControls();
      updateEditorHeading();
    });

    $('#edDelete').addEventListener('click', () => {
      if (!editingId) return;
      const id = editingId;
      closeEditor();
      removeEvent(id);
    });

    $$('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dialog = btn.closest('dialog');
        if (dialog === editorDialog) closeEditor();
        else if (dialog === settingsDialog) closeSettings();
      });
    });

    [editorDialog, settingsDialog].forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) {
          if (dialog === editorDialog) closeEditor();
          else closeSettings();
        }
      });
      dialog.addEventListener('close', () => {
        if (dialog === editorDialog) { editingId = null; draft = null; }
      });
    });

    // Настройки
    $('#settingsForm').addEventListener('submit', (event) => {
      event.preventDefault();
      saveSettings();
    });

    // Тосты
    $('#toastAction').addEventListener('click', () => {
      hideToast();
      if (typeof toastAction === 'function') toastAction();
      toastAction = null;
    });

    // Горячие клавиши
    document.addEventListener('keydown', (event) => {
      if (editorDialog.open || settingsDialog.open) return;
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'n' || key === 'т') {
        event.preventDefault();
        openEditor({ day: defaultDayIndex() });
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        shiftWeek(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        shiftWeek(1);
      }
    });

    window.addEventListener('beforeprint', () => {
      closeMenu();
      if (editorDialog.open) closeEditor();
      if (settingsDialog.open) closeSettings();
      hideToast();
    });

    // Ссылка, вставленная в адресную строку той же вкладки
    window.addEventListener('hashchange', () => { applySharedLink(); });
  }

  /* ── Загрузка из ссылки ─────────────────────────────────────────────────── */
  let skipSharedLink = false;

  function applySharedLink() {
    if (!location.hash || location.hash.indexOf('#d=') !== 0) return false;
    if (skipSharedLink) {
      skipSharedLink = false;
      return false;
    }
    try {
      const data = JSON.parse(fromBase64(location.hash.slice(3)));
      if (!data || typeof data !== 'object') throw new Error('bad payload');
      state = normalizeState(data);
      persist();
      try {
        history.replaceState(null, '', pageUrl());
      } catch (err) {
        location.hash = '';
      }
      render();
      setTimeout(() => toast('План загружен из ссылки'), 350);
      return true;
    } catch (err) {
      console.warn('Не удалось прочитать план из ссылки:', err);
      return false;
    }
  }

  /* ── Старт ──────────────────────────────────────────────────────────────── */
  function init() {
    applySharedLink();
    buildEditorStatic();
    wire();
    render();
    persist();
  }

  init();
})();
