import {escapeHTML as h} from './ui.mjs';

const monthLabel = new Intl.DateTimeFormat('ru', {month: 'long', year: 'numeric', timeZone: 'UTC'});
const dayLabel = new Intl.DateTimeFormat('ru', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'});
const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function shiftMonth(month, offset) {
  const date = new Date(month + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function renderArchiveCalendar(days, month, selected, card, today) {
  const start = new Date(month + '-01T00:00:00Z');
  const first = (start.getUTCDay() + 6) % 7;
  const end = new Date(shiftMonth(month, 1) + '-01T00:00:00Z');
  const length = Math.round((end - start) / 86400000);
  const groups = new Map();
  for (const day of days) {
    if (day.dayDate>today || !day.dayDate.startsWith(month + '-')) continue;
    if (!groups.has(day.dayDate)) groups.set(day.dayDate, []);
    groups.get(day.dayDate).push(day);
  }
  const selectedDays = groups.get(selected) ?? [];
  const cells = Array.from({length}, (_, index) => {
    const number = index + 1;
    const date = month + '-' + String(number).padStart(2, '0');
    const items = groups.get(date);
    const current = date===today ? ' aria-current="date"' : '';
    if (!items) return `<span class="calendar-empty"${current}>${number}</span>`;
    const label = dayLabel.format(new Date(date)) + ' · ' + items.map(day => day.title).join(', ');
    return `<button class="calendar-date" type="button" data-calendar-date="${date}" aria-label="${h(label)}" aria-pressed="${date === selected}"${current}>${number}<span class="calendar-dot" aria-hidden="true"></span></button>`;
  }).join('');
  return `<section class="archive-calendar" aria-label="Календарь записей">
    <div class="calendar-controls">
      <button class="btn secondary" type="button" data-month-step="-1" aria-label="Предыдущий месяц">‹</button>
      <h3 aria-live="polite">${h(monthLabel.format(start))}</h3>
      <button class="btn secondary" type="button" data-month-step="1" aria-label="Следующий месяц"${month===today.slice(0,7)?' disabled':''}>›</button>
    </div>
    <div class="calendar-grid">
      ${weekdays.map(day => `<span class="calendar-weekday">${day}</span>`).join('')}
      ${'<span aria-hidden="true"></span>'.repeat(first)}${cells}
    </div>
    ${selectedDays.length ? `<h3>${h(dayLabel.format(new Date(selected)))}</h3><div class="grid">${selectedDays.map(card).join('')}</div>` : '<p class="calendar-hint">' + (groups.size ? 'Выберите отмеченную дату, чтобы открыть её записи.' : 'В этом месяце записей нет.') + '</p>'}
  </section>`;
}
