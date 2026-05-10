#!/usr/bin/env node
// Spinning 3D voxel rendering of the Terminal Talk mascot.
// Mirrors the cadence of docs/assets/mascot-animated.svg: 24 palette
// arrangements at 0.7s each. Truecolour ANSI half-blocks. Ctrl+C to exit.
//
// Flags:
//   --probe          Render one frame to stdout and exit (for testing / stills).
//   --frames N       Render N frames then exit (default: loop forever).
//   --fps N          Frame rate (default 30).
//   --walk           Walking mode: legs swing, body bobs, parallax landscape scrolls.
//                    +/- keys speed up / slow down (drives both gait and scroll).
//   --speed N        Walk speed multiplier (default 1.0). Walk mode only.

const args = process.argv.slice(2);
const argFlag = (name) => args.includes(name);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const PROBE = argFlag('--probe');
const PROBE_TIME = Number(argValue('--time', 0));
const MAX_FRAMES = Number(argValue('--frames', PROBE ? 1 : Infinity));
const FPS = Number(argValue('--fps', 30));
const WALK = argFlag('--walk');

const SPEED_MIN = 0.2;
const SPEED_MAX = 4.0;
let speed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, Number(argValue('--speed', 1.0))));

// ---- Palette data (lifted from build-hero-svg.cjs colour cycle) -----------

const COLOURS = [
  { body: [255, 94, 94],   shadow: [156, 32, 32]   }, // 0 red
  { body: [255, 167, 38],  shadow: [168, 94, 0]    }, // 1 orange
  { body: [255, 217, 61],  shadow: [140, 111, 0]   }, // 2 yellow
  { body: [74, 222, 128],  shadow: [22, 101, 52]   }, // 3 green
  { body: [96, 165, 250],  shadow: [30, 64, 175]   }, // 4 blue
  { body: [238, 43, 189],  shadow: [134, 24, 143]  }, // 5 magenta
  { body: [201, 123, 80],  shadow: [93, 47, 20]    }, // 6 brown
  { body: [224, 224, 224], shadow: [107, 114, 128] }, // 7 grey
];

// 24 palette arrangements, indices into COLOURS, one per body quadrant.
//   0..7    solid (single colour)
//   8..15   horizontal split (top vs bottom), offset +3
//   16..23  vertical split (left vs right), offset +4
const PALETTES = [];
for (let i = 0; i < 8; i++) PALETTES.push({ tl: i, tr: i, bl: i, br: i });
for (let i = 0; i < 8; i++) {
  const t = i, b = (i + 3) % 8;
  PALETTES.push({ tl: t, tr: t, bl: b, br: b });
}
for (let i = 0; i < 8; i++) {
  const l = i, r = (i + 4) % 8;
  PALETTES.push({ tl: l, tr: r, bl: l, br: r });
}

// ---- Voxel model -----------------------------------------------------------
// Coords: x [0..23] left→right, y [0..14] top→bottom, z [0..11] back→front.
// Map keyed on "x,y,z" so eyes/mouth/shine cleanly override body voxels.

const grid = new Map();
const set = (x, y, z, role) => grid.set(`${x},${y},${z}`, [x, y, z, role]);

// Head block (18w × 10h × 10d)
for (let x = 3; x <= 20; x++)
  for (let y = 0; y <= 9; y++)
    for (let z = 2; z <= 11; z++)
      set(x, y, z, 'body');

// Ear tabs (3w × 4h × 4d) at mid-height on each side
for (let dx = 0; dx <= 2; dx++)
  for (let y = 4; y <= 7; y++)
    for (let z = 5; z <= 8; z++) {
      set(dx, y, z, 'body');           // left ear
      set(21 + dx, y, z, 'body');      // right ear
    }

// Four legs (3w × 5h × 8d each), aligned under the head (x=3..20). Each leg is
// tagged 'leg0'..'leg3' so the walking animation can swing them independently.
const LEG_STARTS = [3, 8, 13, 18];
LEG_STARTS.forEach((lx, legIdx) => {
  for (let dx = 0; dx <= 2; dx++)
    for (let y = 10; y <= 14; y++)
      for (let z = 3; z <= 10; z++)
        set(lx + dx, y, z, `leg${legIdx}`);
});

// Eyes — 3w × 3h dark blocks on the front face (z=11)
for (let x = 7; x <= 9; x++)
  for (let y = 2; y <= 4; y++)
    set(x, y, 11, 'eye');
for (let x = 14; x <= 16; x++)
  for (let y = 2; y <= 4; y++)
    set(x, y, 11, 'eye');

// Eye shine — single bright pixel in the upper-left of each eye
set(8, 2, 11, 'shine');
set(15, 2, 11, 'shine');

// Mouth — three-row curved smile (corners high, U-curve bottom)
set(7, 6, 11, 'mouth');                                      // left corner
set(16, 6, 11, 'mouth');                                     // right corner
set(8, 7, 11, 'mouth');  set(15, 7, 11, 'mouth');            // upper sides
for (let x = 9; x <= 14; x++) set(x, 8, 11, 'mouth');        // bottom curve

// Compute per-voxel surface normals from neighbour exposure. Normal points
// outward through any face that isn't backed by another voxel; a voxel with
// no exposed faces (fully interior) gets a zero normal but is never visible
// because surface voxels always win the depth buffer at the same screen cell.
const VOXELS = [];
for (const [vx, vy, vz, role] of grid.values()) {
  let nx = 0, ny = 0, nz = 0;
  if (!grid.has(`${vx + 1},${vy},${vz}`)) nx += 1;
  if (!grid.has(`${vx - 1},${vy},${vz}`)) nx -= 1;
  if (!grid.has(`${vx},${vy + 1},${vz}`)) ny += 1;
  if (!grid.has(`${vx},${vy - 1},${vz}`)) ny -= 1;
  if (!grid.has(`${vx},${vy},${vz + 1}`)) nz += 1;
  if (!grid.has(`${vx},${vy},${vz - 1}`)) nz -= 1;
  const len = Math.hypot(nx, ny, nz);
  if (len > 0) { nx /= len; ny /= len; nz /= len; }
  VOXELS.push([vx, vy, vz, role, nx, ny, nz]);
}

// ---- Rendering -------------------------------------------------------------

// Walk mode: bigger canvas + smaller mascot scale, so the landscape has room
// to recede into the distance and the mascot reads as one figure walking
// through it instead of dominating the frame. Spin mode keeps its tighter
// portrait sizing.
const COLS = WALK ? 150 : 60;
const ROWS = WALK ? 50 : 24;
const HALF_ROWS = ROWS * 2;
const SCREEN_CX = COLS / 2;

// Each voxel projects to a FOOTPRINT-col × FOOTPRINT-half-row footprint.
// Walk mode halves the per-voxel scale (1 vs 2) — same model, smaller image.
// Walk-mode footprint is 1×1 so each voxel maps to exactly one cell — keeps
// the silhouette tight against the outline, no body colour leaking past.
const FOOTPRINT_X = WALK ? 1 : 3;
const FOOTPRINT_Y = WALK ? 1 : 2;
const SCALE_X = WALK ? 1 : 2;
const SCALE_Y = WALK ? 1 : 2;

// Walk mode: horizon sits high (~30% down the canvas) so the trail and
// landscape have room to stretch from a vanishing point at the horizon down
// to the bottom edge. The mascot is placed roughly 5/8 down the canvas — on
// the visible trail rather than perched at the horizon — by setting
// SCREEN_CY independently of GROUND_HALF.
const SCREEN_CY = WALK ? Math.round(HALF_ROWS * 0.50) : HALF_ROWS / 2;
const GROUND_HALF = WALK ? Math.round(HALF_ROWS * 0.30) : -1;
const GROUND_ROW = WALK ? Math.floor(GROUND_HALF / 2) : -1;

// Voxel-space centres (model spans x[0..23], y[0..14], z[2..11])
const CX_MODEL = 11.5;
const CY_MODEL = 7;
const CZ_MODEL = 6.5;

const EYE = [22, 22, 26];
const SHINE = [255, 248, 224];
const OUTLINE = [10, 10, 14];

// Key light direction (camera-space). Slightly above and to the right of the
// camera. Used as the 'L' in dot(N, L) shading. Must be unit-length.
const LIGHT = (() => {
  const v = [0.30, -0.45, 0.84];
  const len = Math.hypot(...v);
  return [v[0]/len, v[1]/len, v[2]/len];
})();

// Spin parameters
const SPIN_PERIOD_MS = 4000;       // full Y rotation
const TILT_AMPLITUDE = 0.18;        // X-axis wobble (radians)
const TILT_PERIOD_MS = 6000;
const PALETTE_PERIOD_MS = 700;

// Walk parameters
const WALK_BASE_PERIOD_MS = 800;   // step cycle at speed=1
const WALK_SWING_RAD = 0.75;        // max leg swing angle (~43°)
const WALK_LIFT_VOXELS = 1.0;       // explicit per-pair foot-arc lift (voxel units),
                                    // sits on top of the small rotational lift so the
                                    // silhouette outline visibly tracks each step.
const WALK_BOB_VOXELS = 0.85;       // body bob amplitude (voxel units), ≈0.4 char-rows
const HIP_Y = 10;                   // hip pivot Y (top of leg row)
const HIP_Z = 6.5;                  // hip pivot Z (mid-depth of leg)

// Story cycle — a scripted narrative the mascot plays through. Each phase is
// (name, ms, yaw(t), pitch(t), sway, gait). t∈[0,1] is phase progress; sway
// is lateral wandering amplitude in cells (0=stationary on path); gait is the
// leg-cycle speed multiplier (0=frozen, 1=normal, 2.5=running).
//
// Story beats:
//   walk slow and happy → UFO #1 zooms past behind → glance back, see nothing →
//   carry on → UFO #2 the other way → glance the other side, see nothing →
//   walk on → spot the aliens hiding! → run + spin + zigzag down the trail.
const GLANCE_RAD = Math.PI / 3;
const WALK_GESTURE_CYCLE = [
  // 0–4s: stroll in the magical landscape
  { name: 'walk',          ms: 4000, yaw: () => 0, pitch: () => 0, sway: 4, gait: 0.85 },
  // 4–5s: still walking when the cigar UFO whooshes past behind
  { name: 'walk',          ms: 1000, yaw: () => 0, pitch: () => 0, sway: 4, gait: 0.85 },
  // 5–6s: heard something — turn around to look (yaw 0 → +π)
  { name: 'turn-back',     ms: 1000, yaw: t => t * Math.PI, pitch: () => 0, sway: 0, gait: 0.3 },
  // 6–7s: pause facing backward, sees nothing
  { name: 'pause-back',    ms: 1000, yaw: () => Math.PI, pitch: () => 0, sway: 0, gait: 0 },
  // 7–8s: turn back forward (yaw +π → 2π = 0)
  { name: 'turn-fwd',      ms: 1000, yaw: t => Math.PI + t * Math.PI, pitch: () => 0, sway: 0, gait: 0.3 },
  // 8–12s: back to strolling
  { name: 'walk',          ms: 4000, yaw: () => 0, pitch: () => 0, sway: 4, gait: 0.85 },
  // 12–13s: saucer UFO goes the OTHER way
  { name: 'walk',          ms: 1000, yaw: () => 0, pitch: () => 0, sway: 4, gait: 0.85 },
  // 13–14s: glance LEFT this time (small head-turn)
  { name: 'glance-left',   ms: 1000, yaw: t => -Math.sin(Math.PI * t) * GLANCE_RAD, pitch: () => 0, sway: 0, gait: 0.3 },
  // 14–15s: WALKS past, head turning right to glance at something hidden in
  // the grass. Gait stays high so he's clearly still moving.
  { name: 'glance-aside',   ms: 1000, yaw: t =>  Math.sin(Math.PI * t) * GLANCE_RAD, pitch: () => 0, sway: 3, gait: 0.85 },
  // 15–19s: keeps walking down the curving trail (no abduction here).
  { name: 'walk',          ms: 4000, yaw: () => 0, pitch: () => 0, sway: 4, gait: 0.85 },
  // 19–20s: SPOTS THE ALIENS — sudden stop + double-take left+right
  { name: 'spot-aliens',   ms: 1000, yaw: t => Math.sin(t * Math.PI * 4) * (Math.PI / 4),
                            pitch: () => 0, sway: 0, gait: 0.05 },
  // 20–21s: surprised SPIN reaction
  { name: 'spin-react',    ms: 1000, yaw: t => t * Math.PI * 2, pitch: () => 0, sway: 0, gait: 0.5, scale: 1.0 },
  // 21–24s: RUN — fast gait + wide zigzag + intermittent flips + zoom-in.
  { name: 'run-zigzag-1',  ms: 1000, yaw: () => 0, pitch: t => t * Math.PI * 2, sway: 12, gait: 2.6, scale: 1.25 },
  { name: 'run-zigzag-2',  ms: 1000, yaw: () => 0, pitch: () => 0, sway: 14, gait: 3.0, scale: 1.4 },
  { name: 'run-zigzag-3',  ms: 1000, yaw: () => 0, pitch: t => -t * Math.PI * 2, sway: 12, gait: 2.6, scale: 1.25 },
  // 24–25s: SLOWDOWN — gait + scale decay back to baseline
  { name: 'slowdown',      ms: 1000, yaw: () => 0, pitch: () => 0, sway: t => 6 * (1 - t),
    gait: t => 2.6 - t * 2.0, scale: t => 1.25 - t * 0.25 },
  // 25–26s: CAMERA PANS 90° AROUND the mascot. Mascot stays facing forward
  // (yaw=0) — he doesn't rotate; the CAMERA arcs around him. Background
  // items shift via depth-weighted parallax (far items slide a lot, near
  // items barely move, mascot anchored). cameraPan ∈ [0, 30] drives the
  // shift; banner + Earth slide in from off-screen right during the same
  // window so they read as having always been there, just hidden.
  { name: 'pan-camera',    ms: 1000, yaw: () => 0, pitch: () => 0, sway: 0, gait: 0.2,
    cameraPan: t => t * 30 },
  // 26–27.5s: holds the new camera angle, mascot resumes a slow walk.
  { name: 'walk-after-pan',ms: 1500, yaw: () => 0, pitch: () => 0, sway: 1, gait: 0.55,
    cameraPan: () => 30 },
  // 27.5–30s: UFO grabs mascot in the beam → flies off together → mascot
  // climbs into the saucer as they recede.
  //   t = 0.00–0.20: waiting for the beam (mascot still on ground)
  //   t = 0.20–0.45: small lift — beam pulls him just off the ground
  //   t = 0.45–0.68: HOLD — saucer + mascot hover with him dangling underneath
  //   t = 0.68–1.00: RECEDE — UFO ascends carrying mascot, mascot also climbs
  //                  (so he merges with the saucer) and his scale shrinks
  //                  to sell distance. Earth + banner stay behind.
  { name: 'abducted',      ms: 2500, yaw: () => 0, pitch: () => 0, sway: 0, gait: 0,
    cameraPan: () => 30,
    lift: t => {
      if (t < 0.20) return 0;
      if (t < 0.45) return (t - 0.20) / 0.25 * 0.22;
      if (t < 0.68) return 0.22;
      return 0.22 + (t - 0.68) / 0.32 * 0.78;
    },
    scale: t => t < 0.68 ? 1.0 : 1.0 - (t - 0.68) / 0.32 * 0.78 },
  // 30–35s: after the UFO has abducted the mascot, a meteor hits the planet
  // he was walking on. The blast expands and then holds full-screen so the
  // intro has a clean hard ending with no loop-back flash.
  { name: 'meteor-finale', ms: 5000, yaw: () => 0, pitch: () => 0, sway: 0, gait: 0,
    cameraPan: () => 30, lift: () => 1, scale: () => 0.15, hideMascot: true },
];
const WALK_FULL_CYCLE_MS = WALK_GESTURE_CYCLE.reduce((sum, m) => sum + m.ms, 0);

// Scripted UFO events keyed to absolute story-cycle time. dir = 'r2l' / 'l2r'
// is a fly-by; dir = 'hover' parks the UFO at a fixed X (hoverFrac × COLS).
// Optional `beam` triggers an abduction beam during a sub-window of the event.
const STORY_UFO_EVENTS = [
  // 4–6s: cigar zooms behind mascot, right→left, high in sky
  { startMs: 4000, endMs: 6000, design: 'ufo_cigar', skyFrac: 0.15, dir: 'r2l' },
  // 12–14s: saucer left→right, mid sky
  { startMs: 12000, endMs: 14000, design: 'ufo', skyFrac: 0.40, dir: 'l2r' },
  // 26–30s: the FINAL CINEMATIC saucer. Descends from the top of the sky,
  // hovers right over the mascot, drops the beam, lifts him up, then both
  // recede into the distance against an Earth backdrop. dir = 'cinematic'
  // sequences the four sub-phases inside paintSkyUFOs.
  { startMs: 26000, endMs: 30000, design: 'ufo_big', dir: 'cinematic',
    hoverFrac: 0.50,
    descendT: 0.00, hoverT: 0.30, beamT: 0.45, liftEndT: 0.80, recedeEndT: 1.0 },
];

// Landscape pattern length — repeats every PAT_LEN cols. Static sky elements
// (stars, mountain silhouette) sample from this fixed pattern; perspective
// motion (ground items, UFOs) is generated on the fly from walk-clock time.
const PAT_LEN = 240;

const SKY_STAR_COLOUR = [200, 200, 240];

// Hiking-trail ground field. Items live in true world coordinates (worldX,
// worldZ) — `worldX` is lateral distance from the trail centreline (positive
// = right of trail), `worldZ` is depth into the scene. They project through
// the same perspective table as the trail itself, so trees beside the trail
// shrink + drift toward the vanishing point in lock-step with the trail
// edges. Items spawn close to the camera (large, near the bottom edge) and
// recede toward the horizon — the parallax of items backing into the
// distance is what sells the "walking forward through the woods" cue.
const GROUND_ITEM_COUNT  = 36;
const GROUND_CYCLE_MS    = 7000;
const GROUND_SIDE_SPREAD = 4.5;       // max world-x offset beyond the trail margin

// Trail (the path the mascot walks). World half-width 1.2; camera height 4
// gives a corridor that's a thin ribbon at the horizon and ~26 cols across at
// the bottom of the canvas. Soft brown dirt with a slight edge fade so it
// reads as a worn trail through grass, not a paved road with hard kerbs.
const TRAIL_CAM_HEIGHT      = 4;
const TRAIL_HALF_WIDTH      = 1.2;
const TRAIL_SIDE_MARGIN     = 0.35;   // items must sit at least this far past the edge
// The vanishing point is conceptually `TRAIL_VP_OFFSET` half-rows ABOVE the
// horizon (i.e. behind the mascot's body). At the actual horizon row the
// trail is therefore already a few cells wide, so the mascot reads as
// standing IN the trail with it receding around him, not perched on the
// apex of a cone whose tip is at his feet.
const TRAIL_VP_OFFSET       = 5;
const TRAIL_PIXOFF_NEAR     = WALK ? Math.max(2, HALF_ROWS - GROUND_HALF - 1) : 0;
const TRAIL_PIXOFF_FAR      = 0;
const TRAIL_DIRT_CENTRE     = [120, 95, 65];
const TRAIL_DIRT_EDGE       = [85,  68, 48];

// UFO drift in the sky region. Keeps the original receding-particle scheme.
const UFO_ITEM_COUNT  = 5;
const UFO_CYCLE_MS    = 14000;
const UFO_LATERAL_SPREAD = 1.1;

// ---- Blocky voxel landscape (Minecraft / Roblox style) -------------------
// World coords: +x right of trail, +y up from ground, +z forward into scene.
// Camera at (0, BLOCK_EYE_HEIGHT, 0) looking +z. Each unit = one block side.
//
// "Recede" direction per Ben: world blocks at fixed (wx, wzWorld) get FURTHER
// from the camera over time → wzCam = wzWorld + scrollOffset where scroll
// monotonically increases. Items spawn close (large, near bottom of canvas)
// and drift toward the horizon (small, near top of ground band).

const BLOCK_EYE_HEIGHT  = 1.6;     // camera elevation in block-units
const BLOCK_FOCAL       = 14;      // focal length — tuned so wz=2 ≈ 7 half-rows
const BLOCK_PIXEL_SIZE  = 1.0;     // base pixel-size of a 1-block face
const BLOCK_MAX_DEPTH   = 20;      // furthest visible wzCam (signed off w/ fog last 6)
const BLOCK_NEAR_GROUND = 0.25;    // closest scanline-ground wzCam — fills bottom of canvas
const BLOCK_NEAR_DECO   = 1.8;     // closest decoration-cube wzCam — closer culled (avoids giants)
const BLOCK_FOG_RANGE   = 6;       // blocks within MAX_DEPTH..MAX_DEPTH-6 fade to fog
const BLOCK_FOG_COLOUR  = [55, 70, 95];   // muted blue-grey, blends to mountains
const BLOCK_SCROLL_BLOCKS_PER_STEP = 1.2; // how many wz-blocks per walk-step cycle

// Trail clearance — no decorations spawn within |wx| ≤ this.
const BLOCK_TRAIL_HALF = 1.5;
// Side band ranges (used to pick block surface kind).
const BLOCK_GRASS_BAND   = 5.5;
const BLOCK_FOREST_BAND  = 12;
const BLOCK_MOUNTAIN_BAND = 16;
// Lateral half-extent of the rendered terrain (blocks left+right of trail).
const BLOCK_VIEW_HALF_X  = 16;

// Each block kind has (top, side, ambient) RGB. `top` is what the camera-
// facing top face renders as at full light; `side` is the side face. The
// mascot's existing LIGHT vector lights the top face — sides get a hardcoded
// 0.65 dimmer to mimic Minecraft's directional shading.
// `shape` controls how each block's footprint is rendered. Default 'block' fills
// the whole footprint; the others mask out cells so 1-block items read as
// recognisable shapes instead of solid coloured squares.
const BLOCK_KINDS = {
  grass:     { top: [108, 178, 72], side: [78, 138, 55],  shape: 'block' },
  grasstuft: { top: [120, 195, 80], side: [80, 145, 60],  shape: 'tuft'  },
  trail:    { top: [130, 105, 75],  side: [100, 78, 55],  shape: 'block' },
  wood:     { top: [120, 80, 45],   side: [88, 60, 32],   shape: 'pillar'    },
  leaves:   { top: [82, 168, 70],   side: [55, 130, 50],  shape: 'taper'     },
  pine:     { top: [55, 130, 60],   side: [38, 95, 42],   shape: 'taper'     },
  flower:   { top: [240, 90, 130],  side: [80, 145, 60],  shape: 'flower'    },
  flowery:  { top: [255, 220, 80],  side: [80, 145, 60],  shape: 'flower'    },
  mushroom: { top: [220, 30, 35],   side: [140, 18, 28],  shape: 'mushsprite' },
  // mushstem still spawned via decorateAt for back-compat but the sprite
  // contains its own stem — handled via the same 'mushsprite' dispatch.
  mushstem: { top: [232, 218, 188], side: [168, 150, 118],shape: 'mushsprite' },
  rock:     { top: [128, 122, 116], side: [98, 92, 86],   shape: 'rock'      },
  alien:    { top: [120, 230, 130], side: [60, 165, 80],  shape: 'alien'     },
};
const SIDE_DIMMER = 0.65;          // side-face darkness vs top, à la Minecraft

// ---- End blocky voxel landscape constants --------------------------------

// Per-kind colour + shape hint for the parametric ground blobs. Aliens are
// rendered as the existing detailed sprite when close enough; everything
// else uses a coloured rectangle taper (pine narrows toward top, others fill).
const GROUND_KIND_TABLE = [
  { kind: 'rock',     weight: 0.18, colour: [120, 110, 100], shape: 'fill'  },
  { kind: 'pine',     weight: 0.18, colour: [40,  130, 60 ], shape: 'taper' },
  { kind: 'bush',     weight: 0.16, colour: [90,  165, 95 ], shape: 'fill'  },
  { kind: 'flower',   weight: 0.14, colour: [255, 200, 100], shape: 'fill'  },
  { kind: 'mushroom', weight: 0.12, colour: [200, 80,  60 ], shape: 'fill'  },
  { kind: 'grass',    weight: 0.16, colour: [110, 200, 80 ], shape: 'tuft'  },
  { kind: 'alien',    weight: 0.06, colour: [120, 230, 130], shape: 'alien' },
];
const GROUND_KIND_TOTAL = GROUND_KIND_TABLE.reduce((s, k) => s + k.weight, 0);

function pickGroundKind(r) {
  let acc = 0;
  for (const entry of GROUND_KIND_TABLE) {
    acc += entry.weight / GROUND_KIND_TOTAL;
    if (r < acc) return entry.kind;
  }
  return GROUND_KIND_TABLE[GROUND_KIND_TABLE.length - 1].kind;
}

// ---- Sprite kit ------------------------------------------------------------
// Each sprite is compiled from ASCII art using a single-character palette.
// Result is { w, h, cells: [[x, y, [r,g,b]], ...] } in half-row coordinates.

const SPRITE_PALETTE = {
  // Rocks — 3 shades for 3D rounding
  H: [155, 145, 130], R: [125, 113, 100], M: [95, 85, 75], r: [75, 65, 55],
  // Big rock — separate palette so a cluster doesn't all look identical
  S: [140, 125, 115], N: [105, 92, 82], s: [70, 60, 50],
  // Pine
  T: [55, 145, 70], t: [30, 100, 45],
  K: [90, 60, 35], k: [60, 40, 22],
  // Bush — 3 shades
  B: [70, 175, 80], n: [50, 145, 65], b: [30, 105, 45],
  // Alien
  G: [110, 230, 130], g: [55, 160, 80],
  E: [12, 12, 16],                          // eyes
  m: [25, 25, 30],                          // mouth
  A: [255, 230, 130],                       // antenna tip glow
  // UFO — dome + saucer + cockpit + lights
  D: [220, 225, 240],                       // dome bright
  V: [150, 155, 180],                       // dome shadow
  U: [200, 205, 225], u: [130, 135, 165],   // saucer light/shadow
  W: [80, 200, 255],                        // cockpit window
  P: [255, 240, 180],                       // window inner glow
  L: [255, 220, 90],  c: [120, 220, 255],   // landing lights
  l: [255, 110, 110],
  // Flora extras (new sprites)
  F: [240, 90, 120],                        // flower pink
  Y: [255, 220, 80],                        // flower / mushroom yellow
  I: [115, 95, 65],                         // stem brown
};

function compileSprite(rows) {
  const cells = [];
  let w = 0;
  rows.forEach((row, y) => {
    if (row.length > w) w = row.length;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === ' ' || ch === '.') continue;
      const c = SPRITE_PALETTE[ch];
      if (c) cells.push([x, y, c]);
    }
  });
  return { w, h: rows.length, cells };
}

// Sprite library — only the items that survive the perspective-field rewrite.
// Ground items (rocks, trees, bushes, flowers, mushrooms, grass) now render as
// parametric blobs so they can scale through the depth field; UFOs and aliens
// keep their detailed pixel art because they only render when close enough.
const SPRITES = {
  // Alien — antennae, defined eyes (gap between them), tiny mouth, chin shadow.
  alien: compileSprite([
    '.A....A.',
    '..G..G..',
    '.GGGGGG.',
    'GE.GG.EG',
    '.GGmmGG.',
    '.gggggg.',
  ]),
  // Saucer UFO — dome + cockpit window + saucer rim with shadow underside +
  // blinking landing lights along the bottom.
  ufo: compileSprite([
    '...DDDD...',
    '..VDWPWDV.',
    '.UUUUUUUU.',
    'UuuuuuuuuU',
    '.LcLcLcLcL',
  ]),
  // Cigar UFO — long horizontal craft with row of windows + thruster glow.
  ufo_cigar: compileSprite([
    '..DDDDDDDDDDDD..',
    '.UWPWPWPWPWPWUu.',
    'UuuuuuuuuuuuuuLc',
    '..uuuuuuuuuu....',
  ]),
  // Cube UFO — top-lit cube with sharp face shading + corner antenna lights.
  ufo_cube: compileSprite([
    'A......A',
    '.DDDDDD.',
    'DDDWWDDD',
    'DUWWWWUD',
    'UUuuuuUU',
    '.LcLcLcL',
  ]),
  // BIG cinematic saucer for the finale abduction. Larger sprite that takes
  // over a chunk of the screen — dome with cockpit windows, wide saucer rim
  // with shadow underside, blinking lights along the bottom.
  ufo_big: compileSprite([
    '.......DDDDDDDD.......',
    '.....DDWWWPWWWWDD.....',
    '...DDWPPWWWWPPWWDD....',
    '..DDWPWWWWWWWWPWDD....',
    '.UUUUUUUUUUUUUUUUUUUU.',
    'UuuuuuuuuuuuuuuuuuuuuU',
    '.LcLcLcLcLcLcLcLcLcLc.',
  ]),
  // Submarine UFO — long elongated craft with conning tower, row of windows,
  // and tail propeller. Designed to descend into water like a sub.
  ufo_submarine: compileSprite([
    '...DDDDDDD....',
    '..DUUUuuuuD...',
    '.DUWPWPWPWUD..',
    'DUuuuuuuuuuLD.',
    '.UuuuuuuuuULc.',
    '..LcLcLcLcL...',
  ]),
};

// ---- Scene placement -------------------------------------------------------

function seededRand(seed) {
  const r = Math.abs(Math.sin(seed * 12.9898 + 78.233) * 43758.5453);
  return r - Math.floor(r);
}

// ---- Blocky landscape helpers --------------------------------------------

// Stable 2D hash: returns a value in [0, 1) for any integer (wx, wz) pair.
// Used to seed terrain decorations deterministically by world position so the
// world feels infinite without storing chunk state — same coords produce the
// same trees/rocks every frame, regardless of camera scroll.
function hash2(wx, wz) {
  const r = Math.abs(Math.sin(wx * 127.1 + wz * 311.7) * 43758.5453);
  return r - Math.floor(r);
}

// Surface block kind for one column of the world. Bands radiate from the
// trail centreline. Returns the kind enum and the surface height (in blocks
// above ground reference). Surface height adds gentle rolling hills on the
// forest band and a steep rise on the mountain band so the silhouette
// matches a real hiking landscape.
// Trail centerline curves left and right with depth — sin wave in world wz.
// `trailCenterAt(wz)` returns the lateral world-x offset of the trail's centre
// at that depth. The CAMERA tracks `trailCenterAt(-scrollOffset)` so the
// trail at the mascot's depth always passes through the screen centre, while
// the trail in the distance visibly curves left and right ahead of him.
const TRAIL_WIND_AMPLITUDE = 4.5;
const TRAIL_WIND_FREQUENCY = 0.14;
function trailCenterAt(wz) {
  return Math.sin(wz * TRAIL_WIND_FREQUENCY) * TRAIL_WIND_AMPLITUDE;
}

// Symmetric world: trail down the centre (curving), grass on both sides,
// gentle forest hills on the outer bands.
function terrainAt(wx, wz) {
  const trailCx = trailCenterAt(wz);
  const wxRel = wx - trailCx;
  if (Math.abs(wxRel) <= BLOCK_TRAIL_HALF) {
    const wobble = (hash2(0, wz) - 0.5) * 0.4;
    if (Math.abs(wxRel + wobble) <= BLOCK_TRAIL_HALF) {
      return { kind: 'trail', surfaceY: 0 };
    }
    return { kind: 'grass', surfaceY: 0 };
  }
  if (Math.abs(wxRel) <= BLOCK_GRASS_BAND) {
    return { kind: 'grass', surfaceY: 0 };
  }
  // Outer forest band — gentle rolling hills (sin perturbation)
  const h = Math.sin(wx * 0.35 + wz * 0.27) * 0.6 + Math.sin(wz * 0.13) * 0.4;
  return { kind: 'grass', surfaceY: Math.max(0, Math.round(h)) };
}

// Returns an array of decoration blocks above the surface at (wx, wz).
// Empty when on the trail or in the mountain band. Trees are multi-block
// composites (trunk + leaf canopy); rocks/flowers/mushrooms/grass tufts are
// 1-block markers. Kept stateless via hash2.
function decorateAt(wx, wz, surfaceY, surfaceKind) {
  if (surfaceKind !== 'grass') return null;

  // Decoration density varies by world depth (wz). Mascot sees high-wz cells
  // at the START of the story → DENSE FOREST. Late in the story (during the
  // run + finale) he sees low-wz cells → OPEN FIELD with abundant flowers
  // and mushrooms close to the trail.
  const isForest    = wz >= 5;
  const isOpenField = wz <= -15;

  // Tighter trail clearance in the open field so blooms can crowd the path.
  const trailClearance = isOpenField ? BLOCK_TRAIL_HALF + 0.15 : BLOCK_TRAIL_HALF + 0.5;
  const trailCx = trailCenterAt(wz);
  const wxRel = wx - trailCx;
  const ax = Math.abs(wxRel);
  if (ax <= trailClearance) return null;

  const r = hash2(wx + 7919, wz + 6173);
  const out = [];

  if (ax <= BLOCK_GRASS_BAND) {
    // Inner grass band — beside the trail.
    if (isOpenField) {
      // Open field: ABUNDANT flowers + mushrooms hugging the path
      if      (r < 0.20) out.push({ kind: 'flower',    wy: surfaceY });
      else if (r < 0.40) out.push({ kind: 'flowery',   wy: surfaceY });
      else if (r < 0.60) out.push({ kind: 'mushroom',  wy: surfaceY });
      else if (r < 0.78) out.push({ kind: 'grasstuft', wy: surfaceY });
    } else if (isForest) {
      // Forest: more mushrooms in the shaded grass strip.
      if      (r < 0.10) out.push({ kind: 'flower',    wy: surfaceY });
      else if (r < 0.18) out.push({ kind: 'flowery',   wy: surfaceY });
      else if (r < 0.32) out.push({ kind: 'mushroom',  wy: surfaceY });
      else if (r < 0.42) out.push({ kind: 'grasstuft', wy: surfaceY });
      else if (r < 0.435) {
        out.push({ kind: 'alien', wy: surfaceY });
        out.push({ kind: 'alien', wy: surfaceY + 1 });
      }
    } else {
      // Transition: medium density.
      if      (r < 0.10) out.push({ kind: 'flower',    wy: surfaceY });
      else if (r < 0.18) out.push({ kind: 'flowery',   wy: surfaceY });
      else if (r < 0.26) out.push({ kind: 'mushroom',  wy: surfaceY });
      else if (r < 0.36) out.push({ kind: 'grasstuft', wy: surfaceY });
    }
  } else {
    // Outer forest band — trees, mushrooms, blooms.
    if (isForest) {
      // DENSE forest — trees everywhere with mushrooms beneath.
      if (r < 0.32) {
        for (let trunkY = 0; trunkY < 3; trunkY++) out.push({ kind: 'wood', wy: surfaceY + trunkY });
        for (let leafY = 3; leafY < 5; leafY++)    out.push({ kind: 'pine', wy: surfaceY + leafY });
      } else if (r < 0.50) {
        out.push({ kind: 'mushroom', wy: surfaceY });
      } else if (r < 0.62) {
        out.push({ kind: r < 0.56 ? 'flower' : 'flowery', wy: surfaceY });
      }
    } else if (isOpenField) {
      // Open field: occasional tree, lots of flowers + mushrooms.
      if (r < 0.05) {
        for (let trunkY = 0; trunkY < 3; trunkY++) out.push({ kind: 'wood', wy: surfaceY + trunkY });
        for (let leafY = 3; leafY < 5; leafY++)    out.push({ kind: 'pine', wy: surfaceY + leafY });
      } else if (r < 0.30) {
        out.push({ kind: r < 0.18 ? 'flower' : 'flowery', wy: surfaceY });
      } else if (r < 0.48) {
        out.push({ kind: 'mushroom', wy: surfaceY });
      }
    } else {
      // Transition: thinning forest.
      if (r < 0.15) {
        for (let trunkY = 0; trunkY < 3; trunkY++) out.push({ kind: 'wood', wy: surfaceY + trunkY });
        for (let leafY = 3; leafY < 5; leafY++)    out.push({ kind: 'pine', wy: surfaceY + leafY });
      } else if (r < 0.27) {
        out.push({ kind: 'mushroom', wy: surfaceY });
      } else if (r < 0.37) {
        out.push({ kind: r < 0.32 ? 'flower' : 'flowery', wy: surfaceY });
      }
    }
  }
  return out.length ? out : null;
}

// Project a block's CENTRE in world coords (wx, wy, wz) to screen coords.
// Returns { sx, syTop, sySide, halfBlock, valid } — the screen X centre, the
// top-of-block half-row (top face starts here), the seam between top + side
// face (also where the side face starts), the rendered half-block size in
// half-rows, and whether the block falls within the visible canvas.
// Module-level camera state — set at the top of paintLandscape each frame.
// `_currentCameraWx` follows the curving trail at the mascot's depth.
// `_currentPanShift` is the depth-weighted lateral shift used during the
// "pan around mascot" finale: far items shift a lot, near items barely move,
// mascot is anchored — that's how a camera arc around the subject reads.
let _currentCameraWx = 0;
let _currentPanShift = 0;
const PAN_DEPTH_REF = 8;     // depth at which pan shift = full panShift value

function projectBlock(wx, wy, wz, horizon) {
  if (wz < BLOCK_NEAR_DECO || wz > BLOCK_MAX_DEPTH) return { valid: false };
  const scale = BLOCK_FOCAL / wz;
  const halfBlock = Math.max(1, Math.round(scale * BLOCK_PIXEL_SIZE));
  // Pan shift: increases linearly with depth so distant items move more
  // (camera-arc parallax). Near mascot (wz≈0) → tiny shift.
  const panShift = _currentPanShift * (wz / PAN_DEPTH_REF);
  const sx = Math.round(SCREEN_CX + (wx - _currentCameraWx) * scale * BLOCK_PIXEL_SIZE - panShift);
  // World y=0 is ground; horizon corresponds to camera y = BLOCK_EYE_HEIGHT.
  // Block top face is at world y = wy+1 (top of the unit cube). Top face
  // screen Y = horizon + (BLOCK_EYE_HEIGHT - (wy+1)) * scale * BLOCK_PIXEL_SIZE.
  // +1 half-row aligns the block's bottom row with the scanline ground sample
  // at the same wzCam (the scanline samples at pixOff + 0.5). Without this,
  // decoration blocks float one half-row above the visible ground surface.
  const syTop = Math.round(horizon
              + (BLOCK_EYE_HEIGHT - (wy + 1)) * scale * BLOCK_PIXEL_SIZE) + 1;
  const sySide = syTop + Math.max(1, Math.round(halfBlock * 0.45));
  return { sx, syTop, sySide, halfBlock, valid: true };
}

// Apply fog: blocks near MAX_DEPTH fade toward BLOCK_FOG_COLOUR. Returns the
// blended colour for the given depth.
function fogShade(colour, wz) {
  if (wz < BLOCK_MAX_DEPTH - BLOCK_FOG_RANGE) return colour;
  const t = Math.min(1, (wz - (BLOCK_MAX_DEPTH - BLOCK_FOG_RANGE)) / BLOCK_FOG_RANGE);
  return lerpRgb(colour, BLOCK_FOG_COLOUR, t * 0.85);
}

// Paint a mountain column — UNUSED in the current scene (mountains removed).
// Kept inert here as a stub; if you ever re-add mountains, implement this.
function paintMountainColumn() { return; }


// Per-cell shape mask. Returns whether (xt, yt) — both in [0, 1] over the
// block's footprint — should paint, and optionally an override colour for
// e.g. mushroom-cap speckles. `xt=0` is left, `xt=1` is right; `yt=0` is top,
// `yt=1` is bottom. Tiny blocks (halfBlock ≤ 2) always paint as a solid dot
// so the mask doesn't make distant items invisible.
function shapeMask(shape, xt, yt, half, palette) {
  if (half <= 2) return { visible: true };
  const dx = Math.abs(xt - 0.5) * 2;     // 0=center, 1=edge
  switch (shape) {
    case 'pillar': {
      const visible = dx <= 0.5;
      if (!visible) return { visible: false };
      let colour = null;
      if (half >= 6) {
        // Bark: lit left edge + dark central stripe so the trunk reads as a
        // cylinder with vertical bark grooves rather than a flat plank.
        if (xt < 0.30) colour = palette.top.map(c => Math.min(255, Math.round(c * 1.20)));
        else if (Math.abs(xt - 0.55) < 0.06) colour = palette.side.map(c => Math.round(c * 0.65));
        else if (xt > 0.70) colour = palette.side.map(c => Math.round(c * 0.85));
      }
      return { visible: true, colour };
    }
    case 'stem': {
      // Skinny stem with bulb FLARE at the base (toadstool foot). Cylinder
      // shading so it reads as a 3D pillar, not a flat strip.
      // Width varies with height: thin throughout, slightly wider at base.
      const baseFlare = yt > 0.78 ? (yt - 0.78) / 0.22 : 0;
      const widthAtY = 0.25 + baseFlare * 0.18;
      if (dx > widthAtY) return { visible: false };
      let colour = null;
      if (half >= 4) {
        // Lit left edge / dark right edge for cylinder rounding
        if (xt < 0.40) colour = palette.top.map(c => Math.min(255, Math.round(c * 1.12)));
        else if (xt > 0.60) colour = palette.top.map(c => Math.round(c * 0.76));
        // Subtle dark line where the cap meets the stem (top of the stem block)
        if (half >= 6 && yt < 0.10) {
          colour = palette.side.map(c => Math.round(c * 0.65));
        }
      }
      return { visible: true, colour };
    }
    case 'bell': {
      // Mushroom cap — proper toadstool dome that overhangs the stem.
      // SOLID red fill (no rim/sun-lit/gill shading rings) with bold white
      // polka dots so it's instantly readable as a fly-agaric mushroom.
      const radius = 0.78 + 0.55 * Math.sin(yt * Math.PI * 0.7);
      const visible = dx <= Math.min(1.20, radius);
      if (!visible) return { visible: false };
      let colour = null;
      if (palette.speckle && half >= 4) {
        const r = 0.13 + 0.06 * (half / 12);
        const spot = (cx, cy, rr) => Math.hypot(xt - cx, yt - cy) < rr;
        const inSpot = spot(0.30, 0.40, r * 1.6)
                    || spot(0.72, 0.32, r * 1.5)
                    || spot(0.50, 0.62, r * 1.4)
                    || (half >= 7 && spot(0.42, 0.20, r * 1.1))
                    || (half >= 8 && spot(0.65, 0.58, r * 1.0))
                    || (half >= 9 && spot(0.22, 0.60, r * 0.9));
        if (inSpot) colour = palette.speckle;
      }
      return { visible: true, colour };
    }
    case 'taper': {
      // Pine canopy: tiered, broad branch shelves with a darker underside and
      // sunlit tips. The silhouette deliberately bulges at each shelf so trees
      // read as trees at speed, not generic green triangles.
      const shelf =
        yt < 0.28 ? 0 :
        yt < 0.53 ? 1 :
        yt < 0.78 ? 2 : 3;
      const shelfWidth = [0.46, 0.70, 0.92, 1.08][shelf];
      const taper = 0.18 * yt;
      const allowed = Math.max(0.24, shelfWidth - taper);
      const baseVisible = dx <= allowed;
      if (!baseVisible) return { visible: false };
      // Notched top and branch separators create a stacked evergreen profile.
      if (yt < 0.08 && dx > 0.24) return { visible: false };
      // Silhouette OUTLINE — cells at the very edge of the visible profile
      // get a dark contour colour. Anchors the canopy shape against the
      // background so it reads as a defined tree, not a green smudge.
      const edgeMargin = allowed - dx;
      if (half >= 5 && edgeMargin < 0.13 && yt > 0.10) {
        return { visible: true, colour: palette.side.map(c => Math.round(c * 0.45)) };
      }
      // TIER NOTCHES — three visible branch boundaries
      if (half >= 5) {
        if (Math.abs(yt - 0.28) < 0.045 && dx > 0.42) return { visible: false };
        if (Math.abs(yt - 0.53) < 0.045 && dx > 0.58) return { visible: false };
        if (Math.abs(yt - 0.78) < 0.045 && dx > 0.76) return { visible: false };
      }
      let colour = null;
      if (half >= 4) {
        // BRANCH TIPS — brightest cells at the outer edge of each tier
        const tipL_T1 = xt < 0.31 && yt > 0.16 && yt < 0.28;
        const tipR_T1 = xt > 0.69 && yt > 0.16 && yt < 0.28;
        const tipL_T2 = xt < 0.22 && yt > 0.40 && yt < 0.53;
        const tipR_T2 = xt > 0.78 && yt > 0.40 && yt < 0.53;
        const tipL_T3 = xt < 0.14 && yt > 0.64 && yt < 0.78;
        const tipR_T3 = xt > 0.86 && yt > 0.64 && yt < 0.78;
        if (tipL_T1 || tipR_T1 || tipL_T2 || tipR_T2 || tipL_T3 || tipR_T3) {
          colour = palette.top.map(c => Math.min(255, Math.round(c * 1.50)));
        }
        // SUN-LIT central highlight clumps (upper-left bias)
        else {
          const lit1 = xt > 0.30 - yt * 0.10 && xt < 0.45 - yt * 0.05
                    && yt > 0.13 && yt < 0.27;
          const lit2 = xt > 0.36 - yt * 0.10 && xt < 0.50 - yt * 0.05
                    && yt > 0.38 && yt < 0.50;
          const lit3 = xt > 0.40 - yt * 0.05 && xt < 0.55 - yt * 0.05
                    && yt > 0.62 && yt < 0.72;
          if (lit1 || lit2 || lit3) {
            colour = palette.top.map(c => Math.min(255, Math.round(c * 1.28)));
          }
          // DARK NEEDLE CLUMPS — shadowy depth pockets in the centre
          else {
            const dark1 = xt > 0.55 && xt < 0.70 && yt > 0.20 && yt < 0.32;
            const dark2 = xt > 0.50 && xt < 0.65 && yt > 0.45 && yt < 0.55;
            const dark3 = xt > 0.55 && xt < 0.72 && yt > 0.68 && yt < 0.78;
            if (dark1 || dark2 || dark3) {
              colour = palette.side.map(c => Math.round(c * 0.60));
            }
            // Tier shadow rows (under each shelf)
            else {
              const tierShadow = (yt > 0.29 && yt < 0.36 && dx > 0.22)
                              || (yt > 0.54 && yt < 0.62 && dx > 0.34)
                              || (yt > 0.79 && yt < 0.88 && dx > 0.46)
                              || (yt > 0.88 && dx > 0.20);
              if (tierShadow) {
                colour = palette.side.map(c => Math.round(c * 0.55));
              }
            }
          }
        }
      }
      return { visible: true, colour };
    }
    case 'flower': {
      // Branch by palette: pink ('flower') = tulip cup, yellow ('flowery') = daisy.
      // Both share a thin green stem in the bottom half.
      if (yt >= 0.55) return { visible: dx <= 0.18 };
      const isTulip = palette.top[0] >= 200 && palette.top[1] < 150;     // pinkish
      if (isTulip) {
        // Tulip cup: wider at top, narrows toward base; pinched stem inset.
        const cupTop  = yt < 0.18 && dx <= 0.40;
        const cupMid  = yt >= 0.18 && yt < 0.34 && dx <= 0.32;
        const cupBase = yt >= 0.34 && yt < 0.48 && dx <= 0.18;
        let colour = null;
        // Darker right side for cup volume
        if (half >= 6 && (cupTop || cupMid) && xt > 0.62) {
          colour = palette.side.map(c => Math.round(c * 0.85));
        }
        return { visible: cupTop || cupMid || cupBase, colour };
      }
      // Daisy: yellow centre + white-ish radial petals (cardinals + diagonals
      // at half >= 6).
      const centre = dx <= 0.16 && Math.abs(yt - 0.25) < 0.14;
      const cardH = Math.abs(xt - 0.5) < 0.36 && Math.abs(yt - 0.25) < 0.07;
      const cardV = dx <= 0.08 && Math.abs(yt - 0.25) < 0.22;
      let petalDiag = false;
      if (half >= 6) {
        petalDiag = (Math.abs(xt - 0.30) < 0.07 && Math.abs(yt - 0.13) < 0.07)
                 || (Math.abs(xt - 0.70) < 0.07 && Math.abs(yt - 0.13) < 0.07)
                 || (Math.abs(xt - 0.30) < 0.07 && Math.abs(yt - 0.37) < 0.07)
                 || (Math.abs(xt - 0.70) < 0.07 && Math.abs(yt - 0.37) < 0.07);
      }
      const visible = centre || cardH || cardV || petalDiag;
      if (!visible) return { visible: false };
      // Petals lighten to white-ish; centre stays vivid yellow.
      let colour = null;
      if (!centre && half >= 5) {
        colour = [248, 248, 240];
      }
      return { visible: true, colour };
    }
    case 'tuft': {
      // Grass tuft — three-blade arrangement, sparse and short.
      if (yt < 0.45) return { visible: false };
      const blade = dx <= 0.15
                 || (Math.abs(xt - 0.25) < 0.10 && yt > 0.55)
                 || (Math.abs(xt - 0.75) < 0.10 && yt > 0.55);
      return { visible: blade };
    }
    case 'rock': {
      // Boulder — clear rounded silhouette with a single subtle highlight at
      // the top-left so the cell reads as "lit-from-above stone" instead of
      // a generic two-tone blob. No bottom shadow band — the dark stripe
      // was making it look like two separate things stacked.
      const yCurve = 1 - Math.abs(yt - 0.55) * 1.4;
      const visible = dx <= Math.max(0.3, yCurve);
      if (!visible) return { visible: false };
      let colour = null;
      // Single top-left highlight smear (lit cap)
      if (half >= 5 && yt < 0.35 && xt < 0.50) {
        colour = palette.top.map(c => Math.min(255, Math.round(c * 1.18)));
      }
      // Subtle small dark mark for texture (no full crack)
      if (half >= 7 && Math.abs(xt - 0.62) < 0.07 && Math.abs(yt - 0.55) < 0.10) {
        colour = palette.side.map(c => Math.round(c * 0.70));
      }
      return { visible: true, colour };
    }
    case 'alien': {
      // Antennae with glowing tips + bulbous head with eyes/mouth + body
      // with stubby outstretched hands at higher half.
      if (yt < 0.08 && half >= 9) {
        // Antenna TIP glow (bright yellow-green orbs)
        if (Math.abs(xt - 0.35) < 0.06 || Math.abs(xt - 0.65) < 0.06) {
          return { visible: true, colour: [255, 250, 180] };
        }
        return { visible: false };
      }
      if (yt < 0.18) return { visible: dx <= 0.10 };
      if (yt < 0.30) return { visible: dx <= 0.30 };
      // Head + body region
      if (yt < 0.65) {
        const visible = dx <= 0.85;
        if (!visible) return { visible: false };
        let colour = null;
        if (half >= 5) {
          const eyeR = 0.10 + 0.04 * (half / 12);
          const eyeL = Math.hypot(xt - 0.32, yt - 0.42) < eyeR;
          const eyeRR = Math.hypot(xt - 0.68, yt - 0.42) < eyeR;
          if (eyeL || eyeRR) colour = [22, 22, 32];
          else if (half >= 8 && Math.abs(xt - 0.5) < 0.10 && Math.abs(yt - 0.55) < 0.05) {
            colour = [22, 22, 32];                              // mouth
          }
        }
        return { visible: true, colour };
      }
      // Lower body + hands
      if (yt < 0.82) {
        // Stubby hands extend wider than the body at yt 0.68-0.82.
        if (half >= 7 && yt > 0.68 && (xt > 0.85 || xt < 0.15)) {
          return { visible: true, colour: palette.side.map(c => Math.round(c * 0.85)) };
        }
        return { visible: dx <= 0.65 };
      }
      // Belly band shadow
      if (half >= 9 && dx < 0.35) {
        return { visible: true, colour: palette.side.map(c => Math.round(c * 0.55)) };
      }
      return { visible: dx <= 0.55 };
    }
    case 'block':
    default:
      return { visible: true };
  }
}

// Paint a single cube into fb + depth. Top face uses a brighter colour
// (lit by the global LIGHT vector dotted with the world-up normal), side
// face uses a darker variant. Shape mask carves the footprint into the
// kind's silhouette so trunks/blooms/caps read as distinct items, not
// uniform coloured squares. Depth check ensures closer items overwrite
// farther ones across the unified z-buffer.
// Fly-agaric mushroom — tier-based sprite system (per pixel-art research).
// Replaces the parametric bell mask which produced generic blobs.
const MUSH_PALETTE = {
  R: [226,  34,  42],   // vivid cap red
  D: [128,  18,  28],   // dark rim / lower cap shadow
  H: [255, 112,  92],   // peach highlight on the lit cap side
  W: [252, 248, 232],   // warm white spot
  S: [236, 222, 190],   // cream stem
  s: [176, 154, 116],   // stem shadow
  O: [48,   10,  16],   // dark silhouette outline
  G: [124,  96,  70],   // gill shadow row under the cap
  B: [78,   44,  34],   // small contact shadow at the foot
};
const MUSH_TIERS = [
  // Tier 0 — tiny but still reads as cap + stem.
  ['.W.',
   'RRR',
   'DDD',
   '.S.'],
  // Tier 1 (5×6) — dome, spots, rim, gills, stem.
  ['.OOO.',
   'ORWRO',
   'RHRRR',
   'DRRRD',
   '.GGG.',
   '..S..'],
  // Tier 2 (9×9) — readable fly-agaric profile at mid distance.
  ['...OOO...',
   '..ORWRO..',
   '.OHRRRWO.',
   'ORRWRRRRO',
   'RRRHRWRRR',
   'DRRRRRRRD',
   '.GGGGGGG.',
   '...SSS...',
   '...SsS...'],
  // Tier 3 (11×11) — foreground mushroom with a smoother cap and grounded stem.
  ['....OOO....',
   '...ORWRO...',
   '..OHRRRWO..',
   '.ORRWRRRRO.',
   'ORRRHRWRRRO',
   'RRRWRRRWRRR',
   'DRRRRRRRRRD',
   '.GGGGGGGGG.',
   '....SSS....',
   '...SSsSS...',
   '....BBB....'],
];

// Tier picker with HYSTERESIS — a 1-cell deadband on each transition keeps
// halfBlock-jitter from flicking the tier (and therefore the entire sprite)
// every couple of frames. We round halfBlock down to make the picker more
// stable as scale changes continuously.
function pickMushTier(half) {
  const h = Math.floor(half);                   // floor instead of round
  if (h >= 8) return 3;                          // tier 3 anchored earlier for prominence
  if (h >= 6) return 2;                          // tier 2: 6–7
  if (h >= 4) return 1;                          // tier 1: 4–5
  return 0;                                      // tier 0: ≤4
}

// Render a mushroom from its world-coord position, using the tier sprite that
// best matches the screen-space half-block size. Sprite is anchored at the
// bottom-centre of the block footprint so the stem sits on the ground.
function paintMushroomSprite(fb, depth, wx, wy, wz, horizon) {
  const proj = projectBlock(wx, wy, wz, horizon);
  if (!proj.valid) return;
  const half = proj.halfBlock;
  // 2× cell scaling for very-near mushrooms so they don't read as tiny dots
  // against full-size trees in the foreground.
  const cellScale = half >= 8 ? 2 : 1;
  const tier = pickMushTier(half);
  const sprite = MUSH_TIERS[tier];
  const spriteH = sprite.length;
  const spriteW = sprite[0].length;
  const renderH = spriteH * cellScale;
  const renderW = spriteW * cellScale;
  // Anchor: sprite bottom row sits at the bottom of the block footprint
  // (= ground level, matches scanline grass surface for this wzCam).
  const baseY = proj.syTop + half - 1;
  const sxLeft = proj.sx - Math.floor(renderW / 2);
  const zKey = -wz;

  for (let row = 0; row < spriteH; row++) {
    const ch = sprite[row];
    for (let col = 0; col < spriteW; col++) {
      const c = ch[col];
      if (c === '.') continue;
      const palC = MUSH_PALETTE[c];
      if (!palC) continue;
      const colour = fogShade(palC, wz);
      // Paint cellScale × cellScale block per sprite pixel.
      for (let dy = 0; dy < cellScale; dy++) {
        const sy = baseY - (renderH - 1) + row * cellScale + dy;
        if (sy < 0 || sy >= HALF_ROWS) continue;
        for (let dx = 0; dx < cellScale; dx++) {
          const sx = sxLeft + col * cellScale + dx;
          if (sx < 0 || sx >= COLS) continue;
          if (zKey > depth[sx][sy]) {
            depth[sx][sy] = zKey;
            fb[sx][sy] = colour;
          }
        }
      }
    }
  }
}

const FLOWER_PALETTE = {
  P: [245,  82, 128],   // tulip petal
  p: [168,  44,  92],   // tulip shadow
  H: [255, 136, 170],   // petal highlight
  W: [250, 250, 238],   // daisy petal
  w: [210, 216, 205],   // daisy petal shade
  Y: [255, 215,  62],   // daisy centre
  y: [184, 132,  28],   // centre shadow
  S: [88,  168,  78],   // green stem
  s: [46,  108,  52],   // stem shadow
  L: [104, 194,  88],   // leaf
};
const TULIP_TIERS = [
  ['.P.',
   'PPP',
   '.S.',
   '.S.'],
  ['.P.P.',
   'PPHPP',
   '.PPP.',
   '..S..',
   '.LS..',
   '..s..'],
  ['..P.P..',
   '.PPHPP.',
   'PPPHPpP',
   '.PPPPP.',
   '..pPp..',
   '...S...',
   '..LS...',
   '...s...',
   '...sL..'],
];
const DAISY_TIERS = [
  ['.W.',
   'WYW',
   '.S.',
   '.S.'],
  ['..W..',
   '.WYW.',
   'WWYWW',
   '.WyW.',
   '..S..',
   '.LS..'],
  ['...W...',
   '.W.W.W.',
   '..WYW..',
   'WWYYYWW',
   '..WyW..',
   '.W.W.W.',
   '...S...',
   '..LS...',
   '...sL..'],
];

function pickFlowerTier(half) {
  const h = Math.floor(half);
  if (h >= 7) return 2;
  if (h >= 4) return 1;
  return 0;
}

function paintFlowerSprite(fb, depth, kind, wx, wy, wz, horizon) {
  const proj = projectBlock(wx, wy, wz, horizon);
  if (!proj.valid) return;
  const half = proj.halfBlock;
  const tier = pickFlowerTier(half);
  const sprite = (kind === 'flower' ? TULIP_TIERS : DAISY_TIERS)[tier];
  const cellScale = half >= 9 ? 2 : 1;
  const spriteH = sprite.length;
  const spriteW = sprite[0].length;
  const renderH = spriteH * cellScale;
  const renderW = spriteW * cellScale;
  const baseY = proj.syTop + half - 1;
  const sxLeft = proj.sx - Math.floor(renderW / 2);
  const zKey = -wz;

  for (let row = 0; row < spriteH; row++) {
    const ch = sprite[row];
    for (let col = 0; col < spriteW; col++) {
      const c = ch[col];
      if (c === '.') continue;
      const palC = FLOWER_PALETTE[c];
      if (!palC) continue;
      const colour = fogShade(palC, wz);
      for (let dy = 0; dy < cellScale; dy++) {
        const sy = baseY - (renderH - 1) + row * cellScale + dy;
        if (sy < 0 || sy >= HALF_ROWS) continue;
        for (let dx = 0; dx < cellScale; dx++) {
          const sx = sxLeft + col * cellScale + dx;
          if (sx < 0 || sx >= COLS) continue;
          if (zKey > depth[sx][sy]) {
            depth[sx][sy] = zKey;
            fb[sx][sy] = colour;
          }
        }
      }
    }
  }
}

function paintBlock(fb, depth, kind, wx, wy, wz, horizon) {
  if (kind === 'flower' || kind === 'flowery') {
    paintFlowerSprite(fb, depth, kind, wx, wy, wz, horizon);
    return;
  }
  // Mushroom (cap or stem) — dispatch to the tiered sprite renderer. The
  // sprite contains BOTH cap and stem so we only need to paint once per
  // mushroom; we trigger off the cap kind and skip the stem.
  if (kind === 'mushroom') {
    paintMushroomSprite(fb, depth, wx, wy, wz, horizon);
    return;
  }
  if (kind === 'mushstem') return;       // skip — sprite includes the stem
  const proj = projectBlock(wx, wy, wz, horizon);
  if (!proj.valid) return;
  const palette = BLOCK_KINDS[kind];
  if (!palette) return;

  const topLight = Math.max(0, -LIGHT[1]);
  const sideLight = Math.max(0, -LIGHT[2]);
  const topRgb = lerpRgb(
    palette.side, palette.top, 0.4 + 0.6 * Math.min(1, topLight + 0.45)
  );
  const sideRgb = lerpRgb(
    palette.side.map(c => c * 0.55),
    palette.side, 0.4 + 0.6 * Math.min(1, sideLight + 0.45)
  ).map(c => Math.round(c * SIDE_DIMMER));
  const topColour = fogShade(topRgb, wz);
  const sideColour = fogShade(sideRgb, wz);

  const half = proj.halfBlock;
  // Overdraw 1 cell on the right + bottom to close 1-cell gaps that appear
  // when halfBlock snaps from N to N+1 between adjacent depth tiles.
  const sxLeft  = proj.sx - Math.floor(half / 2);
  const sxRight = sxLeft + half;
  const syEnd = proj.syTop + half;
  const zKey = -wz;
  const shape = palette.shape || 'block';

  for (let sy = proj.syTop; sy <= syEnd; sy++) {
    if (sy < 0 || sy >= HALF_ROWS) continue;
    const yt = half <= 1 ? 0 : Math.min(1, (sy - proj.syTop) / (half - 1));
    for (let sx = sxLeft; sx <= sxRight; sx++) {
      if (sx < 0 || sx >= COLS) continue;
      const xt = half <= 1 ? 0.5 : Math.min(1, (sx - sxLeft) / (half - 1));
      const mask = shapeMask(shape, xt, yt, half, palette);
      if (!mask.visible) continue;
      const colour = mask.colour ? fogShade(mask.colour, wz)
                   : (sy < proj.sySide ? topColour : sideColour);
      if (zKey > depth[sx][sy]) {
        depth[sx][sy] = zKey;
        fb[sx][sy] = colour;
      }
    }
  }
}

// Paint the continuous ground plane via per-screen-row sampling: for each
// half-row below the horizon, compute which world (wx, wz) the camera ray
// hits, look up the terrain kind, and paint that row. Adds a checkerboard
// tint based on the (wxInt, wzInt) parity so adjacent world-blocks read as
// distinct cubes — Minecraft-feel blockiness without the cube-gap artefacts
// that plague discrete sprite-cube ground rendering.
function paintScanlineGround(fb, depth, walkTimeMs, horizon) {
  const scrollOffset = (gaitClockAt(walkTimeMs) / WALK_BASE_PERIOD_MS) * BLOCK_SCROLL_BLOCKS_PER_STEP;
  const cx = SCREEN_CX;
  for (let sy = horizon; sy < HALF_ROWS; sy++) {
    const pixOff = sy - horizon + 0.5;            // +0.5 for centre-of-row sample
    if (pixOff <= 0) continue;
    // Solve for wzCam at this screen row: pixOff = (eyeHeight - 0) * focal / wzCam
    const wzCam = BLOCK_EYE_HEIGHT * BLOCK_FOCAL / pixOff;
    if (wzCam < BLOCK_NEAR_GROUND || wzCam > BLOCK_MAX_DEPTH) continue;
    const scale = BLOCK_FOCAL / wzCam;
    const wzWorld = wzCam - scrollOffset;
    const wzInt = Math.floor(wzWorld);
    const zKey = -wzCam;
    for (let sx = 0; sx < COLS; sx++) {
      // Add camera offsets back: trail-follow (cameraWx) + pan-shift (depth-
      // weighted so far ground bends with the camera arc, near ground stays).
      const panShift = _currentPanShift * (wzCam / PAN_DEPTH_REF);
      const wx = (sx - cx + panShift) / (scale * BLOCK_PIXEL_SIZE) + _currentCameraWx;
      const wxInt = Math.floor(wx);
      // Classify the trail from continuous world coords so the winding path
      // curves smoothly instead of snapping into stair-step block edges.
      const surf = terrainAt(wx, wzWorld);
      // (No mountain skip needed — mountains are removed.)
      const palette = BLOCK_KINDS[surf.kind];
      if (!palette) continue;
      // Top face brightness via LIGHT (mascot's vector). +y is up; LIGHT[1]
      // points downward (mascot model), so -LIGHT[1] is the up-light dot.
      const topLight = Math.max(0, -LIGHT[1]);
      let topRgb = lerpRgb(
        palette.side, palette.top, 0.45 + 0.55 * Math.min(1, topLight + 0.4)
      );
      // Checkerboard tint — adjacent world-blocks render at slightly different
      // brightness so the eye reads them as discrete cubes.
      const checker = ((wxInt + wzInt) & 1) === 0 ? 1.0 : 0.88;
      topRgb = topRgb.map(c => Math.round(c * checker));
      // Fog blend at the back of the visible range.
      const colour = fogShade(topRgb, wzCam);
      if (zKey > depth[sx][sy]) {
        depth[sx][sy] = zKey;
        fb[sx][sy] = colour;
      }
    }
  }
}

// Iterate decoration columns back-to-front, emit decoration cubes into the
// unified z-buffer. Each decoration is a small stack of 1-block cubes above
// the ground (trees, rocks, flowers). Trees etc. are 3D so they cast proper
// occlusion against the mascot via shared depth.
function paintBlockyDecorations(fb, depth, walkTimeMs, horizon) {
  const scrollOffset = (gaitClockAt(walkTimeMs) / WALK_BASE_PERIOD_MS) * BLOCK_SCROLL_BLOCKS_PER_STEP;
  // Iterate over WORLD-SPACE integer cells (wzWorld) rather than camera-space
  // slots — this keeps each cell's content (kind + decoration hash) STABLE as
  // the camera scrolls. wzCam is then derived continuously from wzWorld so
  // items recede smoothly instead of popping when scrollFloor ticks.
  const wzWorldNear = Math.ceil(BLOCK_NEAR_DECO - scrollOffset) - 1;
  const wzWorldFar  = Math.floor(BLOCK_MAX_DEPTH - scrollOffset) + 1;
  for (let wzWorld = wzWorldFar; wzWorld >= wzWorldNear; wzWorld--) {
    const wzCam = wzWorld + scrollOffset;
    if (wzCam < BLOCK_NEAR_DECO * 0.6 || wzCam > BLOCK_MAX_DEPTH) continue;
    for (let wx = -BLOCK_VIEW_HALF_X; wx <= BLOCK_VIEW_HALF_X; wx++) {
      const surf = terrainAt(wx, wzWorld);
      // Decorations stacked above the (already-painted) surface.
      const deco = decorateAt(wx, wzWorld, surf.surfaceY, surf.kind);
      if (deco) {
        for (const block of deco) {
          paintBlock(fb, depth, block.kind, wx, block.wy, wzCam, horizon);
        }
      }
    }
  }
}

// Combined orchestrator: scanline ground first (continuous filled plane),
// then decoration cubes via the unified z-buffer.
function paintBlockyLandscape(fb, depth, walkTimeMs, horizon) {
  paintScanlineGround(fb, depth, walkTimeMs, horizon);
  paintBlockyDecorations(fb, depth, walkTimeMs, horizon);
}

// Perspective recede getter. Stamps `count` items along a single NEAR→FAR
// pass — items spawn close to the camera (large, near the bottom edge) and
// drift toward the horizon (small, at the vanishing point), giving the
// "walking forward through a landscape that scrolls away behind us" cue.
// Each item's depth, lateral angle, and (if a kind table is supplied) kind
// are pure functions of the walk clock, so the field is reproducible and
// stateless across frames.
function getRecedeItems(walkTimeMs, count, cycleMs, lateralSpread, kindTable) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const offsetMs = (i / count) * cycleMs;
    const totalMs = walkTimeMs + offsetMs;
    const cycleIdx = Math.floor(totalMs / cycleMs);
    const localT = ((totalMs % cycleMs) + cycleMs) % cycleMs / cycleMs;
    const z = localT;                                      // 0=at camera, 1=horizon
    const seed = i * 37.1 + cycleIdx * 113.7;
    const theta = (seededRand(seed) - 0.5) * 2 * lateralSpread;
    const item = { z, theta, seed };
    if (kindTable) item.kind = pickGroundKind(seededRand(seed * 1.71));
    items.push(item);
  }
  return items;
}

function paletteForBodyVoxel(vx, vy, palette) {
  const top = vy <= 5;
  const left = vx <= 9;
  if (top && left)  return palette.tl;
  if (top && !left) return palette.tr;
  if (!top && left) return palette.bl;
  return palette.br;
}

// ---- Landscape patterns ----------------------------------------------------
// The sky uses a static silhouette (no parallax) so the eye treats it as
// 'distance'; forward motion is conveyed by perspective items (UFOs, ground
// objects, grass) approaching the camera from the horizon.

function makeMountainHeights(seed, len, baseHeight, amp1, amp2, amp3) {
  const out = [];
  for (let x = 0; x < len; x++) {
    const a = Math.sin(x * 0.13 + seed) * amp1;
    const b = Math.sin(x * 0.31 + seed * 1.7) * amp2;
    const c = Math.sin(x * 0.07 - seed * 0.4) * amp3;
    out.push(Math.max(0, Math.round(baseHeight + a + b + c)));
  }
  return out;
}

function makeStarMap(len, density) {
  const positions = [];
  const skyHalfRows = WALK ? Math.max(0, GROUND_HALF - 14) : 0;
  for (let x = 0; x < len; x++) {
    const r = Math.abs(Math.sin(x * 12.9898 + 78.233) * 43758.5453);
    if ((r - Math.floor(r)) < density && skyHalfRows > 0) {
      const yr = Math.abs(Math.sin(x * 4.7 + 1.3) * 11.1);
      const y = Math.floor((yr - Math.floor(yr)) * skyHalfRows);
      positions.push([x, y]);
    }
  }
  return positions;
}

const MOUNTAIN_HEIGHTS = WALK ? makeMountainHeights(0.0, PAT_LEN, 4.5, 2.5, 1.5, 3.0) : null;
const STAR_MAP         = WALK ? makeStarMap(PAT_LEN, 0.06) : null;

// Paint the hiking trail — a soft brown corridor receding to a vanishing
// point at the horizon. The corridor's screen-space half-width at each row
// equals the world half-width times the row's perspective scale, so the two
// edges automatically converge. A subtle dirt-centre → darker-edge fade
// keeps it from reading as a road with hard kerbs.
function paintTrail(fb, horizon) {
  const groundExtent = HALF_ROWS - horizon;
  const cx = COLS / 2;
  for (let pixOff = 0; pixOff < groundExtent; pixOff++) {
    const sy = horizon + pixOff;
    if (sy < 0 || sy >= HALF_ROWS) continue;
    const scale = (pixOff + TRAIL_VP_OFFSET) / TRAIL_CAM_HEIGHT;
    const halfW = TRAIL_HALF_WIDTH * scale;
    const sxLeft = Math.round(cx - halfW);
    const sxRight = Math.round(cx + halfW);
    for (let sx = sxLeft; sx <= sxRight; sx++) {
      if (sx < 0 || sx >= COLS) continue;
      const t = halfW <= 0 ? 0 : Math.abs(sx - cx) / halfW;
      fb[sx][sy] = lerpRgb(TRAIL_DIRT_CENTRE, TRAIL_DIRT_EDGE, Math.min(1, t));
    }
  }
}

// Generate trail-side items in true world coords. Each item carries its own
// (worldX, pixOff): worldX is lateral distance from the trail centreline
// (positive = right of trail), pixOff is the screen rows below the horizon
// at which the item's base sits. localT advances the pixOff from NEAR (close
// to camera, big item at the bottom) to FAR (small item at the horizon),
// then wraps with a fresh randomization so every cycle reseeds the field.
function getTrailSideItems(walkTimeMs, count, cycleMs, kindTable) {
  const items = [];
  const range = TRAIL_PIXOFF_NEAR - TRAIL_PIXOFF_FAR;
  for (let i = 0; i < count; i++) {
    const offsetMs = (i / count) * cycleMs;
    const totalMs = walkTimeMs + offsetMs;
    const cycleIdx = Math.floor(totalMs / cycleMs);
    const localT = ((totalMs % cycleMs) + cycleMs) % cycleMs / cycleMs;
    const pixOff = TRAIL_PIXOFF_NEAR - localT * range;
    const seed = i * 37.1 + cycleIdx * 113.7;
    const sideSign = seededRand(seed) < 0.5 ? -1 : 1;
    const xOffset = TRAIL_HALF_WIDTH + TRAIL_SIDE_MARGIN
                  + seededRand(seed * 2.3) * GROUND_SIDE_SPREAD;
    const worldX = sideSign * xOffset;
    const item = { worldX, pixOff, seed };
    if (kindTable) item.kind = pickGroundKind(seededRand(seed * 1.71));
    items.push(item);
  }
  return items;
}

// Render a single trail-side item, projected through the same perspective
// scale as the trail. Items in the foreground (large pixOff) render bigger
// and brighter; items near the horizon shrink toward a single speck and
// darken into the haze. Aliens swap to the detailed sprite when close enough.
function paintTrailSideItem(fb, item, horizon) {
  const groundExtent = HALF_ROWS - horizon;
  if (groundExtent <= 0) return;
  if (item.pixOff < TRAIL_PIXOFF_FAR || item.pixOff > TRAIL_PIXOFF_NEAR) return;

  const scale = (item.pixOff + TRAIL_VP_OFFSET) / TRAIL_CAM_HEIGHT;
  const screenY = horizon + Math.round(item.pixOff);
  const screenX = Math.round(COLS / 2 + item.worldX * scale);
  if (screenY < horizon || screenY >= HALF_ROWS) return;
  if (screenX < -8 || screenX >= COLS + 8) return;

  const sizeRaw = 0.6 * scale;
  const w = Math.max(1, Math.round(sizeRaw));
  const h = Math.max(1, Math.round(sizeRaw * 1.1));
  const entry = GROUND_KIND_TABLE.find(k => k.kind === item.kind) || GROUND_KIND_TABLE[0];
  const closeness = item.pixOff / TRAIL_PIXOFF_NEAR;     // 0 at horizon → 1 at camera
  const brightness = 0.35 + 0.65 * closeness;
  const colour = entry.colour.map(c => Math.min(255, Math.round(c * brightness)));

  if (entry.shape === 'alien' && closeness > 0.55) {
    const sprite = SPRITES.alien;
    const sx = screenX - Math.floor(sprite.w / 2);
    const sy = screenY - sprite.h + 1;
    paintSprite(fb, sprite, sx, sy);
    return;
  }
  if (entry.shape === 'tuft' && closeness < 0.4) {
    if (screenX >= 0 && screenX < COLS && screenY >= 0 && screenY < HALF_ROWS) {
      fb[screenX][screenY] = colour;
    }
    return;
  }

  const halfW = Math.floor(w / 2);
  for (let dx = -halfW; dx <= halfW; dx++) {
    for (let dy = -h + 1; dy <= 0; dy++) {
      if (entry.shape === 'taper') {
        const fromTop = -dy;
        const allowed = Math.max(0, halfW - Math.floor(fromTop * 0.6));
        if (Math.abs(dx) > allowed) continue;
      }
      const sx = screenX + dx;
      const sy = screenY + dy;
      if (sx < 0 || sx >= COLS || sy < 0 || sy >= HALF_ROWS) continue;
      fb[sx][sy] = colour;
    }
  }
}

// Sky UFOs — story-scripted flyovers. Each STORY_UFO_EVENTS entry triggers a
// single UFO during its [startMs, endMs] window. Direction 'r2l'/'l2r' is a
// fly-by; 'hover' parks the craft at a fixed screen X. An optional `beam`
// renders an abduction-beam-down during a sub-window of the event with a
// payload (sheep) lifting up the beam.
// Wide vertical beam cone for the cinematic finale. cx = beam centre column,
// beamTop = first row beneath the saucer, beamLocalT = 0..1 over the active
// window so we can fade the bottom out at the end (beam disengaging).
function paintCinematicBeam(fb, cx, beamTop, beamLocalT) {
  const beamBottom = HALF_ROWS - 2;
  if (beamTop >= beamBottom) return;
  // As beamLocalT advances past 0.7, the beam shortens from the bottom to
  // simulate it disengaging once the mascot is fully captured.
  const reach = beamLocalT < 0.7
    ? beamBottom
    : Math.round(beamBottom - (beamLocalT - 0.7) / 0.3 * (beamBottom - beamTop - 2));
  for (let sy = beamTop; sy <= reach; sy++) {
    const yt = (sy - beamTop) / Math.max(1, reach - beamTop);
    const halfWidth = 5 + Math.floor(yt * 14);
    const intensity = 0.85 - yt * 0.30;
    for (let dx = -halfWidth; dx <= halfWidth; dx++) {
      const sx = cx + dx;
      if (sx < 0 || sx >= COLS) continue;
      const edge = Math.abs(dx) / halfWidth;
      const beamColour = lerpRgb([255, 245, 130], [200, 220, 255], edge * 0.5);
      const existing = fb[sx][sy] || [10, 10, 20];
      const blend = intensity * (1 - edge * 0.55);
      fb[sx][sy] = lerpRgb(existing, beamColour, blend);
    }
  }
}

function paintSkyUFOs(fb, depth, walkTimeMs) {
  const horizon = GROUND_HALF;
  const blinkT = Math.floor(walkTimeMs / 250) % 3;
  const cycleMs = ((walkTimeMs % WALK_FULL_CYCLE_MS) + WALK_FULL_CYCLE_MS) % WALK_FULL_CYCLE_MS;
  const skyBand = Math.max(2, horizon - 4);

  for (const event of STORY_UFO_EVENTS) {
    if (cycleMs < event.startMs || cycleMs > event.endMs) continue;
    const sprite = SPRITES[event.design] || SPRITES.ufo;
    const t = (cycleMs - event.startMs) / (event.endMs - event.startMs);
    const span = COLS + sprite.w + 16;
    const skyY = 2 + Math.floor(event.skyFrac * (skyBand - 4));
    let screenX;
    if (event.dir === 'cinematic') {
      // Big saucer finale: descend → hover → beam → ascend with passenger.
      const cx = Math.round(COLS * event.hoverFrac);
      const offTopY = -sprite.h;                       // start fully off-screen top
      const hoverY = Math.max(2, GROUND_HALF - sprite.h - 6);  // a few rows above mascot
      // Compute current screen Y by phase
      let saucerY;
      let activeSprite = sprite;
      if (t < event.hoverT) {
        // DESCENT phase
        const u = t / event.hoverT;
        saucerY = Math.round(offTopY + u * (hoverY - offTopY));
      } else if (t < event.liftEndT) {
        // HOVER + BEAM + LIFT phase — saucer steady at hover position
        const bob = Math.round(Math.sin(walkTimeMs / 320) * 0.5);
        saucerY = hoverY + bob;
      } else {
        // RECEDE phase — saucer + passenger shrink + move up off-screen.
        const u = (t - event.liftEndT) / (event.recedeEndT - event.liftEndT);
        // Swap to the smaller cube sprite at u > 0.5 to sell the distance.
        if (u > 0.5) activeSprite = SPRITES.ufo_cube;
        saucerY = Math.round(hoverY - u * (hoverY + activeSprite.h + 4));
      }
      const sxLeft = cx - Math.floor(activeSprite.w / 2);
      paintSprite(fb, activeSprite, sxLeft, saucerY, { blinkT });
      // Beam fires during the beamT..liftEndT window.
      if (t >= event.beamT && t <= event.liftEndT) {
        const beamLocalT = (t - event.beamT) / (event.liftEndT - event.beamT);
        paintCinematicBeam(fb, cx, saucerY + activeSprite.h, beamLocalT);
      }
      continue;
    }
    if (event.dir === 'hover') {
      screenX = Math.round(COLS * (event.hoverFrac ?? 0.5)) - Math.floor(sprite.w / 2);
      // Subtle bob so it feels alive
      const bob = Math.round(Math.sin(walkTimeMs / 380) * 0.5);
      const ufoVisible = t >= (event.ufoEnterT ?? 0);
      if (ufoVisible) paintSprite(fb, sprite, screenX, skyY + bob, { blinkT });
      // Always run beam logic — it renders the sheep on the ground regardless
      // of UFO visibility, and the beam itself is gated by its own startT.
      if (event.beam) paintUFOBeam(fb, depth, event, t, screenX + Math.floor(sprite.w / 2), skyY + bob + sprite.h);
      continue;
    }
    if (event.dir === 'r2l') {
      screenX = Math.round(COLS + sprite.w + 4 - t * span);
    } else {
      screenX = Math.round(-sprite.w - 4 + t * span);
    }
    if (screenX + sprite.w < 0 || screenX >= COLS) continue;
    paintSprite(fb, sprite, screenX, skyY, { blinkT });
  }
}

// Render the abduction scene: a clearly visible sheep on the grass below the
// UFO, a downward-cone beam during the active window, and the sheep rising up
// the beam toward the UFO. Before the beam fires, the sheep just stands on
// the grass; after the beam ends it has been taken (no longer rendered).
// Captured-alien sprite for the abduction. Bigger + clearer than the in-world
// alien decoration so the user can see what's being lifted.
const ABDUCT_ALIEN_SPRITE = [
  // antenna stalks
  [-2, -6, [120, 230, 130]], [2, -6, [120, 230, 130]],
  [-2, -5, [120, 230, 130]], [2, -5, [120, 230, 130]],
  // antenna tip glow
  [-2, -7, [255, 250, 180]], [2, -7, [255, 250, 180]],
  // head row (top)
  [-2, -4, [120, 230, 130]], [-1, -4, [120, 230, 130]], [0, -4, [120, 230, 130]], [1, -4, [120, 230, 130]], [2, -4, [120, 230, 130]],
  // big black eyes
  [-1, -3, [22, 22, 32]], [1, -3, [22, 22, 32]], [0, -3, [120, 230, 130]],
  // jaw
  [-2, -2, [120, 230, 130]], [-1, -2, [120, 230, 130]], [0, -2, [120, 230, 130]], [1, -2, [120, 230, 130]], [2, -2, [120, 230, 130]],
  // mouth
  [0, -2, [22, 22, 32]],
  // body
  [-2, -1, [85, 195, 100]], [-1, -1, [120, 230, 130]], [0, -1, [120, 230, 130]], [1, -1, [120, 230, 130]], [2, -1, [85, 195, 100]],
  // arms / hands
  [-3, -1, [85, 195, 100]], [3, -1, [85, 195, 100]],
  // legs
  [-1,  0, [60, 165, 80]], [1, 0, [60, 165, 80]],
];

function paintAbductAlien(fb, cx, cy, glowT) {
  for (const [dx, dy, c] of ABDUCT_ALIEN_SPRITE) {
    const sx = cx + dx;
    const sy = cy + dy;
    if (sx < 0 || sx >= COLS || sy < 0 || sy >= HALF_ROWS) continue;
    let colour = c;
    if (glowT > 0) colour = lerpRgb(colour, [255, 240, 200], glowT * 0.4);
    fb[sx][sy] = colour;
  }
}

function paintUFOBeam(fb, depth, event, t, beamCx, beamTop) {
  // Captured alien starts at the grass and rises up the beam during the
  // abduction sub-window.
  const sheepGroundY = HALF_ROWS - 7;
  const beamBottom = HALF_ROWS - 2;
  if (beamTop >= sheepGroundY) return;

  const beamT = (t - event.beam.startT) / (event.beam.endT - event.beam.startT);
  const beamActive = beamT >= 0 && beamT <= 1;
  const sheepGone  = beamT > 1.0;
  const liftClamped = Math.max(0, Math.min(1, beamT));
  const sheepY = beamActive
    ? Math.round(sheepGroundY - liftClamped * (sheepGroundY - beamTop - 4))
    : sheepGroundY;

  // 1. Beam cone — wider + brighter so it's clearly the focal point of the scene.
  if (beamActive) {
    for (let sy = beamTop; sy <= beamBottom; sy++) {
      const yt = (sy - beamTop) / Math.max(1, beamBottom - beamTop);
      const halfWidth = 4 + Math.floor(yt * 12);              // wider cone
      const intensity = 0.85 - yt * 0.30;                     // brighter
      for (let dx = -halfWidth; dx <= halfWidth; dx++) {
        const sx = beamCx + dx;
        if (sx < 0 || sx >= COLS) continue;
        const edge = Math.abs(dx) / halfWidth;
        const beamColour = lerpRgb([255, 245, 130], [200, 220, 255], edge * 0.5);
        const existing = fb[sx][sy] || [10, 10, 20];
        const blend = intensity * (1 - edge * 0.55);
        fb[sx][sy] = lerpRgb(existing, beamColour, blend);
      }
    }
  }

  // 2. Captured alien — clear sprite with optional beam glow.
  if (sheepGone) return;
  const beamGlow = beamActive ? Math.min(1, Math.max(0, beamT * 1.5)) : 0;
  paintAbductAlien(fb, beamCx, sheepY, beamGlow);
}

// Terminal Talk twilight palette — three-stop gradient from deep indigo at
// the top, through magenta-purple, to a warm peach at the horizon. Evokes
// the brand's colourful "many sessions" feel and gives the mascot a vivid
// backdrop without competing for attention.
const SKY_TOP    = [22, 18, 48];
const SKY_MID    = [88, 38, 90];
const SKY_HORIZON = [232, 132, 88];

// 5-row block-letter font for the TERMINAL TALK sky banner. Each glyph is a
// short array of strings; '#' = lit pixel, ' ' = empty. Glyphs are 5 cols
// wide except 'I' (3) so the banner reads as proper block typography.
const BANNER_FONT = {
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  '],
  E: ['#####', '#    ', '#### ', '#    ', '#####'],
  R: ['#### ', '#   #', '#### ', '#  # ', '#   #'],
  M: ['#   #', '## ##', '# # #', '#   #', '#   #'],
  I: ['###', ' # ', ' # ', ' # ', '###'],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #'],
  A: [' ### ', '#   #', '#####', '#   #', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#####'],
  K: ['#  # ', '# #  ', '##   ', '# #  ', '#  # '],
  ' ': ['  ', '  ', '  ', '  ', '  '],
};
const BANNER_TEXT = 'TERMINAL TALK';
const BANNER_GLYPH_GAP = 1;     // 1-cell gap between letters

// Compute total banner width so we can centre it on the canvas.
const BANNER_WIDTH = (() => {
  let w = 0;
  for (let i = 0; i < BANNER_TEXT.length; i++) {
    const g = BANNER_FONT[BANNER_TEXT[i]] || BANNER_FONT[' '];
    w += g[0].length;
    if (i < BANNER_TEXT.length - 1) w += BANNER_GLYPH_GAP;
  }
  return w;
})();

// Paint planet Earth — slides in from off-screen right TOGETHER with the
// TERMINAL TALK banner during the camera pan. Both were already hanging in
// the sky; the camera angle just hid them until now. slideT drives the
// horizontal slide AND the alpha blend.
function paintEarth(fb, slideT) {
  if (slideT <= 0) return;
  const finalCx = Math.round(COLS * 0.82);
  const startCx = COLS + 14;
  const cx = Math.round(startCx + (finalCx - startCx) * slideT);
  const cy = 18;                                              // below the banner
  const fadeT = slideT;
  const radius = 9;
  for (let dy = -radius - 1; dy <= radius + 1; dy++) {
    for (let dx = -radius - 1; dx <= radius + 1; dx++) {
      const sx = cx + dx;
      const sy = cy + dy;
      if (sx < 0 || sx >= COLS || sy < 0 || sy >= HALF_ROWS) continue;
      const dist = Math.hypot(dx, dy);
      let colour = null;
      if (dist <= radius - 0.5) {
        // Surface — blue ocean by default, green continents at deterministic spots.
        const isContinent = (Math.abs(dx + 1) < 4 && Math.abs(dy - 2) < 2)
                         || (Math.abs(dx - 3) < 3 && Math.abs(dy + 2) < 2)
                         || (Math.abs(dx - 5) < 2 && Math.abs(dy + 4) < 1);
        // Day/night terminator: left side lighter, right side darker
        const dayShade = dx < 0 ? 1.0 : (dx < 4 ? 0.85 : 0.55);
        const ocean = [40 * dayShade, 90 * dayShade, 165 * dayShade].map(Math.round);
        const land  = [60 * dayShade, 130 * dayShade, 50 * dayShade].map(Math.round);
        colour = isContinent ? land : ocean;
      } else if (dist <= radius + 0.6) {
        // Atmospheric glow halo — pale blue
        colour = [130, 180, 230];
      }
      if (colour === null) continue;
      const existing = fb[sx][sy] || [10, 10, 20];
      fb[sx][sy] = lerpRgb(existing, colour, fadeT);
    }
  }
}

function paintMeteorFinale(fb, cycleMs) {
  const startMs = 30000;
  const endMs = WALK_FULL_CYCLE_MS;
  if (cycleMs < startMs) return;
  const t = Math.max(0, Math.min(1, (cycleMs - startMs) / (endMs - startMs)));
  const impactCx = SCREEN_CX;
  const impactCy = HALF_ROWS - 5;
  const impactT = 0.34;
  const holdT = 0.76;

  if (t < impactT) {
    const p = t / impactT;
    const mx = Math.round(COLS - 12 + (impactCx - (COLS - 12)) * p);
    const my = Math.round(3 + (impactCy - 3) * p);
    for (let i = 0; i < 24; i++) {
      const k = i / 23;
      const sx = Math.round(mx + k * 34);
      const sy = Math.round(my - k * 16);
      if (sx < 0 || sx >= COLS || sy < 0 || sy >= HALF_ROWS) continue;
      const colour = k < 0.18 ? [255, 245, 190]
        : k < 0.45 ? [255, 142, 48]
        : [166, 56, 36];
      fb[sx][sy] = colour;
      if (i < 7 && sy + 1 < HALF_ROWS) fb[sx][sy + 1] = [255, 96, 36];
    }
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const sx = mx + dx;
        const sy = my + dy;
        if (sx < 0 || sx >= COLS || sy < 0 || sy >= HALF_ROWS) continue;
        const d = Math.hypot(dx / 1.5, dy);
        if (d <= 2.6) fb[sx][sy] = d < 1.1 ? [255, 250, 210] : [255, 128, 38];
      }
    }
    return;
  }

  const e = Math.min(1, (t - impactT) / (holdT - impactT));
  const eased = 1 - Math.pow(1 - e, 3);
  const blastRadius = 5 + eased * Math.hypot(COLS, HALF_ROWS) * 1.2;
  const shockRadius = blastRadius * 0.72;
  for (let sy = 0; sy < HALF_ROWS; sy++) {
    for (let sx = 0; sx < COLS; sx++) {
      const d = Math.hypot((sx - impactCx) / 1.45, sy - impactCy);
      if (d > blastRadius) continue;
      let colour;
      if (t >= holdT) {
        colour = [255, 242, 178];
      } else if (d < shockRadius * 0.24) colour = [255, 252, 220];
      else if (d < shockRadius * 0.55) colour = [255, 190, 64];
      else if (d < shockRadius) colour = [242, 78, 38];
      else colour = [112, 28, 34];
      const noise = seededRand(sx * 19.17 + sy * 7.31 + Math.floor(cycleMs / 90));
      if (t < holdT && noise > 0.78 && d > shockRadius * 0.35) {
        colour = lerpRgb(colour, [255, 226, 120], 0.45);
      }
      fb[sx][sy] = colour;
    }
  }
}

// Paint TERMINAL TALK across the upper sky. `slideT` ∈ [0, 1] slides it in
// from off-screen right to its final centred position — sells the camera
// pan reveal without any actual world rotation. Uses palette-rotating
// colours so the banner shimmers through Terminal Talk's 24 session colours.
function paintBanner(fb, walkTimeMs, slideT) {
  if (slideT <= 0) return;
  const finalX = Math.max(1, Math.floor((COLS - BANNER_WIDTH) / 2));
  const startX = COLS + 4;                                    // off the right edge
  const sx0 = Math.round(startX + (finalX - startX) * slideT);
  const sy0 = 2;                                              // top of canvas
  // Reveal/slide doubles as alpha — banner blends in as it slides in.
  const revealT = slideT;
  // Cycle through the palette so the banner glows in Terminal Talk colours.
  const palIdx = Math.floor(walkTimeMs / 220) % COLOURS.length;
  const lit = COLOURS[palIdx].body;
  const accent = COLOURS[(palIdx + 6) % COLOURS.length].body;

  let cx = sx0;
  for (let li = 0; li < BANNER_TEXT.length; li++) {
    const ch = BANNER_TEXT[li];
    const glyph = BANNER_FONT[ch] || BANNER_FONT[' '];
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < glyph[row].length; col++) {
        if (glyph[row][col] !== '#') continue;
        const sx = cx + col;
        const sy = sy0 + row;
        if (sx < 0 || sx >= COLS || sy < 0 || sy >= HALF_ROWS) continue;
        // Two-tone outline-ish: edge cells use accent, interior uses lit.
        const isEdge = row === 0 || row === glyph.length - 1
                    || col === 0 || col === glyph[row].length - 1;
        const target = isEdge ? accent : lit;
        const existing = fb[sx][sy] || [10, 10, 20];
        fb[sx][sy] = lerpRgb(existing, target, revealT);
      }
    }
    cx += glyph[0].length + BANNER_GLYPH_GAP;
  }
}

function paintLandscape(fb, depth, walkTimeMs) {
  const horizon = GROUND_HALF;

  // Camera state: trail-follow + pan-around-mascot shift.
  const scrollOffset = (gaitClockAt(walkTimeMs) / WALK_BASE_PERIOD_MS) * BLOCK_SCROLL_BLOCKS_PER_STEP;
  const gesture = currentWalkGesture(walkTimeMs);
  _currentCameraWx = trailCenterAt(-scrollOffset);
  _currentPanShift = gesture.cameraPan ?? 0;

  // 1. Sky — three-stop twilight gradient. Stable per frame (no time term).
  for (let sy = 0; sy < horizon; sy++) {
    const t = sy / Math.max(1, horizon - 1);
    let row;
    if (t < 0.5) row = lerpRgb(SKY_TOP, SKY_MID, t * 2);
    else         row = lerpRgb(SKY_MID, SKY_HORIZON, (t - 0.5) * 2);
    for (let col = 0; col < COLS; col++) fb[col][sy] = row;
  }

  // 2. Palette stars — one twinkling dot per session colour, scattered
  //    deterministically across the upper sky band. Slow brightness pulse
  //    based on (i, time) so each star breathes at its own rate.
  const numStars = 24;
  const skyBandTop = 1;
  const skyBandHeight = Math.max(2, horizon - 6);
  for (let i = 0; i < numStars; i++) {
    const seed = i * 41.7 + 3.1;
    const sx = Math.floor(seededRand(seed) * COLS);
    const sy = skyBandTop + Math.floor(seededRand(seed * 1.71) * skyBandHeight);
    if (sx < 0 || sx >= COLS || sy < 0 || sy >= horizon) continue;
    // Pull a colour from the cycling 24-palette (index i mod 24)
    const palette = COLOURS[i % COLOURS.length];
    const baseRgb = palette.body;
    // Slow per-star pulse — quantised to ~5fps so it doesn't strobe.
    const pulsePhaseMs = walkTimeMs + i * 250;
    const pulseStep = Math.floor(pulsePhaseMs / 200);
    const pulse = (Math.sin(pulseStep * 0.4 + i * 0.7) + 1) * 0.5;  // 0..1
    const brightness = 0.7 + 0.3 * pulse;
    const colour = baseRgb.map(c => Math.min(255, Math.round(c * brightness)));
    fb[sx][sy] = colour;
  }

  // 3. TERMINAL TALK banner + planet Earth — slide into view together
  //    during the camera pan (25–26.5s). Conceptually they were always in
  //    the sky behind us, the camera angle just hid them until the pan
  //    around the mascot revealed both at once.
  const cycleMs = ((walkTimeMs % WALK_FULL_CYCLE_MS) + WALK_FULL_CYCLE_MS) % WALK_FULL_CYCLE_MS;
  const slideStart = 25000, slideFull = 26500;
  if (cycleMs >= slideStart) {
    const slideT = Math.min(1, (cycleMs - slideStart) / (slideFull - slideStart));
    paintBanner(fb, walkTimeMs, slideT);
    paintEarth(fb, slideT);
  }

  // 4. Blocky voxel landscape — trail + grass + decoration cubes via the
  //    unified z-buffer.
  paintBlockyLandscape(fb, depth, walkTimeMs, horizon);

  // 5. UFOs / beam — painted LAST so landscape cells can never overwrite.
  paintSkyUFOs(fb, depth, walkTimeMs);

  // 6. Finale — meteor impact and screen-filling blast.
  paintMeteorFinale(fb, cycleMs);
}

// Paint a sprite into fb. Cells outside the canvas are clipped. UFO lights
// (L/c/l) get cycled by blinkT so they pulse.
function paintSprite(fb, sprite, baseX, baseY, opts) {
  const blinkT = opts && opts.blinkT;
  for (const [dx, dy, c] of sprite.cells) {
    const sx = baseX + dx;
    const sy = baseY + dy;
    if (sx < 0 || sx >= COLS || sy < 0 || sy >= HALF_ROWS) continue;
    let colour = c;
    if (blinkT !== undefined) {
      // Cycle UFO lights: cells in the bottom row of UFO sprite are lights.
      // Identify by colour ≈ light palette; rotate hue.
      if (c === SPRITE_PALETTE.L && blinkT === 1) colour = SPRITE_PALETTE.c;
      else if (c === SPRITE_PALETTE.c && blinkT === 2) colour = SPRITE_PALETTE.l;
      else if (c === SPRITE_PALETTE.L && blinkT === 2) colour = SPRITE_PALETTE.l;
    }
    fb[sx][sy] = colour;
  }
}

function lerpRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function eqRgb(a, b) {
  return a !== null && b !== null
    && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function fg([r, g, b]) { return `\x1b[38;2;${r};${g};${b}m`; }
function bg([r, g, b]) { return `\x1b[48;2;${r};${g};${b}m`; }

// Walk-mode accumulators (mutable). walkTimeMs advances at real-time × current
// speed so changing `speed` mid-run smoothly retimes the gait and the scroll.
let walkTimeMs = 0;
let lastFrameMs = null;

// Active story phase + interpolated values (yaw, pitch, sway, gait, scale).
// Phases are evaluated in order; t∈[0,1] is the fraction through the active
// phase. Scalar fields can be a number or a function of t.
function currentWalkGesture(walkTimeMs) {
  const cycleMs = ((walkTimeMs % WALK_FULL_CYCLE_MS) + WALK_FULL_CYCLE_MS) % WALK_FULL_CYCLE_MS;
  let elapsed = 0;
  for (const slot of WALK_GESTURE_CYCLE) {
    const dur = slot.ms;
    if (cycleMs < elapsed + dur) {
      const t = (cycleMs - elapsed) / dur;
      const yaw   = typeof slot.yaw   === 'function' ? slot.yaw(t)   : (slot.yaw   ?? 0);
      const pitch = typeof slot.pitch === 'function' ? slot.pitch(t) : (slot.pitch ?? 0);
      const sway  = typeof slot.sway  === 'function' ? slot.sway(t)  : (slot.sway  ?? 0);
      const gait  = typeof slot.gait  === 'function' ? slot.gait(t)  : (slot.gait  ?? 1);
      const scale = typeof slot.scale === 'function' ? slot.scale(t) : (slot.scale ?? 1);
      const lift  = typeof slot.lift  === 'function' ? slot.lift(t)  : (slot.lift  ?? 0);
      const hideMascot = typeof slot.hideMascot === 'function'
        ? slot.hideMascot(t) : Boolean(slot.hideMascot);
      const cameraPan = typeof slot.cameraPan === 'function'
        ? slot.cameraPan(t) : (slot.cameraPan ?? 0);
      return { yaw, pitch, sway, gait, scale, lift, cameraPan, hideMascot, name: slot.name, t };
    }
    elapsed += dur;
  }
  return { yaw: 0, pitch: 0, sway: 0, gait: 1, scale: 1, lift: 0, cameraPan: 0, hideMascot: false, name: 'idle', t: 0 };
}

// Integrated gait clock — sums (gait × duration) across all elapsed phases so
// the leg cycle slows during pauses and speeds up during running. Same clock
// drives the world scroll so the landscape rushes by faster when he runs.
function gaitClockAt(storyTimeMs) {
  const cycleMs = ((storyTimeMs % WALK_FULL_CYCLE_MS) + WALK_FULL_CYCLE_MS) % WALK_FULL_CYCLE_MS;
  let elapsed = 0;
  let gaitElapsed = 0;
  for (const slot of WALK_GESTURE_CYCLE) {
    const dur = slot.ms;
    const gait = typeof slot.gait === 'function' ? slot.gait(0.5) : (slot.gait ?? 1);
    if (cycleMs < elapsed + dur) {
      const t = (cycleMs - elapsed) / dur;
      gaitElapsed += dur * t * gait;
      return gaitElapsed;
    }
    gaitElapsed += dur * gait;
    elapsed += dur;
  }
  return gaitElapsed;
}

function getLegIndex(role) {
  if (typeof role !== 'string' || !role.startsWith('leg')) return -1;
  return Number(role.slice(3));
}

// Walking gait for one leg pair. The cycle has two halves:
//   norm ∈ [0, π)  swing phase  — leg lifted, swept -SWING → 0 → +SWING (back to front)
//   norm ∈ [π, 2π) stance phase — leg planted, dragged +SWING → 0 → -SWING (front to back)
// The two pairs run π apart, so exactly one pair is lifted at any moment and the
// silhouette outline at the foot rises per pair instead of as a group.
function legGait(phase) {
  const norm = ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const swing = -Math.cos(norm) * WALK_SWING_RAD;
  const isStance = norm >= Math.PI;
  // Swing pair: foot rises in an arc relative to the (also-bobbing) body.
  // Stance pair: foot is pinned to the ground line — it cancels the body bob so
  // the planted foot stays put while the hip rides up with the torso.
  const lift = isStance ? 0 : Math.sin(norm) * WALK_LIFT_VOXELS;
  return { swing, lift, isStance };
}

function renderFrame(timeMs) {
  // Walk-mode time accumulation (speed-scaled real time)
  if (WALK) {
    if (PROBE) {
      walkTimeMs = PROBE_TIME;
    } else if (lastFrameMs !== null) {
      walkTimeMs += (timeMs - lastFrameMs) * speed;
    }
    lastFrameMs = timeMs;
  }

  // In walk mode: leg-swing + body bob run continuously, while the story
  // cycle layers in scripted gestures (glances, twists, flips), lateral sway
  // (organic on the trail), gait speed (slow stroll → frozen pause → run),
  // and a render-scale multiplier (zoom in during the run).
  let yawAngle, tiltAngle, mascotSwayCols = 0, mascotScaleMult = 1, mascotLiftRows = 0, hideMascot = false;
  if (WALK) {
    const gesture = currentWalkGesture(walkTimeMs);
    yawAngle = gesture.yaw;
    tiltAngle = gesture.pitch;
    mascotScaleMult = gesture.scale;
    hideMascot = Boolean(gesture.hideMascot);
    // Abduction: lift the mascot upward toward the UFO. lift fraction 0..1
    // maps to rising from his ground position to ~near the top of the canvas.
    mascotLiftRows = -Math.round(gesture.lift * (SCREEN_CY - 4));
    if (gesture.sway > 0) {
      // Multi-frequency sin → wandering feel. Quantized to integer cells so
      // the silhouette doesn't twitch by 1 cell every frame near sub-pixel
      // boundaries — sway only changes when crossing a real cell threshold.
      const t = walkTimeMs / 1000;
      const raw = (Math.sin(t * 0.95) * 0.65 + Math.sin(t * 1.47 + 1.3) * 0.35) * gesture.sway;
      mascotSwayCols = Math.round(raw);
    }
  } else {
    yawAngle = (timeMs / SPIN_PERIOD_MS) * Math.PI * 2;
    tiltAngle = Math.sin((timeMs / TILT_PERIOD_MS) * Math.PI * 2) * TILT_AMPLITUDE;
  }
  const palette = PALETTES[Math.floor(timeMs / PALETTE_PERIOD_MS) % 24];

  const sinY = Math.sin(yawAngle), cosY = Math.cos(yawAngle);
  const sinX = Math.sin(tiltAngle), cosX = Math.cos(tiltAngle);

  // Walk state — alternating pairs (0,2 vs 1,3) run a swing/stance gait π apart,
  // so exactly one pair is lifted at any moment. Body bob peaks at each pair's
  // mid-swing (every half-cycle) and dips on the neutral crossings between.
  // Phase is derived from the integrated GAIT clock so legs slow during pauses
  // and speed up during the running finale.
  const walkPhase = WALK
    ? (gaitClockAt(walkTimeMs) / WALK_BASE_PERIOD_MS) * 2 * Math.PI
    : 0;
  const gaitA = legGait(walkPhase);
  const gaitB = legGait(walkPhase + Math.PI);
  const legSwings  = [gaitA.swing,   gaitB.swing,   gaitA.swing,   gaitB.swing];
  const legLifts   = [gaitA.lift,    gaitB.lift,    gaitA.lift,    gaitB.lift];
  const legStances = [gaitA.isStance, gaitB.isStance, gaitA.isStance, gaitB.isStance];
  const bodyBob = WALK ? Math.abs(Math.sin(walkPhase)) * WALK_BOB_VOXELS : 0;

  const fb = Array.from({ length: COLS }, () => Array(HALF_ROWS).fill(null));
  const depth = Array.from({ length: COLS }, () => Array(HALF_ROWS).fill(-Infinity));
  const isVoxel = Array.from({ length: COLS }, () => Array(HALF_ROWS).fill(false));

  if (WALK) paintLandscape(fb, depth, walkTimeMs);

  if (!hideMascot) for (const [vx, vy, vz, role, nx0, ny0, nz0] of VOXELS) {
    // Walk-mode per-voxel transform: leg swing around hip, then body bob.
    let vyBody = vy, vzBody = vz;
    let nyBody = ny0, nzBody = nz0;
    if (WALK) {
      const legIdx = getLegIndex(role);
      if (legIdx >= 0) {
        const swing = legSwings[legIdx];
        const baseLift = legLifts[legIdx];
        const isStance = legStances[legIdx];
        // Per-voxel lift, normalised hip→foot (t=0 hip, t=1 foot):
        //   swing leg  → lift scales 0 → baseLift (knee-flex; foot rises most)
        //   stance leg → lift scales 0 → -bodyBob (foot pinned, hip tracks body)
        const t = (vy - HIP_Y) / 4;
        const voxelLift = isStance ? -bodyBob * t : baseLift * t;
        const cs = Math.cos(swing), sn = Math.sin(swing);
        const ly = vy - HIP_Y;
        const lz = vz - HIP_Z;
        vyBody = ly * cs - lz * sn + HIP_Y - voxelLift;
        vzBody = ly * sn + lz * cs + HIP_Z;
        nyBody = ny0 * cs - nz0 * sn;
        nzBody = ny0 * sn + nz0 * cs;
      }
      vyBody -= bodyBob;
    }

    const x0 = vx - CX_MODEL;
    const y0 = vyBody - CY_MODEL;
    const z0 = vzBody - CZ_MODEL;

    // Yaw (Y-axis), then tilt (X-axis) — applied to position AND normal
    const xr = x0 * cosY - z0 * sinY;
    const zr = x0 * sinY + z0 * cosY;
    const yr = y0 * cosX - zr * sinX;
    const zr2 = y0 * sinX + zr * cosX;

    const nxY = nx0 * cosY - nzBody * sinY;
    const nzY = nx0 * sinY + nzBody * cosY;
    const nxFinal = nxY;
    const nyFinal = nyBody * cosX - nzY * sinX;
    const nzFinal = nyBody * sinX + nzY * cosX;

    const screenX0 = Math.round(SCREEN_CX + mascotSwayCols + xr * SCALE_X * mascotScaleMult) - 1;
    const screenY0 = Math.round(SCREEN_CY + mascotLiftRows + yr * SCALE_Y * mascotScaleMult) - 0;

    let colour;
    if (role === 'eye' || role === 'mouth') {
      colour = EYE;
    } else if (role === 'shine') {
      colour = SHINE;
    } else {
      const palIdx = paletteForBodyVoxel(vx, vy, palette);
      const { body, shadow } = COLOURS[palIdx];
      // Lambertian shading: brightness = dot(rotated normal, light direction).
      // LIGHT is biased upward and slightly to the camera's right, so the top
      // of any face catches more light than the bottom — gives every leg/arm
      // a clear lit-side / shadow-side as it spins.
      const dot = nxFinal * LIGHT[0] + nyFinal * LIGHT[1] + nzFinal * LIGHT[2];
      const lightT = Math.max(0, Math.min(1, 0.5 + 0.5 * dot));
      // 3-stop shading: shadow (under-lit) → body (mid) → highlight (top-lit).
      // The highlight kicks in for the brightest 35% of light values, giving
      // the mascot more colour pop than a flat shadow→body lerp.
      if (lightT < 0.65) {
        colour = lerpRgb(shadow, body, lightT / 0.65);
      } else {
        const k = (lightT - 0.65) / 0.35;
        colour = lerpRgb(body, SHINE, k * 0.45);
      }
    }

    // Effective footprint scales with the zoom factor — when the mascot is
    // rendered larger (run-phase zoom-in), the per-voxel footprint must grow
    // to match, otherwise adjacent voxels land 2 cells apart with a 1-cell
    // gap between them, producing a grid/screen-door artefact on the body.
    const effFootX = Math.max(FOOTPRINT_X, Math.ceil(SCALE_X * mascotScaleMult));
    const effFootY = Math.max(FOOTPRINT_Y, Math.ceil(SCALE_Y * mascotScaleMult));
    for (let dx = 0; dx < effFootX; dx++) {
      for (let dy = 0; dy < effFootY; dy++) {
        const sx = screenX0 + dx;
        const sy = screenY0 + dy;
        if (sx < 0 || sx >= COLS || sy < 0 || sy >= HALF_ROWS) continue;
        if (zr2 > depth[sx][sy]) {
          depth[sx][sy] = zr2;
          fb[sx][sy] = colour;
          isVoxel[sx][sy] = true;
        }
      }
    }
  }

  // Internal articulation pass — only on voxel cells (skip landscape).
  const EDGE_DELTA = 1.4;
  const EDGE_BLEND = 0.45;
  for (let sx = 0; sx < COLS; sx++) {
    for (let sy = 0; sy < HALF_ROWS; sy++) {
      if (!isVoxel[sx][sy]) continue;
      const here = fb[sx][sy];
      const myD = depth[sx][sy];
      let isBack = false;
      if (sx > 0           && isVoxel[sx-1][sy] && depth[sx-1][sy] - myD > EDGE_DELTA) isBack = true;
      else if (sx < COLS-1     && isVoxel[sx+1][sy] && depth[sx+1][sy] - myD > EDGE_DELTA) isBack = true;
      else if (sy > 0          && isVoxel[sx][sy-1] && depth[sx][sy-1] - myD > EDGE_DELTA) isBack = true;
      else if (sy < HALF_ROWS-1 && isVoxel[sx][sy+1] && depth[sx][sy+1] - myD > EDGE_DELTA) isBack = true;
      if (isBack) fb[sx][sy] = lerpRgb(here, OUTLINE, EDGE_BLEND);
    }
  }

  // Silhouette outline: paint any non-voxel cell adjacent to a voxel cell with
  // OUTLINE. Snapshot the voxel mask so the outline doesn't recursively dilate.
  const voxelSnap = isVoxel.map((col) => col.slice());
  for (let sx = 0; sx < COLS; sx++) {
    for (let sy = 0; sy < HALF_ROWS; sy++) {
      if (voxelSnap[sx][sy]) continue;
      if (
        (sx > 0          && voxelSnap[sx - 1][sy]) ||
        (sx < COLS - 1   && voxelSnap[sx + 1][sy]) ||
        (sy > 0          && voxelSnap[sx][sy - 1]) ||
        (sy < HALF_ROWS-1 && voxelSnap[sx][sy + 1])
      ) {
        fb[sx][sy] = OUTLINE;
      }
    }
  }

  // Compose ANSI string with simple state-tracked colour switches
  let out = PROBE ? '' : '\x1b[H';
  for (let row = 0; row < ROWS; row++) {
    let lastFg = null, lastBg = null;
    let line = '';
    for (let col = 0; col < COLS; col++) {
      const top = fb[col][row * 2];
      const bot = fb[col][row * 2 + 1];
      if (top && bot) {
        if (!eqRgb(top, lastFg)) { line += fg(top); lastFg = top; }
        if (!eqRgb(bot, lastBg)) { line += bg(bot); lastBg = bot; }
        line += '▀';
      } else if (top) {
        if (!eqRgb(top, lastFg)) { line += fg(top); lastFg = top; }
        if (lastBg !== null)     { line += '\x1b[49m'; lastBg = null; }
        line += '▀';
      } else if (bot) {
        if (!eqRgb(bot, lastFg)) { line += fg(bot); lastFg = bot; }
        if (lastBg !== null)     { line += '\x1b[49m'; lastBg = null; }
        line += '▄';
      } else {
        if (lastBg !== null)     { line += '\x1b[49m'; lastBg = null; }
        line += ' ';
      }
    }
    out += line + '\x1b[0m\n';
  }
  if (WALK && !PROBE) {
    // Status line: speed indicator and key hints.
    out += '\x1b[2K  speed ' + speed.toFixed(2).padStart(4) + 'x   '
        + '[+ faster] [- slower] [0 reset] [q quit]\n';
  }
  process.stdout.write(out);
}

// ---- Loop ------------------------------------------------------------------

if (PROBE) {
  renderFrame(PROBE_TIME);
  process.exit(0);
}

process.stdout.write('\x1b[?25l\x1b[2J');  // hide cursor + clear

// Walk mode: live speed control via stdin keys.
if (WALK && process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (buf) => {
    const k = buf.toString();
    if (k === '\x03' || k === 'q') return shutdown();         // ctrl-c / q
    if (k === '+' || k === '=' || k === ']') speed = Math.min(SPEED_MAX, speed * 1.18);
    else if (k === '-' || k === '_' || k === '[') speed = Math.max(SPEED_MIN, speed / 1.18);
    else if (k === '0') speed = 1.0;
  });
}

let frameCount = 0;
const startTime = Date.now();
const interval = setInterval(() => {
  renderFrame(Date.now() - startTime);
  frameCount += 1;
  if (frameCount >= MAX_FRAMES) shutdown();
}, Math.round(1000 / FPS));

function shutdown() {
  clearInterval(interval);
  if (WALK && process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch {}
    process.stdin.pause();
  }
  process.stdout.write('\x1b[?25h\x1b[0m\n');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
