export function computeBizDate(now: Date, resetTime: string): string {
  const [hh, mm] = resetTime.split(':').map((v) => Number(v));
  const resetMinutes = (hh || 0) * 60 + (mm || 0);
  const curMinutes = now.getHours() * 60 + now.getMinutes();

  const d = new Date(now);
  if (curMinutes < resetMinutes) {
    d.setDate(d.getDate() - 1);
  }

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
