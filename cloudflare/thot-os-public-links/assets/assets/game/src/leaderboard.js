import { advanceRun, createRun, move } from './simulation.js';

export const LEADERBOARD_LIMIT = 10;
const MAX_TICKS = 60 * 60 * 60; // Replay guard for the local preview API.
export const LEADERBOARD_HANDLES = [
  'adelaide', 'sophia', 'sass', 'bambi', 'mrbryshanagy', 'mrsbryshanagy',
];

export function rankEntries(entries) {
  return [...entries].sort((a, b) =>
    b.ticks - a.ticks || b.distance - a.distance ||
    a.submittedAt.localeCompare(b.submittedAt)
  ).slice(0, LEADERBOARD_LIMIT);
}

/** Replays recorded lane changes so the server calculates the score itself. */
export function replayScore(submission) {
  if (!submission || typeof submission !== 'object') throw new Error('Invalid run.');
  const name = String(submission.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 20 || !/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u.test(name)) {
    throw new Error('Enter a name between 2 and 20 characters.');
  }
  if (!LEADERBOARD_HANDLES.includes(submission.handle)) throw new Error('Unknown player.');
  if (!Array.isArray(submission.moves) || submission.moves.length > 5000) throw new Error('Invalid moves.');

  let lastTick = -1;
  for (const input of submission.moves) {
    if (!input || !Number.isInteger(input.tick) || input.tick < 0 || input.tick > MAX_TICKS ||
      (input.direction !== -1 && input.direction !== 1) || input.tick < lastTick) {
      throw new Error('Invalid moves.');
    }
    lastTick = input.tick;
  }

  const run = createRun(submission.handle);
  let inputIndex = 0;
  for (let tick = 0; tick <= MAX_TICKS && run.status === 'running'; tick += 1) {
    while (submission.moves[inputIndex]?.tick === tick) {
      move(run, submission.moves[inputIndex].direction);
      inputIndex += 1;
    }
    advanceRun(run, 1 / 60);
  }
  if (run.status !== 'caught' || inputIndex !== submission.moves.length) {
    throw new Error('Only caught runs can join the leaderboard.');
  }
  return {
    name,
    handle: run.handle,
    ticks: Math.round(run.time * 60),
    time: Math.round(run.time * 10) / 10,
    distance: Math.floor(run.distance),
    stumbles: run.stumbles,
    moves: run.moves,
  };
}
