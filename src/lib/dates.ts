export function getWeekStart(date = new Date()) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
  copy.setDate(diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
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

export const currentWeekStart = toDateInputValue(getWeekStart());
export const currentWeekLabel = getWeekLabel(getWeekStart());
