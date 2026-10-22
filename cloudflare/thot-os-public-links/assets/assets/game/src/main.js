import { advanceRun, createRun, move } from './simulation.js';
import { renderGame } from './render.js';
import { rankEntries, replayScore } from './leaderboard.js';
import { boostLine, stumbleLine } from './banter.js';

const $ = (selector) => document.querySelector(selector);
const game = $('#game');
const screens = [...document.querySelectorAll('[data-screen]')];
const cards = [...document.querySelectorAll('[data-player]')];
const roster = cards.map((card) => ({
  handle: card.dataset.player,
  name: card.querySelector('.player-name').textContent.trim(),
  profile: card.querySelector('.profile-link').getAttribute('href'),
}));
// Visual bookends keep both neighbours in view when the carousel wraps.
const playerList = $('#player-list');
for (const [card, position] of [[cards.at(-1), 'prepend'], [cards[0], 'append']]) {
  const ghost = card.cloneNode(true);
  ghost.classList.add('player-card-ghost');
  ghost.removeAttribute('aria-current');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.querySelector('[data-select-player]')?.removeAttribute('data-select-player');
  playerList[position](ghost);
}
const canvas = $('#game-canvas');
const ctx = canvas.getContext('2d');
const spriteSheet = new Image();
let spriteReady = false;
let spriteRequested = false;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
};

let screen = 'power';
let selectedIndex = 0;
let run = null;
let raf = 0;
let previousFrame = 0;
let accumulator = 0;
let resultHold = null;
let calloutTime = 0;
let audioContext = null;
let audioUnlocked = false;
let muted = true;
const musicTracks = [new Audio(), new Audio()];
musicTracks.forEach((track) => { track.preload = 'none'; track.volume = 0; });
const musicVolume = 0.5;
const musicFadeMs = 800;
let musicHandle = null;
let activeMusic = null;
let musicFade = 0;
let musicPlaying = false;
let moveLog = [];
let scoreRecorded = false;
let boardReturnScreen = 'select';

function localBoard() {
  try { return JSON.parse(storage.get('over-there-local-board-v2') || '[]'); }
  catch { return []; }
}

function renderBoard(entries, scope) {
  const list = $('#board-list');
  list.replaceChildren();
  const names = new Map(roster.map((player) => [player.handle, player.name]));
  for (const entry of rankEntries(entries)) {
    const item = document.createElement('li');
    const top = document.createElement('div');
    top.className = 'board-entry-top';
    const name = document.createElement('strong');
    name.textContent = entry.name;
    const creator = document.createElement('small');
    creator.textContent = names.get(entry.handle) || entry.handle;
    top.append(name, creator);
    const meta = document.createElement('div');
    meta.className = 'board-entry-meta';
    meta.textContent = `${entry.time.toFixed(1)} SECONDS · ${entry.distance} M`;
    item.append(top, meta);
    list.append(item);
  }
  $('#board-empty').hidden = list.children.length > 0;
  $('#board-scope').textContent = scope === 'shared-preview' ? 'SHARED ON THIS PREVIEW' :
    scope === 'global' ? 'GLOBAL RECORDS' : 'SAVED ON THIS DEVICE';
}

async function openBoard(from = screen) {
  boardReturnScreen = from;
  showScreen('board');
  syncMusic();
  $('#board-scope').textContent = 'LOADING RECORDS...';
  try {
    const response = await fetch('/api/leaderboard', { cache: 'no-store' });
    if (!response.ok) throw new Error('Leaderboard unavailable.');
    const board = await response.json();
    if (screen === 'board') renderBoard(board.entries, board.scope);
  } catch {
    if (screen === 'board') renderBoard(localBoard(), 'local');
  }
}

function recordMove(direction) {
  if (!run || run.status !== 'running') return;
  const previousLane = run.lane;
  move(run, direction);
  if (run.lane !== previousLane) moveLog.push({ tick: Math.round(run.time * 60), direction });
}

function showScreen(next) {
  screen = next;
  game.dataset.state = next;
  for (const section of screens) {
    const active = section.dataset.screen === next;
    section.hidden = !active;
    section.setAttribute('aria-hidden', String(!active));
  }
}

function setSelection(index, focus = false) {
  const wrapped = index < 0 || index >= roster.length;
  selectedIndex = (index + roster.length) % roster.length;
  cards.forEach((card, i) => {
    if (i === selectedIndex) card.setAttribute('aria-current', 'true');
    else card.removeAttribute('aria-current');
  });
  const selected = cards[selectedIndex];
  $('#player-position').textContent = `${String(selectedIndex + 1).padStart(2, '0')} / ${String(roster.length).padStart(2, '0')}`;
  selected.scrollIntoView({ behavior: wrapped || reducedMotion.matches ? 'instant' : 'smooth', block: 'nearest', inline: 'center' });
  if (focus) selected.querySelector('[data-select-player]').focus({ preventScroll: true });
}

function updateBootSoundButton() {
  const button = $('#boot-sound-button');
  button.textContent = muted ? 'SOUND OFF' : musicPlaying ? 'SOUND ON' : 'ENABLE SOUND';
  button.setAttribute('aria-pressed', String(!muted && musicPlaying));
  button.setAttribute('aria-label', muted ? 'Turn sound on' : musicPlaying ? 'Turn sound off' : 'Enable sound');
}

function updateMuteButton() {
  const button = $('#mute-button');
  button.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
  button.setAttribute('aria-pressed', String(!muted));
  button.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
  updateBootSoundButton();
}

function updateMusicPlaying() {
  musicPlaying = Boolean(activeMusic && !activeMusic.paused && !activeMusic.ended);
  updateBootSoundButton();
}
musicTracks.forEach((track) => {
  track.addEventListener('playing', updateMusicPlaying);
  track.addEventListener('pause', updateMusicPlaying);
  track.addEventListener('ended', updateMusicPlaying);
  track.addEventListener('error', updateMusicPlaying);
});

function unlockAudio() {
  if (!audioContext) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioCtor) audioContext = new AudioCtor();
  }
  if (audioContext?.state === 'suspended') audioContext.resume().catch(() => {});
  audioUnlocked = Boolean(audioContext);
}

function tone(frequency, duration = 0.1, type = 'square', volume = 0.025) {
  if (muted || !audioUnlocked || !audioContext) return;
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function fadeMusicTo(track) {
  cancelAnimationFrame(musicFade);
  const starts = musicTracks.map((item) => item.volume);
  const start = performance.now();
  function step(now) {
    const progress = Math.min(1, (now - start) / musicFadeMs);
    // A gentle curve keeps the hand-off audible without a sudden level jump.
    const eased = progress * progress * (3 - 2 * progress);
    musicTracks.forEach((item, index) => {
      const target = item === track ? musicVolume : 0;
      item.volume = starts[index] + (target - starts[index]) * eased;
      if (progress === 1 && item !== track) item.pause();
    });
    if (progress < 1) musicFade = requestAnimationFrame(step);
    else musicFade = 0;
  }
  musicFade = requestAnimationFrame(step);
}

function stopMusicImmediately() {
  cancelAnimationFrame(musicFade);
  musicFade = 0;
  musicTracks.forEach((track) => { track.pause(); track.volume = 0; });
  activeMusic = null;
  musicHandle = null;
  updateMusicPlaying();
}

function syncMusic(restart = false) {
  const handle = screen === 'run' ? run?.handle :
    screen === 'caught' || (screen === 'board' && boardReturnScreen === 'caught') ? 'caught' :
      ['power', 'select', 'board'].includes(screen) ? 'loading' : null;
  if (document.hidden) { stopMusicImmediately(); return; }
  if (muted || !handle) {
    if (musicHandle !== null) {
      musicHandle = null;
      activeMusic = null;
      fadeMusicTo(null);
      updateMusicPlaying();
    }
    return;
  }
  if (handle === musicHandle && activeMusic) {
    if (restart) activeMusic.currentTime = 0;
    if (activeMusic.paused && !activeMusic.ended) {
      const track = activeMusic;
      track.volume = 0;
      track.play().then(() => {
        if (activeMusic === track && !muted && !document.hidden) fadeMusicTo(track);
      }).catch(updateMusicPlaying); // First visit may need a tap.
    }
    return;
  }
  const next = musicTracks.find((track) => track !== activeMusic && track.dataset.handle === handle)
    || musicTracks.find((track) => track !== activeMusic);
  if (next.dataset.handle !== handle) {
    next.pause();
    next.dataset.handle = handle;
    next.src = `/assets/game/music/${handle}.mp3`;
    next.volume = 0;
  }
  next.loop = handle !== 'caught';
  if (restart || next.ended) next.currentTime = 0;
  activeMusic = next;
  musicHandle = handle;
  next.play().then(() => {
    if (activeMusic === next && !muted && !document.hidden) fadeMusicTo(next);
  }).catch(updateMusicPlaying);
}

function loadLanding() {
  if (screen !== 'power') return;
  syncMusic();
  const progress = $('#boot-progress');
  const bar = progress.querySelector('span');
  const percent = $('#boot-percent');
  const enter = $('#power-button');
  const start = performance.now();
  const climb = reducedMotion.matches ? 180 : 850;
  const hold = reducedMotion.matches ? 250 : 1200;

  function update(now) {
    if (screen !== 'power') return;
    const elapsed = now - start;
    const value = elapsed < climb ? Math.min(99, Math.floor((elapsed / climb) * 99))
      : elapsed < climb + hold ? 99 : 100;
    progress.setAttribute('aria-valuenow', String(value));
    bar.style.width = `${value}%`;
    percent.textContent = `${value}%`;
    if (value === 100) {
      enter.disabled = false;
      return;
    }
    requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function enterLanding() {
  if (screen !== 'power' || $('#power-button').disabled) return;
  unlockAudio();
  if (storage.get('thot-os-95-muted') === null) {
    muted = false;
    storage.set('thot-os-95-muted', '0');
  }
  updateMuteButton();
  tone(660, 0.09);
  storage.set('thot-os-95-booted', '1');
  showScreen('select');
  syncMusic();
  setSelection(selectedIndex);
}

function updateHud() {
  if (!run) return;
  const player = roster.find((entry) => entry.handle === run.handle);
  $('#hud-player').textContent = (player?.name || run.handle).toUpperCase();
  $('#hud-distance').textContent = `${run.time.toFixed(1)} S`;
  $('#gap-value').textContent = `${Math.ceil(run.gap)}%`;
  $('#gap-fill').style.width = `${Math.max(0, run.gap)}%`;
  $('#gap-track').setAttribute('aria-valuenow', String(Math.round(run.gap)));
}

function showCallout(kind, line, effect = '') {
  const callout = $('#stumble-callout');
  callout.dataset.kind = kind;
  $('#callout-line').textContent = line;
  $('#callout-effect').textContent = effect;
  $('#callout-effect').hidden = !effect;
  calloutTime = kind === 'stumble' ? 1.05 : 1.5;
}

function finishRun() {
  cancelAnimationFrame(raf);
  raf = 0;
  const player = roster.find((entry) => entry.handle === run.handle);
  $('#caught-time').textContent = `${run.time.toFixed(1)} SECONDS`;
  $('#caught-distance').textContent = `DISTANCE: ${Math.floor(run.distance)} M`;
  $('#caught-player').textContent = player?.name || run.handle;
  $('#score-status').textContent = '';
  $('#score-form').hidden = false;
  $('#score-form button').disabled = false;
  $('#score-name').value = '';
  const visit = $('#visit-link');
  visit.href = player?.profile || '/';
  visit.textContent = `VISIT ${player?.name.toUpperCase() || 'PROFILE'} ↗`;
  showScreen('caught');
  syncMusic();
}

function frame(now) {
  if (screen !== 'run' || !run || document.hidden) { raf = 0; return; }
  const delta = previousFrame ? Math.min(0.1, Math.max(0, (now - previousFrame) / 1000)) : 0;
  previousFrame = now;
  if (run.status === 'running') {
    accumulator += delta;
    let steps = 0;
    while (accumulator >= 1 / 60 && steps < 6 && run.status === 'running') {
      advanceRun(run, 1 / 60);
      accumulator -= 1 / 60;
      steps += 1;
      if (run.lastEvent?.type === 'stumble') {
        showCallout('stumble', stumbleLine(run.handle, run.stumbles));
        tone(145, 0.13, 'triangle', 0.04);
      } else if (run.lastEvent?.type === 'caught') {
        tone(100, 0.35, 'sawtooth', 0.035);
      } else if (run.lastEvent?.type === 'boost') {
        const rare = run.lastEvent.item === 'powder';
        showCallout(rare ? 'powder' : 'red-bull', boostLine(run.handle, run.lastEvent.item),
          rare ? 'BOULDER GAP 100%' : `RED BULL · +${Math.round(run.lastEvent.restored)}% GAP`);
        tone(rare ? 880 : 660, 0.17, 'square', 0.025);
      }
    }
    if (steps === 6) accumulator = 0;
  }
  calloutTime = Math.max(0, calloutTime - delta);
  $('#stumble-callout').hidden = calloutTime === 0;
  $('#run-prompt').hidden = run.time >= 2.5;
  updateHud();
  renderGame(ctx, run, {
    reducedMotion: reducedMotion.matches,
    spriteSheet: spriteReady ? spriteSheet : null,
    captureProgress: run.status === 'caught' && resultHold !== null
      ? 1 - resultHold / (reducedMotion.matches ? 0.3 : 0.8) : 0,
  });
  if (run.status !== 'running') {
    if (resultHold === null) resultHold = reducedMotion.matches ? 0.3 : 0.8;
    resultHold -= delta;
    if (resultHold <= 0) { finishRun(); return; }
  }
  raf = requestAnimationFrame(frame);
}

function startRun(handle) {
  const player = roster.find((entry) => entry.handle === handle);
  if (!player || !ctx) { showScreen('select'); return; }
  unlockAudio();
  if (!spriteRequested) {
    spriteRequested = true;
    spriteSheet.addEventListener('load', () => { spriteReady = true; }, { once: true });
    spriteSheet.src = '/assets/game/cast-sheet.webp';
  }
  cancelAnimationFrame(raf);
  run = createRun(player.handle);
  moveLog = [];
  scoreRecorded = false;
  selectedIndex = roster.indexOf(player);
  previousFrame = 0;
  accumulator = 0;
  resultHold = null;
  calloutTime = 0;
  $('#run-prompt').hidden = false;
  $('#stumble-callout').hidden = true;
  updateHud();
  showScreen('run');
  syncMusic(true);
  renderGame(ctx, run, { reducedMotion: reducedMotion.matches, spriteSheet: spriteReady ? spriteSheet : null });
  raf = requestAnimationFrame(frame);
}

function returnToSelect() {
  cancelAnimationFrame(raf);
  raf = 0;
  showScreen('select');
  syncMusic();
  setSelection(selectedIndex);
}

$('#power-button').addEventListener('click', enterLanding);
$('#boot-sound-button').addEventListener('click', () => {
  unlockAudio();
  if (muted) muted = false;
  else if (musicPlaying) muted = true;
  storage.set('thot-os-95-muted', muted ? '1' : '0');
  updateMuteButton();
  syncMusic();
  if (!muted) tone(520, 0.07);
});
$('#player-prev').addEventListener('click', () => setSelection(selectedIndex - 1, true));
$('#player-next').addEventListener('click', () => setSelection(selectedIndex + 1, true));
$('#player-list').addEventListener('click', (event) => {
  const choice = event.target.closest('[data-select-player]');
  if (!choice) return;
  const index = roster.findIndex((entry) => entry.handle === choice.dataset.selectPlayer);
  if (index < 0) return;
  if (index === selectedIndex) startRun(roster[index].handle);
  else setSelection(index, true);
});
document.addEventListener('pointerdown', (event) => {
  if (event.target.closest('#boot-sound-button')) return;
  if (muted || !['power', 'select', 'board'].includes(screen)) return;
  unlockAudio();
  syncMusic();
}, { capture: true });
document.addEventListener('keydown', () => {
  if (muted || !['power', 'select', 'board'].includes(screen)) return;
  unlockAudio();
  syncMusic();
}, { capture: true });
$('#run-screen').addEventListener('pointerdown', (event) => {
  if (screen !== 'run' || !run || event.target.closest('button, a')) return;
  event.preventDefault();
  unlockAudio();
  syncMusic();
  const bounds = canvas.getBoundingClientRect();
  recordMove(event.clientX < bounds.left + bounds.width / 2 ? -1 : 1);
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  if (screen !== 'select' && screen !== 'run') return;
  event.preventDefault();
  const direction = event.key === 'ArrowLeft' ? -1 : 1;
  if (screen === 'select') setSelection(selectedIndex + direction, true);
  else { unlockAudio(); syncMusic(); recordMove(direction); }
});
$('#retry-button').addEventListener('click', () => startRun(run.handle));
$('#caught-change-button').addEventListener('click', returnToSelect);
$('#select-board-button').addEventListener('click', () => openBoard('select'));
$('#caught-board-button').addEventListener('click', () => openBoard('caught'));
$('#board-back-button').addEventListener('click', () => { showScreen(boardReturnScreen); syncMusic(); });
$('#score-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!run || run.status !== 'caught' || scoreRecorded) return;
  const button = $('#score-form button');
  const status = $('#score-status');
  button.disabled = true;
  status.textContent = 'CHECKING RUN...';
  const submission = { name: $('#score-name').value.trim(), handle: run.handle, moves: moveLog };
  try {
    const response = await fetch('/api/leaderboard', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(submission),
    });
    if (response.ok) {
      scoreRecorded = true;
      $('#score-form').hidden = true;
      await openBoard('caught');
      return;
    }
    if (response.status === 400) {
      const data = await response.json();
      status.textContent = data.error || 'Could not record this run.';
      button.disabled = false;
      return;
    }
    // 404/405/501 are common responses from a plain static host. Other API
    // failures also fall back locally, with the board labeled accordingly.
  } catch { /* Network unavailable: use this device's board. */ }
  // A plain static host has no scoreboard API; keep an honest device-only board.
  try {
    const score = replayScore(submission);
    const entry = { ...score, id: crypto.randomUUID(), submittedAt: new Date().toISOString() };
    storage.set('over-there-local-board-v2', JSON.stringify(rankEntries([...localBoard(), entry])));
    scoreRecorded = true;
    $('#score-form').hidden = true;
    await openBoard('caught');
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});
$('#mute-button').addEventListener('click', () => {
  unlockAudio();
  muted = !muted;
  storage.set('thot-os-95-muted', muted ? '1' : '0');
  updateMuteButton();
  syncMusic();
  tone(520, 0.07);
});
document.addEventListener('visibilitychange', () => {
  previousFrame = 0;
  accumulator = 0;
  if (document.hidden) {
    cancelAnimationFrame(raf);
    raf = 0;
    stopMusicImmediately();
    audioContext?.suspend().catch(() => {});
  } else {
    if (!muted && audioUnlocked) audioContext?.resume().catch(() => {});
    syncMusic();
    if (screen === 'run' && !raf) raf = requestAnimationFrame(frame);
  }
});

document.documentElement.classList.remove('no-js');
document.querySelectorAll('[data-select-player]').forEach((button) => { button.disabled = false; });
muted = storage.get('thot-os-95-muted') === '1';
updateMuteButton();
const query = new URLSearchParams(location.search);
const requested = query.get('play')?.toLowerCase();
const replayIntro = query.get('intro') === '1';
if (requested && roster.some((entry) => entry.handle === requested)) startRun(requested);
else if (!replayIntro && (requested || storage.get('thot-os-95-booted') === '1')) {
  showScreen('select');
  syncMusic();
  setSelection(0);
} else {
  showScreen('power');
  loadLanding();
}
