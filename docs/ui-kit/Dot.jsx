/* global React */
// Dot — the product's signature element.
// Props: arrangement (from palette.arrangementForIndex), state = 'idle'|'active'|'heard', clip (bool for J-label)
function Dot({ arrangement, state = 'idle', clip = false, onClick, onContextMenu, title }) {
  const { backgroundForArrangement, primaryColourForArrangement } = window.TTPalette;
  const bg = backgroundForArrangement(arrangement);
  const ring = primaryColourForArrangement(arrangement);

  const style = { background: bg };
  if (state === 'heard') {
    style.background = 'rgba(255,255,255,0.9)';
    style.boxShadow = `0 0 0 2px ${ring}`;
  }

  const cls = ['tt-dot'];
  if (state === 'active') cls.push('tt-dot--active');
  if (state === 'heard')  cls.push('tt-dot--heard');
  if (clip)               cls.push('tt-dot--clip');

  return (
    <button
      className={cls.join(' ')}
      style={style}
      title={title}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {clip ? 'J' : null}
    </button>
  );
}
window.Dot = Dot;
