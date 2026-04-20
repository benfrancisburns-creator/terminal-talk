/* global React, Icon */
const INCLUDE_LABELS = [
  ['code_blocks',    'Code blocks'],
  ['inline_code',    'Inline code'],
  ['urls',           'URLs'],
  ['headings',       'Headings'],
  ['bullet_markers', 'Bullet markers'],
  ['image_alt',      'Image alt-text']
];

function TriState({ value, onChange }) {
  const states = [
    { val: null, label: 'Default', cls: 'def' },
    { val: true, label: 'On',      cls: 'on' },
    { val: false, label: 'Off',    cls: 'off' }
  ];
  return (
    <div className="tt-tri">
      {states.map(s => (
        <button key={String(s.val)}
                className={`tt-tri-btn tt-tri-btn--${s.cls}${value === s.val ? ' is-active' : ''}`}
                onClick={() => onChange(s.val)}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

function SessionRow({ shortId, entry, expanded, onToggle, onLabel, onIndexChange, onIncludeChange, onToggleFocus, onToggleMute, onRemove }) {
  const { arrangementForIndex, backgroundForArrangement, arrangementLabel } = window.TTPalette;
  const arr = arrangementForIndex(entry.index || 0);
  const bg = backgroundForArrangement(arr);
  const sessionInc = entry.speech_includes || {};
  const focused = !!entry.focus;
  const muted   = !!entry.muted;

  const blockCls = [
    'tt-session-block',
    focused ? 'tt-session-block--focused' : '',
    muted   ? 'tt-session-block--muted'   : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={blockCls}>
      <div className="tt-session-row">
        <button className="tt-chev" onClick={onToggle} title="Per-session settings"
                aria-label={expanded ? 'Collapse session settings' : 'Expand session settings'}
                aria-expanded={expanded}>
          {expanded ? <Icon.ChevronDown /> : <Icon.ChevronRight />}
        </button>
        <div className="tt-swatch" role="img"
             aria-label={`Colour swatch for session ${shortId}`}
             style={{ background: bg }} />
        <div className="tt-short">{shortId}</div>
        <input className="tt-text" type="text" placeholder='Label (e.g. "Tax module")'
               defaultValue={entry.label || ''}
               onBlur={(e) => onLabel(e.target.value.trim())} />
        <select className="tt-select" value={entry.index || 0}
                onChange={(e) => onIndexChange(Number(e.target.value))}
                aria-label={`Colour arrangement for session ${shortId}`}>
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>{arrangementLabel(i)}</option>
          ))}
        </select>
        {/* Focus star — exclusive: toggling this on clears focus on every other row.
            Product wires this to main's setSessionFocus IPC; in the kit it's local state. */}
        <button type="button"
                className={`tt-focus-btn${focused ? ' is-focused' : ''}`}
                onClick={(e) => { e.stopPropagation(); onToggleFocus(); }}
                title={focused
                  ? 'Unfocus this session (its clips lose priority)'
                  : "Focus this session — its clips play before other sessions' clips"}
                aria-label={focused ? 'Unfocus session' : 'Focus session'}
                aria-pressed={focused}>
          {focused ? '\u2605' : '\u2606'}
        </button>
        {/* Mute — always visible so users can one-click mute background terminals. */}
        <button type="button"
                className={`tt-mute-btn${muted ? ' is-muted' : ''}`}
                onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
                title={muted
                  ? 'Unmute this session'
                  : 'Mute this session (no audio, no synthesis)'}
                aria-label={muted ? 'Unmute session' : 'Mute session'}
                aria-pressed={muted}>
          {muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'}
        </button>
        {/* Remove — the only way to drop a session short of reinstalling. */}
        <button type="button"
                className="tt-session-remove"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                title="Remove this session (colour slot freed)"
                aria-label={`Remove session ${shortId} — colour slot freed`}>
          {'\u00D7'}
        </button>
      </div>

      {expanded && (
        <div className="tt-session-expanded">
          <div className="tt-expanded-row">
            <label>Voice for this session</label>
            <select className="tt-select" defaultValue={entry.voice || ''}>
              <option value="">— follow global default —</option>
              <option value="en-GB-RyanNeural">Ryan (UK, male)</option>
              <option value="en-GB-SoniaNeural">Sonia (UK, female)</option>
              <option value="en-US-AriaNeural">Aria (US, female)</option>
              <option value="en-US-AndrewNeural">Andrew (US, male)</option>
              <option value="en-AU-NatashaNeural">Natasha (AU, female)</option>
              <option value="en-IE-EmilyNeural">Emily (IE, female)</option>
            </select>
          </div>
          <div className="tt-expanded-subheader">Speech includes (overrides for this session)</div>
          <div className="tt-tri-grid">
            {INCLUDE_LABELS.map(([key, label]) => {
              const current = key in sessionInc ? sessionInc[key] : null;
              return (
                <div key={key} className="tt-tri-cell">
                  <span className="tt-tri-label">{label}</span>
                  <TriState value={current} onChange={(v) => onIncludeChange(key, v)} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionsTable({ sessions, expanded, onToggle, onUpdate, onRemove }) {
  const entries = Object.entries(sessions).sort((a, b) => (a[1].index || 0) - (b[1].index || 0));
  if (entries.length === 0) {
    return <div className="tt-sessions-empty" role="grid" aria-label="No Claude Code sessions">No active Claude Code sessions. Open a Claude Code terminal to see one here.</div>;
  }
  return (
    <div className="tt-sessions-table" role="grid" aria-label="Claude Code sessions">
      {entries.map(([shortId, entry]) => (
        <SessionRow key={shortId}
          shortId={shortId} entry={entry} expanded={expanded.has(shortId)}
          onToggle={() => onToggle(shortId)}
          onLabel={(label) => onUpdate(shortId, { ...entry, label })}
          onIndexChange={(index) => onUpdate(shortId, { ...entry, index, pinned: true })}
          onIncludeChange={(key, val) => {
            const inc = { ...(entry.speech_includes || {}) };
            if (val === null) delete inc[key]; else inc[key] = val;
            onUpdate(shortId, { ...entry, speech_includes: inc });
          }}
          onToggleFocus={() => {
            // Exclusive focus — matches main.js's product rule. Clear focus on every
            // other row, then flip this one. Pass (shortId, newEntry) so the parent's
            // onUpdate works one session at a time. Batch by writing a single map
            // update in the caller if you want atomic state.
            const turningOn = !entry.focus;
            if (turningOn) {
              for (const [otherShort, otherEntry] of entries) {
                if (otherShort !== shortId && otherEntry.focus) {
                  onUpdate(otherShort, { ...otherEntry, focus: false });
                }
              }
            }
            onUpdate(shortId, { ...entry, focus: turningOn });
          }}
          onToggleMute={() => onUpdate(shortId, { ...entry, muted: !entry.muted })}
          onRemove={() => onRemove(shortId)}
        />
      ))}
    </div>
  );
}
window.SessionsTable = SessionsTable;
