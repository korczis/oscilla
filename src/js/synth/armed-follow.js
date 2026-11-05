// The Synth's Arm button reads the transport's own armed flag, never a copy kept by the panel
// (oscilla-21's review of src/js/synth, S1): a Stop or a disarm made outside the Synth (Studio
// Stop, a measurement taking the output, an abort) emits the transport's 'state', and the
// button follows it at once.
//
//   createArmedFollow(getTransport, getCmp) -> { syncArmed(), follow(transport) -> transport }
//     follow subscribes once per transport instance; syncArmed copies transport.armed into
//     cmp.synth.armed.

export function createArmedFollow(getTransport, getCmp) {
  let followed = null;
  const syncArmed = () => {
    const t = getTransport();
    const cmp = getCmp();
    if (cmp) cmp.synth.armed = !!(t && t.armed);
  };
  const follow = (t) => {
    if (t && t !== followed && typeof t.on === 'function') {
      followed = t;
      t.on((type) => { if (type === 'state' || type === 'ended') syncArmed(); });
    }
    return t;
  };
  return { syncArmed, follow };
}
