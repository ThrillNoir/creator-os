// Deterministic, renderer-independent rules for an endless alley run.
const START_SPEED = 9;
const PASSIVE_GAP_DRAIN = 0.4; // Percentage points per second.
const STUMBLE_PENALTY = 24;
const CONTROL_LOCK = 0.35;
const COLLISION_EPSILON = 1e-7;
const LOOK_AHEAD = 72;
const KEEP_BEHIND = 60;
const TYPES = ['bin-bag', 'box', 'wheelie-bin', 'crate-stack', 'pallet'];
const ENERGY_RESTORE = 15;

function hashHandle(handle) {
  let hash = 2166136261;
  for (let i = 0; i < handle.length; i += 1) {
    hash ^= handle.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFrom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function waveSpacing(wave) {
  return Math.max(10, 16 - Math.max(0, wave) * 0.075);
}

function fillCourse(state) {
  // Each wave has its own seed, so pruning old objects never changes later waves.
  while (state.nextWaveDistance <= state.distance + LOOK_AHEAD) {
    const wave = state.nextWave;
    const random = randomFrom(hashHandle('over-there') ^ Math.imul(wave + 1, 0x9E3779B9));
    const firstLane = Math.floor(random() * 3);
    const blockedLanes = [firstLane];
    const doubleChance = Math.min(0.82, 0.15 + (wave - 4) * 0.008);
    if (wave >= 4 && random() < doubleChance) {
      blockedLanes.push((firstLane + 1 + Math.floor(random() * 2)) % 3);
    }
    const type = TYPES[Math.floor(random() * TYPES.length)];
    for (const lane of blockedLanes) {
      state.obstacles.push({ id: `${wave}-${lane}`, lane, distance: state.nextWaveDistance, type, hit: false });
    }
    // Pickups sit between obstacle waves and never share a collision point.
    // The rare bag first appears within a reachable early run, then only once
    // every 48 waves; the can appears eight times as often.
    const pickupType = wave >= 16 && wave % 48 === 16 ? 'powder'
      : wave >= 2 && wave % 6 === 2 ? 'red-bull' : null;
    if (pickupType) {
      state.pickups.push({
        id: `pickup-${wave}`, type: pickupType, lane: Math.floor(random() * 3),
        distance: state.nextWaveDistance + waveSpacing(wave) * .45, passed: false, collected: false,
      });
    }
    state.nextWave += 1;
    state.nextWaveDistance += waveSpacing(wave);
  }
  state.obstacles = state.obstacles.filter((obstacle) => obstacle.distance >= state.distance - KEEP_BEHIND);
  state.pickups = state.pickups.filter((pickup) => pickup.distance >= state.distance - KEEP_BEHIND);
}

/** Create a fresh run. Lane 1 is the centered starting lane. */
export function createRun(handle) {
  const state = {
    handle: String(handle ?? '').trim().toLowerCase(), lane: 1, distance: 0,
    gap: 100, status: 'running', obstacles: [], pickups: [], nextWave: 0, nextWaveDistance: 20,
    stumbles: 0, moves: 0, time: 0, stumbleTime: 0, lastEvent: null,
  };
  fillCourse(state);
  return state;
}

/** Move exactly one lane. Direction accepts -1/'left' or 1/'right'. */
export function move(state, direction) {
  if (!state || state.status !== 'running' || state.stumbleTime > 0) return state;
  const delta = direction === 'left' || direction === -1 ? -1
    : direction === 'right' || direction === 1 ? 1 : 0;
  if (delta) {
    const nextLane = Math.max(0, Math.min(2, state.lane + delta));
    if (nextLane !== state.lane) state.moves += 1;
    state.lane = nextLane;
  }
  return state;
}

/** Obstacles enter faster throughout the run; there is no finish distance. */
export function speedAtTime(time) {
  const elapsed = Math.max(0, Number.isFinite(time) ? time : 0);
  return START_SPEED + 2.8 * Math.log1p(elapsed / 15) + elapsed / 300;
}

/** Advance by dt seconds. Caller should use a fixed step; large/invalid values are bounded. */
export function advanceRun(state, dt) {
  if (!state || state.status !== 'running' || !Number.isFinite(dt) || dt <= 0) return state;
  let remaining = Math.min(dt, 0.25);
  state.lastEvent = null;

  while (remaining > 0 && state.status === 'running') {
    const step = Math.min(remaining, 1 / 60);
    const start = state.distance;
    const end = start + speedAtTime(state.time) * step;
    state.distance = end;
    state.time += step;
    // Time alone never catches the runner. Only a stumble can close the gap.
    state.gap = Math.max(1, state.gap - PASSIVE_GAP_DRAIN * step);
    state.stumbleTime = Math.max(0, state.stumbleTime - step);
    fillCourse(state);

    for (const obstacle of state.obstacles) {
      if (!obstacle.hit && obstacle.distance > start + COLLISION_EPSILON && obstacle.distance <= end + COLLISION_EPSILON) {
        obstacle.hit = true;
        if (obstacle.lane === state.lane) {
          state.stumbles += 1;
          state.gap = Math.max(0, state.gap - STUMBLE_PENALTY);
          state.stumbleTime = CONTROL_LOCK;
          state.lastEvent = { type: 'stumble', obstacleId: obstacle.id, gap: state.gap };
          if (state.gap <= 0) {
            state.status = 'caught';
            state.lastEvent.type = 'caught';
          }
          break;
        }
      }
    }
    if (state.status === 'running') {
      for (const pickup of state.pickups) {
        if (!pickup.passed && pickup.distance > start + COLLISION_EPSILON &&
          pickup.distance <= end + COLLISION_EPSILON) {
          pickup.passed = true;
          if (pickup.lane === state.lane) {
            pickup.collected = true;
            const previousGap = state.gap;
            state.gap = pickup.type === 'powder' ? 100 : Math.min(100, state.gap + ENERGY_RESTORE);
            state.lastEvent = {
              type: 'boost', item: pickup.type, restored: state.gap - previousGap, gap: state.gap,
            };
          }
        }
      }
    }
    remaining -= step;
  }
  return state;
}
