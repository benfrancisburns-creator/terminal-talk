/* global React, SessionsTable, AsciiBanner */
function SettingsPanel({ speed, onSpeedChange, sessions, expanded, onToggleSession, onUpdateSession, onRemoveSession }) {
  return (
    <div className="tt-panel">
      <div className="tt-panel-inner">
        <section className="tt-panel-section">
          <header>Playback</header>
          <div className="tt-row">
            <label>Speed</label>
            <input type="range" min="50" max="250" step="5" value={Math.round(speed * 100)}
                   onChange={(e) => onSpeedChange(Number(e.target.value) / 100)} />
            <span className="tt-readout">{speed.toFixed(2)}x</span>
          </div>
        </section>

        <section className="tt-panel-section">
          <header>Sessions</header>
          <SessionsTable sessions={sessions} expanded={expanded}
                         onToggle={onToggleSession} onUpdate={onUpdateSession}
                         onRemove={onRemoveSession} />
        </section>

        <section className="tt-panel-section tt-panel-section--about">
          <header>About Terminal Talk</header>
          <AsciiBanner />
          <p className="tt-panel-hint">
            Hands-free voice workflow for Claude Code. Say "hey jarvis" with text highlighted anywhere
            and it's read aloud. Claude's replies are auto-spoken. Each terminal gets its own colour,
            shown as an emoji in its statusline and as a dot on the toolbar.
          </p>
          <p className="tt-panel-hint tt-shortcuts-title">Global shortcuts</p>
          <table className="tt-shortcuts">
            <tbody>
              <tr><td><kbd>Ctrl+Shift+A</kbd></td><td>Show / hide the toolbar</td></tr>
              <tr><td><kbd>Ctrl+Shift+S</kbd></td><td>Read the currently highlighted text</td></tr>
              <tr><td><kbd>Ctrl+Shift+J</kbd></td><td>Toggle wake-word listening (chime confirms on/off)</td></tr>
              <tr><td><kbd>Ctrl+Shift+P</kbd></td><td>Pause / resume playback</td></tr>
              <tr><td><kbd>Ctrl+Shift+O</kbd></td><td>Pause only (don't auto-resume on next clip)</td></tr>
              <tr><td>Say "hey jarvis"</td><td>Same as Ctrl+Shift+S on highlighted text</td></tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
window.SettingsPanel = SettingsPanel;
