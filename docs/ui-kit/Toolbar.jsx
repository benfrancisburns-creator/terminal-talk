/* global React, Dot, IconButton, Icon, Scrubber */
function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

// Toolbar — two-row layout matching the product (680×~114).
// Row 1 (.tt-bar-top, 36px tall): Back10, Play/Pause, Fwd10, scrubber, time, Clear, Settings, Close.
// Row 2 (.tt-dots-row, 44px tall): the clip-queue dots, left-aligned, overflow visible.
// The single-row version that used to live here shipped before the product
// adopted a separate dot strip (v0.2). Pass-1 §1b / F2 / F23 / F24 all
// complained that designers opening the kit saw the wrong geometry.
function Toolbar({ state, actions }) {
  const { arrangementForIndex, hashToIndex } = window.TTPalette;
  const current = state.queue.find(c => c.id === state.currentId);
  const isPlaying = state.playing && current;

  const cur = isPlaying ? (state.currentTime || 0) : 0;
  const dur = current ? current.duration : 0;
  const scrubValue = dur > 0 ? Math.round((cur / dur) * 1000) : 0;

  return (
    <div className="tt-bar" role="toolbar" aria-label="Terminal Talk audio toolbar">
      <div className="tt-bar-top">
        <IconButton title="Back 10s" onClick={actions.back10}><Icon.Back10 /></IconButton>
        <IconButton variant="play" title="Play / Pause" onClick={actions.playPause}>
          {isPlaying ? <Icon.Pause /> : <Icon.Play />}
        </IconButton>
        <IconButton title="Forward 10s" onClick={actions.fwd10}><Icon.Fwd10 /></IconButton>

        <Scrubber value={scrubValue}
                  onChange={(v) => actions.scrubPreview(v)}
                  onSeek={(v) => actions.seek(v)} />

        <span className="tt-time">{fmt(cur)} / {fmt(dur)}</span>

        <IconButton title="Clear all played" onClick={actions.clearPlayed}><Icon.Clear /></IconButton>
        <IconButton title="Settings" onClick={actions.toggleSettings}><Icon.Settings /></IconButton>
        <IconButton variant="close" title="Hide (Esc)" onClick={actions.hide}><Icon.Close /></IconButton>
      </div>
      <div className="tt-dots-row" role="list" aria-label="Clip queue">
        <div className="tt-dots">
          {state.queue.map(c => {
            const arr = arrangementForIndex(c.paletteIndex != null ? c.paletteIndex : hashToIndex(c.short));
            const isActive = c.id === state.currentId;
            const s = c.heard ? 'heard' : (isActive ? 'active' : 'idle');
            return (
              <Dot key={c.id} arrangement={arr} state={s} clip={c.clip}
                   title={`${new Date(c.mtime).toLocaleTimeString()} · click to play`}
                   onClick={() => actions.userPlay(c.id)}
                   onContextMenu={(e) => { e.preventDefault(); actions.remove(c.id); }} />
            );
          })}
        </div>
      </div>
    </div>
  );
}
window.Toolbar = Toolbar;
