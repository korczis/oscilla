// MIDI support state (plan issue V501; ADR 0058 and its V500 resolution note).
//
// MIDI is an optional input layer: the page detects Web MIDI and its permission at runtime and
// states exactly one of the thirteen states of the ADR's table, with the ADR's copy. Nothing
// outside the MIDI surface depends on it.
//
// What happens when:
//   at load      reads window.isSecureContext, typeof navigator.requestMIDIAccess and, only when
//                both allow MIDI, one navigator.permissions.query({ name: 'midi' }), which the
//                Permissions API defines as never prompting. It never requests access. A query
//                that has not answered within MIDI_QUERY_TIMEOUT_MS reads `unknown`.
//   connect()    the explicit user action "Connect MIDI": requestMIDIAccess({ sysex: false }).
//                A new request replaces the one before it; a request that settles after a newer
//                one started is ignored.
//
// Which cause chooses the state (the ADR's order):
//   1. the context: insecure, unsupported (Connect MIDI is not offered);
//   2. after the first Connect MIDI, the latest request and the access it gave: pending,
//      blocked, denied, failed, revoked, connected, disconnected, no-devices. The kept
//      PermissionStatus then only matters through its change event (revoked);
//   3. before the first Connect MIDI, the kept PermissionStatus's current state: unknown,
//      needs-permission, allowed, denied.
//
// The module reads only these members of the platform objects (tests/browser/midi.cjs compares
// them with the real interfaces, through tests/browser/lib/midi-stub.cjs PAGE_READS):
// access.inputs / addEventListener / removeEventListener, inputs.forEach, and port.name /
// state / type.

export const MIDI_STATES = Object.freeze([
  'insecure', 'unsupported', 'pending', 'blocked', 'denied', 'failed', 'revoked', 'connected',
  'disconnected', 'no-devices', 'unknown', 'needs-permission', 'allowed',
]);

export const MIDI_COPY = Object.freeze({
  insecure: 'MIDI is unavailable: this page is not in a secure context. Open it over https.',
  unsupported: 'MIDI is unavailable: this browser offers no Web MIDI here.',
  pending: 'Waiting for the browser\'s answer about MIDI access. The rest of OSCILLA keeps '
    + 'working.',
  blocked: 'MIDI is blocked for {site}: the browser or the site\'s settings do not let this page '
    + 'use MIDI. Some browsers allow it only after a site permission add-on is installed.',
  denied: 'MIDI access is not allowed for {site}. Allow MIDI in the browser\'s site settings, '
    + 'then choose Connect MIDI again.',
  failed: 'MIDI could not start on this computer (the browser reported {error}).',
  revoked: 'MIDI access was withdrawn for {site}. Choose Connect MIDI to ask again.',
  connected: 'MIDI is on: {names}.',
  disconnected: 'MIDI input disconnected: {name}. No MIDI input is connected.',
  'no-devices': 'MIDI is on. No MIDI input is connected; plug one in and it appears here.',
  unknown: 'MIDI is off. The browser does not say whether MIDI is allowed for {site}; Connect '
    + 'MIDI asks it.',
  'needs-permission': 'MIDI is off. Connect MIDI asks the browser for access to MIDI devices '
    + 'for {site}.',
  allowed: 'MIDI is allowed for {site}. Choose Connect MIDI to start listening.',
});

const UNNAMED = 'unnamed input';
const portName = (name) => (typeof name === 'string' && name ? name : UNNAMED);

/** `{site}` of the copy: the host over http(s), "this page" on file:// (reach not measured). */
export function midiSite(location) {
  if (!location || location.protocol === 'file:' || !location.host) return 'this page';
  return location.host;
}

/** The exact copy of `state`, its placeholders filled. */
export function midiText(state, { site = 'this page', names = [], name = '', error = '' } = {}) {
  const copy = MIDI_COPY[state];
  if (copy === undefined) throw new Error(`unknown MIDI state ${JSON.stringify(state)}`);
  const values = {
    site, names: names.map(portName).join(', '), name: portName(name), error: error || 'Error',
  };
  // One pass with a function: a value is inserted verbatim ("$&" in a device name stays "$&")
  // and is never searched for a later placeholder (a device named "{error}" stays "{error}").
  return copy.replace(/\{(site|names|name|error)\}/g, (_, key) => values[key]);
}

/** The names of the connected inputs of a MIDIAccess, in the access's order. */
function connectedNames(access) {
  const names = [];
  access.inputs.forEach((port) => {
    if (port.state === 'connected' && port.type !== 'output') names.push(portName(port.name));
  });
  return names;
}

/**
 * How long the load-time permission query may take before the page states `unknown` (and
 * offers Connect MIDI). A query that answers later still chooses the state, if Connect MIDI has
 * not been chosen by then, and its PermissionStatus is kept.
 */
export const MIDI_QUERY_TIMEOUT_MS = 2000;

const QUERY_STATES = { prompt: 'needs-permission', granted: 'allowed', denied: 'denied' };
const REJECTED = { SecurityError: 'blocked', NotAllowedError: 'denied' };

/**
 * The support state of one page. `navigator` and `isSecureContext` are the page's;
 * `onChange(snapshot)` is called after every change of the state or of the input names.
 */
export function createMidiSupport({ navigator: nav, isSecureContext, site = 'this page',
  onChange = () => {}, queryTimeoutMs = MIDI_QUERY_TIMEOUT_MS } = {}) {
  let state = null;
  let detail = {};
  let status = null;        // the kept PermissionStatus
  let asked = false;        // Connect MIDI was chosen in this page
  let request = 0;          // the latest request's number
  let live = null;          // the resolved access and what it has seen

  const available = () => isSecureContext && !!nav && typeof nav.requestMIDIAccess === 'function';

  const snapshot = () => ({
    state,
    text: state ? midiText(state, { site, ...detail }) : '',
    canConnect: available(),
    inputs: state === 'connected' ? detail.names.slice() : [],
  });

  const set = (next, d = {}) => {
    state = next;
    detail = d;
    onChange(snapshot());
  };

  const fromQuery = () => {
    if (asked) return;
    const s = status && QUERY_STATES[status.state];
    set(s || 'unknown');
  };

  const drop = () => {
    if (live) live.access.removeEventListener('statechange', live.listener);
    live = null;
  };

  // The state an open access gives (rows 8 to 10); `leaving` is the port of the statechange.
  const fromAccess = (leaving) => {
    const names = connectedNames(live.access);
    const before = live.count;
    live.count = names.length;
    if (names.length) {
      live.everConnected = true;
      set('connected', { names });
    } else if (live.everConnected) {
      // {name}: the port of the statechange that left no input connected, kept after it.
      if (before > 0) live.lastName = leaving ? leaving.name : '';
      set('disconnected', { name: live.lastName });
    } else {
      set('no-devices');
    }
  };

  const onPermissionChange = () => {
    if (!asked) { fromQuery(); return; }
    if (live && status.state !== 'granted') {
      drop();
      set('revoked');
    }
  };

  return {
    snapshot,

    /** The load-time read: context, API, then one permission query. Never a request. */
    async init() {
      if (!isSecureContext) { set('insecure'); return; }
      if (!available()) { set('unsupported'); return; }
      const perms = nav.permissions;
      if (!perms || typeof perms.query !== 'function') { fromQuery(); return; }
      let query;
      try {
        query = Promise.resolve(perms.query({ name: 'midi' }));
      } catch (error) {
        query = Promise.reject(error);
      }
      const keep = (s) => {
        status = s || null;
        if (status && typeof status.addEventListener === 'function') {
          status.addEventListener('change', onPermissionChange);
        }
      };
      let timer = null;
      const late = Symbol('late');
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(late), queryTimeoutMs);
      });
      const first = await Promise.race([query.catch(() => null), timeout]);
      clearTimeout(timer);
      if (first === late) {
        // No answer in time: unknown, Connect MIDI offered. A late answer still counts.
        fromQuery();
        query.then((s) => { if (s) { keep(s); fromQuery(); } }, () => {});
        return;
      }
      keep(first);
      fromQuery();
    },

    /** Connect MIDI: request access ({ sysex: false }); false when it is not offered. */
    connect() {
      if (!available()) return false;
      asked = true;
      drop();
      request += 1;
      const mine = request;
      set('pending');
      let pending;
      try {
        pending = Promise.resolve(nav.requestMIDIAccess({ sysex: false }));
      } catch (error) {
        pending = Promise.reject(error);
      }
      pending.then((access) => {
        if (mine !== request) return;
        const listener = (event) => {
          if (live && live.access === access) fromAccess(event && event.port);
        };
        live = { access, listener, everConnected: false, count: 0, lastName: '' };
        access.addEventListener('statechange', listener);
        fromAccess();
      }, (error) => {
        if (mine !== request) return;
        const name = (error && error.name) || '';
        const rejected = REJECTED[name];
        if (rejected) set(rejected);
        else set('failed', { error: name || 'Error' });
      });
      return true;
    },
  };
}
