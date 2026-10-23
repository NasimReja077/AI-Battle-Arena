export const fmtSeconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

export const fmtCost = (usd) => {
  if (!Number.isFinite(usd)) return '—';
  if (usd === 0) return '$0';
  return usd < 0.01 ? `$${usd.toFixed(5)}` : `$${usd.toFixed(3)}`;
};

export const fmtTokens = (n) => Math.round(n).toLocaleString();

export const fmtDate = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
