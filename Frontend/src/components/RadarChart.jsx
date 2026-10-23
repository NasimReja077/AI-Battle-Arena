// Four-axis radar chart in plain SVG (no chart library). Values are 0-10.
// Wider than tall so the side labels (for example "CONCISENESS") are not cut off
const WIDTH = 340;
const HEIGHT = 240;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const RADIUS = 76;
const RINGS = [2.5, 5, 7.5, 10];

const point = (index, count, value) => {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  const r = (RADIUS * Math.max(0, Math.min(10, value))) / 10;
  return [CX + r * Math.cos(angle), CY + r * Math.sin(angle)];
};

const polygon = (values) => values.map((v, i) => point(i, values.length, v).join(',')).join(' ');

function RadarChart({ axes, series }) {
  const summary = series
    .map((s) => `${s.name}: ${axes.map((axis, i) => `${axis} ${s.values[i]}`).join(', ')}`)
    .join('. ');

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Scores out of 10. ${summary}`} className="w-full max-w-[340px] mx-auto">
      {RINGS.map((ring) => (
        <polygon
          key={ring}
          points={polygon(axes.map(() => ring))}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />
      ))}
      {axes.map((axis, i) => {
        const [x, y] = point(i, axes.length, 10);
        const [lx, ly] = point(i, axes.length, 12.6);
        return (
          <g key={axis}>
            <line x1={CX} y1={CY} x2={x} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            <text
              x={lx}
              y={ly}
              textAnchor={Math.abs(lx - CX) < 4 ? 'middle' : lx > CX ? 'start' : 'end'}
              dominantBaseline="middle"
              className="fill-neutral-400"
              style={{ fontSize: 9, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              {axis}
            </text>
          </g>
        );
      })}
      {series.map((s) => (
        <g key={s.name}>
          <polygon points={polygon(s.values)} fill={s.color} fillOpacity="0.16" stroke={s.color} strokeWidth="1.75" strokeLinejoin="round" />
          {s.values.map((v, i) => {
            const [cx, cy] = point(i, s.values.length, v);
            return <circle key={i} cx={cx} cy={cy} r="2.5" fill={s.color} />;
          })}
        </g>
      ))}
    </svg>
  );
}

export default RadarChart;
