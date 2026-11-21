export function formatTimecode(ms: number, fps = 24): string {
  const safeMs = Math.max(0, Math.round(ms));
  const totalSec = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const frames = Math.floor(((safeMs % 1000) / 1000) * fps);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

export function formatShortDuration(sec: number): string {
  const safe = Math.max(0, Math.round(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatMsRange(startMs: number, endMs: number): string {
  const fmt = (ms: number) => {
    const s = ms / 1000;
    const m = Math.floor(s / 60);
    const rem = (s % 60).toFixed(1).padStart(4, '0');
    return `${String(m).padStart(2, '0')}:${rem}`;
  };
  return `${fmt(startMs)} – ${fmt(endMs)}`;
}

export function formatFileSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
