export function getWeekStart(date = new Date()) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
  copy.setDate(diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function parseDateInputValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getWeekLabel(weekStart = getWeekStart()) {
  const end = new Date(weekStart);
  end.setDate(weekStart.getDate() + 4);
  const format = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
  return `${format.format(weekStart)}-${format.format(end)}`;
}

export function getWeekLabelFromDateInput(value: string) {
  return getWeekLabel(parseDateInputValue(value));
}

export function shiftWeek(value: string, offset: number) {
  const date = parseDateInputValue(value);
  date.setDate(date.getDate() + offset * 7);
  return toDateInputValue(getWeekStart(date));
}

export function weekOptions(count = 10) {
  const start = getWeekStart();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() - index * 7);
    return {
      value: toDateInputValue(date),
      label: getWeekLabel(date),
    };
  });
}

export const currentWeekStart = toDateInputValue(getWeekStart());
export const currentWeekLabel = getWeekLabel(getWeekStart());
