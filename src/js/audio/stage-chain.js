// A chain of insert stages for a graph that plays outside the engine's voices (C003: the V2
// pattern sequencer):
//
//   input Gain -> stage[0] -> ... -> stage[n-1] -> destination
//
//   buildStageChain(ctx, factories, destination, { track, source }) -> { input, stages, dispose() }
//
// factories are the insert factories engine.play takes as o.inserts,
// (ctx, track, source) => { input, output, update?, dispose() }, e.g. labs.filter.createInsert
// or audio/filters.js createFilterStage. The chain's input gain and every node a stage builds go
// through track/source (default: the identity). dispose() disposes every stage and disconnects
// the input; it is idempotent. A factory that throws disposes what was already built.
//
// One builder serves the realtime engine (AudioEngine.stageChain, counted in its census) and the
// offline sequence render (sequencer/compiler.js renderSequenceOffline, the WAV export), so the
// file is shaped by the same chain the sequence plays through.

const identity = (n) => n;

export function buildStageChain(ctx, factories = [], destination, opts = {}) {
  const track = typeof opts.track === 'function' ? opts.track : identity;
  const source = typeof opts.source === 'function' ? opts.source : track;
  const stages = [];
  let input = null;
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const stage of stages) {
      try {
        stage.dispose();
      } catch (e) {
        /* already disposed */
      }
    }
    stages.length = 0;
    if (input) {
      try {
        input.disconnect();
      } catch (e) {
        /* already disconnected */
      }
    }
  }

  try {
    input = track(ctx.createGain());
    let last = input;
    for (const make of factories || []) {
      if (typeof make !== 'function') continue;
      const stage = make(ctx, track, source);
      if (!stage) continue;
      stages.push(stage);
      last.connect(stage.input);
      last = stage.output;
    }
    last.connect(destination);
  } catch (e) {
    dispose();
    throw e;
  }

  return {
    input,
    stages,
    dispose,
    get disposed() {
      return disposed;
    },
  };
}
