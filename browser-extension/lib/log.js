// AURO-DLP — leveled logger gated by config.logLevel
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel = 'info';

export function setLogLevel(lvl) {
  if (LEVELS[lvl] !== undefined) currentLevel = lvl;
}

function emit(lvl, args) {
  if (LEVELS[lvl] < LEVELS[currentLevel]) return;
  const method = lvl === 'debug' ? 'log' : lvl;
  // eslint-disable-next-line no-console
  console[method]('[AURO-DLP]', ...args);
}

export const log = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
};
