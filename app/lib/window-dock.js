'use strict';

// EX6b — extracted from app/main.js as part of the v0.4 big-file
// refactor. Pure-geometry helpers for the toolbar's horizontal-snap
// behaviour + off-display rescue.
//
// Everything here takes primitive numbers / objects and returns
// primitive decisions. No Electron imports, no BrowserWindow
// references, no side effects. main.js wires the orchestration
// (setBounds, CFG mutation, IPC send) around these helpers.
//
// Separating the geometry from the orchestration means:
//   - Unit tests can exercise every branch with synthetic
//     workArea + window-position fixtures.
//   - main.js shrinks by ~60 lines of rule definitions.
//   - Future multi-display refinements touch one small file,
//     not the 1800-line orchestrator.

const DEFAULT_SNAP_THRESHOLD_PX = 50;

/**
 * Decide which horizontal edge (if any) the bar should snap to.
 * Returns 'top' | 'bottom' | null.
 *
 * Negative overshoot (position past the edge) always counts;
 * positive distance only counts if under `threshold`.
 *
 * @param {{ y: number, height: number }} workArea
 * @param {number} winY          current window top
 * @param {number} winHeight     current window height
 * @param {number} [threshold]   px from edge that triggers snap
 */
function findDockedEdge(workArea, winY, winHeight, threshold = DEFAULT_SNAP_THRESHOLD_PX) {
  const topDist = winY - workArea.y;
  const bottomDist = (workArea.y + workArea.height) - (winY + winHeight);
  const candidates = [];
  if (topDist < threshold) candidates.push({ name: 'top', dist: topDist });
  if (bottomDist < threshold) candidates.push({ name: 'bottom', dist: bottomDist });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].name;
  // Two candidates = small screen with bar near middle; prefer the
  // edge we actually crossed (negative dist) over the near one.
  const sortKey = (d) => Math.max(0, d);
  return candidates.sort((a, b) => sortKey(a.dist) - sortKey(b.dist))[0].name;
}

/**
 * Rescue off-display windows. If the bar's centre is on ANY
 * connected display's workArea, leave the position alone; otherwise
 * re-centre on the primary display near the top.
 *
 * Deliberately tests the BAR'S centre (top barH px), not the whole
 * window, so an expanded settings panel overflowing the bottom
 * doesn't trip the rescue mid-drag.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} winWidth
 * @param {number} barHeight      top portion that must stay visible
 * @param {Array<{workArea: {x, y, width, height}}>} displays
 * @param {{workArea: {x, y, width, height}}} primary
 */
function clampToVisibleDisplay(x, y, winWidth, barHeight, displays, primary) {
  const cx = x + winWidth / 2;
  const cy = y + barHeight / 2;
  const onAnyDisplay = displays.some((d) => {
    const wa = d.workArea;
    return cx >= wa.x && cx <= wa.x + wa.width &&
           cy >= wa.y && cy <= wa.y + wa.height;
  });
  if (onAnyDisplay) return { x, y };
  const pa = primary.workArea;
  return {
    x: pa.x + Math.floor((pa.width - winWidth) / 2),
    y: pa.y + 12,
  };
}

module.exports = { findDockedEdge, clampToVisibleDisplay };
