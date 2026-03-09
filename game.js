'use strict';

// ---- Constants ----
const GRID_SIZE  = 15;
const CELL_SIZE  = 40;
const NUM_PRIZES = 20;
const MOVE_SPEED = 300;
const BASE_TIME  = 30;
const TIME_STEP  = 3;
const MIN_TIME   = 12;
const MAX_LEVEL  = (BASE_TIME - MIN_TIME) / TIME_STEP + 1; // 7 levels

// ---- Canvas ----
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

// ---- Game state ----
let cells            = [];
let playerPixel      = { x: 0, y: 0 };
let playerCell       = { row: 0, col: 0 };
let targetPixel      = { x: 0, y: 0 };
let targetCell       = { row: 0, col: 0 };
let isMoving         = false;
let playerFacing     = 0;
let score            = 0;
let level            = 1;
let currentLevelTime = BASE_TIME;
let timeLeft         = BASE_TIME;
let gameState        = 'start';
let timerInterval    = null;
let animFrame        = null;
let lastTimestamp    = null;

const keysDown     = new Set();
let lastPressedDir = null;

let walkPhase = 0;

// ---- Directions ----
const DIR_INFO = {
  right: { dr: 0,  dc:  1, wall: 'right',  opposite: 'left',   angle:  0            },
  down:  { dr: 1,  dc:  0, wall: 'bottom', opposite: 'top',    angle:  Math.PI / 2  },
  left:  { dr: 0,  dc: -1, wall: 'left',   opposite: 'right',  angle:  Math.PI      },
  up:    { dr: -1, dc:  0, wall: 'top',    opposite: 'bottom', angle: -Math.PI / 2  },
};

const KEY_MAP = {
  ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down',
  d: 'right', a: 'left', w: 'up', s: 'down',
  D: 'right', A: 'left', W: 'up', S: 'down',
};

// ---- Cells ----
function initCells() {
  cells = Array.from({ length: GRID_SIZE }, (_, r) =>
    Array.from({ length: GRID_SIZE }, (_, c) => ({
      walls: {
        top:    r === 0,
        right:  c === GRID_SIZE - 1,
        bottom: r === GRID_SIZE - 1,
        left:   c === 0,
      },
      hasPrize: false,
    }))
  );
}

function isReachable() {
  const visited = Array.from({ length: GRID_SIZE }, () => new Array(GRID_SIZE).fill(false));
  const queue   = [[0, 0]];
  visited[0][0] = true;
  while (queue.length > 0) {
    const [r, c] = queue.shift();
    if (r === GRID_SIZE - 1 && c === GRID_SIZE - 1) return true;
    for (const { dr, dc, wall } of Object.values(DIR_INFO)) {
      if (cells[r][c].walls[wall]) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE && !visited[nr][nc]) {
        visited[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }
  }
  return false;
}

function generateWalls() {
  let attempts = 0;
  do {
    initCells();
    for (let i = 0; i < 22; i++) {
      const horiz  = Math.random() < 0.5;
      const length = 2 + Math.floor(Math.random() * 3);
      if (horiz) {
        const r = 1 + Math.floor(Math.random() * (GRID_SIZE - 2));
        const c = Math.floor(Math.random() * (GRID_SIZE - length));
        for (let k = 0; k < length; k++) {
          cells[r    ][c + k].walls.bottom = true;
          cells[r + 1][c + k].walls.top    = true;
        }
      } else {
        const r = Math.floor(Math.random() * (GRID_SIZE - length));
        const c = 1 + Math.floor(Math.random() * (GRID_SIZE - 2));
        for (let k = 0; k < length; k++) {
          cells[r + k][c    ].walls.right = true;
          cells[r + k][c + 1].walls.left  = true;
        }
      }
    }
    attempts++;
  } while (!isReachable() && attempts < 40);
  if (!isReachable()) initCells();
}

function placePrizes() {
  let placed = 0;
  while (placed < NUM_PRIZES) {
    const r = Math.floor(Math.random() * GRID_SIZE);
    const c = Math.floor(Math.random() * GRID_SIZE);
    if ((r === 0 && c === 0) || (r === GRID_SIZE - 1 && c === GRID_SIZE - 1)) continue;
    if (!cells[r][c].hasPrize) { cells[r][c].hasPrize = true; placed++; }
  }
}

// ---- Movement ----
function getPreferredDir() {
  if (lastPressedDir && keysDown.has(lastPressedDir)) return lastPressedDir;
  for (const dir of keysDown) return dir;
  return null;
}

function tryStartMovement(dir) {
  if (!dir) return false;
  const { dr, dc, wall, angle } = DIR_INFO[dir];
  const { row, col } = playerCell;
  if (cells[row][col].walls[wall]) return false;
  const nr = row + dr, nc = col + dc;
  if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) return false;
  targetCell   = { row: nr, col: nc };
  targetPixel  = { x: nc * CELL_SIZE, y: nr * CELL_SIZE };
  playerFacing = angle;
  isMoving     = true;
  return true;
}

function arriveAtTarget() {
  playerPixel = { ...targetPixel };
  playerCell  = { ...targetCell };
  isMoving    = false;

  if (cells[playerCell.row][playerCell.col].hasPrize) {
    cells[playerCell.row][playerCell.col].hasPrize = false;
    score++;
    updateHUD();
  }

  if (playerCell.row === GRID_SIZE - 1 && playerCell.col === GRID_SIZE - 1) {
    endGame(level >= MAX_LEVEL ? 'game_complete' : 'level_complete');
    return;
  }

  tryStartMovement(getPreferredDir());
}

function updateMovement(dt) {
  if (gameState !== 'playing') return;
  if (!isMoving) { tryStartMovement(getPreferredDir()); return; }
  const dx   = targetPixel.x - playerPixel.x;
  const dy   = targetPixel.y - playerPixel.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const step = MOVE_SPEED * dt / 1000;
  if (dist <= step) { arriveAtTarget(); }
  else { playerPixel.x += (dx / dist) * step; playerPixel.y += (dy / dist) * step; }
}

// ---- Drawing ----
function drawBackground() {
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawCells() {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const x = c * CELL_SIZE, y = r * CELL_SIZE;
      ctx.fillStyle = '#16213e';
      ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
      if (r === GRID_SIZE - 1 && c === GRID_SIZE - 1) {
        ctx.fillStyle = 'rgba(0, 255, 136, 0.18)';
        ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
      }
    }
  }
}

function drawWalls() {
  ctx.strokeStyle = '#5555e8';
  ctx.lineWidth   = 3;
  ctx.lineCap     = 'square';
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const x = c * CELL_SIZE, y = r * CELL_SIZE;
      const cell = cells[r][c];
      if (cell.walls.top)    { ctx.beginPath(); ctx.moveTo(x, y);             ctx.lineTo(x + CELL_SIZE, y);             ctx.stroke(); }
      if (cell.walls.right)  { ctx.beginPath(); ctx.moveTo(x + CELL_SIZE, y); ctx.lineTo(x + CELL_SIZE, y + CELL_SIZE); ctx.stroke(); }
      if (cell.walls.bottom) { ctx.beginPath(); ctx.moveTo(x, y + CELL_SIZE); ctx.lineTo(x + CELL_SIZE, y + CELL_SIZE); ctx.stroke(); }
      if (cell.walls.left)   { ctx.beginPath(); ctx.moveTo(x, y);             ctx.lineTo(x, y + CELL_SIZE);             ctx.stroke(); }
    }
  }
}

function drawPrizes() {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!cells[r][c].hasPrize) continue;
      const x = c * CELL_SIZE + CELL_SIZE / 2;
      const y = r * CELL_SIZE + CELL_SIZE / 2;
      ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 8;
      ctx.fillStyle = '#ffd700';
      ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

// Draws an armoured shelter door (ממ"ד) set in a concrete wall
function drawGoal() {
  const gx = (GRID_SIZE - 1) * CELL_SIZE;
  const gy = (GRID_SIZE - 1) * CELL_SIZE;
  const cx = gx + CELL_SIZE / 2;
  const cy = gy + CELL_SIZE / 2;

  ctx.shadowColor = '#00ff88';
  ctx.shadowBlur  = 10;

  // ── Concrete wall ──────────────────────────────────
  ctx.fillStyle = '#6a6a7a';
  ctx.fillRect(gx + 1, gy + 1, CELL_SIZE - 2, CELL_SIZE - 2);

  // Horizontal mortar lines
  ctx.strokeStyle = '#505060';
  ctx.lineWidth   = 1;
  for (let row = 1; row <= 3; row++) {
    const ly = gy + row * (CELL_SIZE / 4);
    ctx.beginPath(); ctx.moveTo(gx + 1, ly); ctx.lineTo(gx + CELL_SIZE - 1, ly); ctx.stroke();
  }
  // Vertical mortar lines (staggered)
  [[0, 0.5], [1, 0.25], [2, 0.75], [3, 0.5]].forEach(([row, xFrac]) => {
    const lx  = gx + xFrac * CELL_SIZE;
    const ly1 = gy + row * (CELL_SIZE / 4);
    const ly2 = gy + (row + 1) * (CELL_SIZE / 4);
    ctx.beginPath(); ctx.moveTo(lx, ly1); ctx.lineTo(lx, ly2); ctx.stroke();
  });

  // ── Armoured door frame ────────────────────────────
  const dw = CELL_SIZE * 0.60;
  const dh = CELL_SIZE * 0.78;
  const dx = cx - dw / 2;
  const dy = cy - dh / 2;

  ctx.fillStyle = '#2a3a2a';              // steel frame
  ctx.fillRect(dx - 2, dy - 2, dw + 4, dh + 4);

  ctx.fillStyle = '#1e2e1e';              // door panel
  ctx.fillRect(dx, dy, dw, dh);

  // Diagonal X reinforcement bars
  ctx.strokeStyle = '#3a5a3a';
  ctx.lineWidth   = 2;
  ctx.beginPath(); ctx.moveTo(dx + 2, dy + 2);      ctx.lineTo(dx + dw - 2, dy + dh - 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(dx + dw - 2, dy + 2); ctx.lineTo(dx + 2, dy + dh - 2);      ctx.stroke();

  // Corner bolts
  ctx.shadowColor = '#00ff88';
  ctx.shadowBlur  = 5;
  ctx.fillStyle   = '#88ee88';
  [[dx + 4, dy + 4], [dx + dw - 4, dy + 4],
   [dx + 4, dy + dh - 4], [dx + dw - 4, dy + dh - 4]].forEach(([bx, by]) => {
    ctx.beginPath(); ctx.arc(bx, by, 2, 0, Math.PI * 2); ctx.fill();
  });

  // Door handle (right side, centred vertically)
  ctx.fillStyle  = '#aaffaa';
  ctx.shadowBlur = 3;
  ctx.fillRect(dx + dw - 6, cy - 4, 4, 8);

  ctx.shadowBlur = 0;
}

// Top-view walking person (faces playerFacing direction)
function drawPlayer() {
  walkPhase += 0.18;
  const swing = Math.sin(walkPhase) * 3.5;

  const cx = playerPixel.x + CELL_SIZE / 2;
  const cy = playerPixel.y + CELL_SIZE / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(playerFacing); // figure faces movement direction

  ctx.shadowColor = '#44aaff';
  ctx.shadowBlur  = 8;

  // Legs (drawn first — furthest back, behind body)
  ctx.fillStyle = '#2a3a55'; // dark jeans
  ctx.beginPath(); ctx.ellipse(-8,  3 + swing, 3, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-8, -3 - swing, 3, 2.5, 0, 0, Math.PI * 2); ctx.fill();

  // Torso
  ctx.fillStyle = '#3366cc'; // blue shirt
  ctx.beginPath(); ctx.ellipse(-1, 0, 8, 5, 0, 0, Math.PI * 2); ctx.fill();

  // Arms (swing opposite to legs)
  ctx.fillStyle = '#f5c098'; // skin
  ctx.beginPath(); ctx.ellipse(0,  8 - swing * 0.6, 2.5, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, -8 + swing * 0.6, 2.5, 4.5, 0, 0, Math.PI * 2); ctx.fill();

  // Head (at front of figure)
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#f5c098'; // skin
  ctx.beginPath(); ctx.arc(9, 0, 5, 0, Math.PI * 2); ctx.fill();

  // Hair — back half arc to suggest depth
  ctx.fillStyle = '#6b3a2a';
  ctx.beginPath(); ctx.arc(9, 0, 5, Math.PI * 0.6, Math.PI * 1.4); ctx.fill();

  ctx.restore();
}

function drawFrame() {
  drawBackground();
  drawCells();
  drawWalls();
  drawPrizes();
  drawGoal();
  drawPlayer();
}

// ---- HUD ----
function updateHUD() {
  document.getElementById('score-display').textContent = `ניקוד: ${score}`;
  document.getElementById('level-display').textContent = `שלב ${level}/${MAX_LEVEL}`;
  const timerEl = document.getElementById('timer-display');
  timerEl.textContent = `${timeLeft}s`;
  timerEl.className   = timeLeft <= 10 ? 'warning' : '';

  // Missile: flies left→right toward shelter using pixel positions
  // pct=1 (full time) → missile at far left; pct=0 → missile overlaps shelter
  const pct     = currentLevelTime > 0 ? timeLeft / currentLevelTime : 0;
  const track   = document.getElementById('missile-track');
  const missile = document.getElementById('missile-icon');
  const shelter = document.getElementById('missile-shelter');
  const trackW  = track.offsetWidth  || 580;
  const shelW   = shelter.offsetWidth || 22;
  const startX  = 4;
  const endX    = trackW - shelW - 2; // missile left edge aligns with shelter
  const x       = startX + (1 - pct) * (endX - startX);
  missile.style.left = Math.round(x) + 'px';
}

// ---- Overlay helper ----
function showOverlay({ title, titleColor, message, showStart, showNext, showShare, showControls }) {
  document.getElementById('overlay-title').textContent  = title;
  document.getElementById('overlay-title').style.color  = titleColor || '#ffd700';
  document.getElementById('overlay-message').textContent = message;
  document.getElementById('overlay-controls').style.display = showControls ? '' : 'none';
  document.getElementById('start-btn').style.display  = showStart  ? '' : 'none';
  document.getElementById('next-btn').style.display   = showNext   ? '' : 'none';
  document.getElementById('share-btn').style.display  = showShare  ? '' : 'none';
  document.getElementById('overlay').style.display    = 'flex';
}

// ---- Game lifecycle ----
function endGame(result) {
  gameState = result;
  clearInterval(timerInterval);
  cancelAnimationFrame(animFrame);
  lastTimestamp = null;
  drawFrame();

  if (result === 'level_complete') {
    const nextTime = currentLevelTime - TIME_STEP;
    showOverlay({
      title:        `שלב ${level} הושלם! 🏠`,
      titleColor:   '#00ff88',
      message:      `הגעת למקלט! ניקוד מצטבר: ${score}\nשלב ${level + 1} מתחיל עם ${nextTime} שניות`,
      showNext:     true,
      showStart:    false,
      showShare:    true,
      showControls: false,
    });
  } else if (result === 'game_complete') {
    showOverlay({
      title:        '🏆 ניצחת את המשחק!',
      titleColor:   '#ffd700',
      message:      `עברת את כל ${MAX_LEVEL} השלבים!\nניקוד סופי: ${score} נקודות`,
      showStart:    true,
      showNext:     false,
      showShare:    true,
      showControls: false,
    });
  } else {
    showOverlay({
      title:        '💥 הטיל הגיע!',
      titleColor:   '#ff4444',
      message:      `לא הגעת למקלט בזמן!\nניקוד: ${score} (מאופס)`,
      showStart:    true,
      showNext:     false,
      showShare:    false,
      showControls: false,
    });
    score = 0;
    level = 1;
  }
}

function gameLoop(timestamp) {
  const dt = lastTimestamp ? Math.min(timestamp - lastTimestamp, 50) : 16;
  lastTimestamp = timestamp;
  updateMovement(dt);
  drawFrame();
  if (gameState === 'playing') animFrame = requestAnimationFrame(gameLoop);
}

function startLevel() {
  currentLevelTime = Math.max(MIN_TIME, BASE_TIME - (level - 1) * TIME_STEP);
  timeLeft         = currentLevelTime;
  playerCell       = { row: 0, col: 0 };
  playerPixel      = { x: 0, y: 0 };
  targetCell       = { row: 0, col: 0 };
  targetPixel      = { x: 0, y: 0 };
  isMoving         = false;
  playerFacing     = 0;
  walkPhase        = 0;
  lastPressedDir   = null;
  keysDown.clear();
  gameState        = 'playing';
  lastTimestamp    = null;

  generateWalls();
  placePrizes();

  document.getElementById('overlay').style.display = 'none';
  updateHUD();

  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeLeft--;
    updateHUD();
    if (timeLeft <= 0) endGame('lose');
  }, 1000);

  cancelAnimationFrame(animFrame);
  animFrame = requestAnimationFrame(gameLoop);
}

function startGame() {
  score = 0;
  level = 1;
  startLevel();
}

function nextLevel() {
  level++;
  startLevel();
}

// ---- Share ----
async function shareScore() {
  const resultText = gameState === 'game_complete'
    ? `ניצחתי את כל ${MAX_LEVEL} השלבים`
    : `הגעתי לשלב ${level}`;
  const text = `🚀 ממ"ד ראן של עברי 🏠\n${resultText} עם ${score} נקודות!\nהאם תוכל לעשות יותר ממני?\n\nhttps://karnovsk.github.io/mammad_run/`;

  if (navigator.share) {
    try { await navigator.share({ title: 'ממ"ד ראן של עברי', text }); } catch (_) {}
  } else {
    try {
      await navigator.clipboard.writeText(text);
      alert('הטקסט הועתק ללוח!');
    } catch (_) {
      alert(text);
    }
  }
}

// ---- Input ----
document.addEventListener('keydown', (e) => {
  const dir = KEY_MAP[e.key];
  if (!dir) return;
  e.preventDefault();
  keysDown.add(dir);
  lastPressedDir = dir;
  if (gameState === 'playing' && !isMoving) tryStartMovement(dir);
});

document.addEventListener('keyup', (e) => {
  const dir = KEY_MAP[e.key];
  if (!dir) return;
  keysDown.delete(dir);
  if (lastPressedDir === dir) {
    const remaining = [...keysDown];
    lastPressedDir = remaining.length > 0 ? remaining[remaining.length - 1] : null;
  }
});

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('next-btn').addEventListener('click', nextLevel);
document.getElementById('share-btn').addEventListener('click', shareScore);

// ---- D-Pad ----
function dpadPress(dir) {
  keysDown.add(dir);
  lastPressedDir = dir;
  if (gameState === 'playing' && !isMoving) tryStartMovement(dir);
  document.querySelector(`.dpad-btn[data-dir="${dir}"]`)?.classList.add('pressed');
}

function dpadRelease(dir) {
  keysDown.delete(dir);
  if (lastPressedDir === dir) {
    const remaining = [...keysDown];
    lastPressedDir = remaining.length > 0 ? remaining[remaining.length - 1] : null;
  }
  document.querySelector(`.dpad-btn[data-dir="${dir}"]`)?.classList.remove('pressed');
}

document.querySelectorAll('.dpad-btn[data-dir]').forEach(btn => {
  const dir = btn.dataset.dir;
  btn.addEventListener('touchstart',  (e) => { e.preventDefault(); dpadPress(dir);   }, { passive: false });
  btn.addEventListener('touchend',    (e) => { e.preventDefault(); dpadRelease(dir); }, { passive: false });
  btn.addEventListener('touchcancel', ()  => { dpadRelease(dir); });
  btn.addEventListener('mousedown',  () => dpadPress(dir));
  btn.addEventListener('mouseup',    () => dpadRelease(dir));
  btn.addEventListener('mouseleave', () => { if (keysDown.has(dir)) dpadRelease(dir); });
});

// Initial draw
drawBackground();
