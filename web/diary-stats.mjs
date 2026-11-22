export function recordedDates(days) {
  return [...new Set(days.map(day => day.dayDate))].sort();
}

export function daysLabel(total) {
  const forms = {one: 'день', few: 'дня', many: 'дней', other: 'дня'};
  return total + ' ' + forms[new Intl.PluralRules('ru').select(total)];
}
