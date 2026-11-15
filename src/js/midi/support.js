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
// state / type / addEventListener / removeEventListener / open.
//
// Messages (V502): each connected input of the open access is listened to for `midimessage`,
// and `onMessage(data, port, timeStamp)` receives its bytes and the message's time. `onSilence()` is called when an input that was
// listened to leaves, and when the access is withdrawn or replaced by a new Connect MIDI; it
// names no port, and the note layer stops every note, not only the leaving input's
// (src/js/midi/notes.js).

export const MIDI_STATES = Object.freeze([
  'insecure', 'unsupported', 'pending', 'blocked', 'denied', 'failed', 'revoked', 'connected',
  'disconnected', 'no-devices', 'unknown', 'needs-permission', 'allowed',
]);

export const MIDI_COPY = Object.freeze({
  insecure: 'MIDI není k dispozici: tato stránka neběží v zabezpečeném kontextu. Otevřete ji '
    + 'přes https.',
  unsupported: 'MIDI není k dispozici: tento prohlížeč tu Web MIDI nenabízí.',
  pending: 'Čeká se na odpověď prohlížeče o přístupu k MIDI. Zbytek aplikace OSCILLA funguje '
    + 'dál.',
  blocked: 'MIDI je pro {site} blokované: prohlížeč nebo nastavení webu této stránce MIDI '
    + 'nedovolí. Některé prohlížeče ho povolí až po instalaci doplňku s oprávněním pro web.',
  denied: 'Přístup k MIDI není pro {site} povolený. Povolte MIDI v nastavení webu v prohlížeči '
    + 'a pak znovu zvolte „Připojit MIDI“.',
  failed: 'MIDI se na tomto počítači nepodařilo spustit (prohlížeč ohlásil {error}).',
  revoked: 'Přístup k MIDI byl pro {site} odebrán. Zvolte „Připojit MIDI“ a požádejte o něj '
    + 'znovu.',
  connected: 'MIDI je zapnuté: {names}.',
  disconnected: 'Vstup MIDI odpojen: {name}. Není připojený žádný vstup MIDI.',
  'no-devices': 'MIDI je zapnuté. Není připojený žádný vstup MIDI; připojte ho a objeví se tady.',
  unknown: 'MIDI je vypnuté. Prohlížeč neříká, zda je MIDI pro {site} povolené; „Připojit MIDI“ '
    + 'se ho zeptá.',
  'needs-permission': 'MIDI je vypnuté. „Připojit MIDI“ požádá prohlížeč o přístup k zařízením '
    + 'MIDI pro {site}.',
  allowed: 'MIDI je pro {site} povolené. Zvolte „Připojit MIDI“ a OSCILLA začne poslouchat.',
});

const UNNAMED = 'nepojmenovaný vstup';
/** `{site}` on file://: the copy claims no reach (which origin keys a file was not measured). */
const FILE_SITE = 'tuto stránku';
const portName = (name) => (typeof name === 'string' && name ? name : UNNAMED);

/** `{site}` of the copy: the host over http(s), FILE_SITE on file:// (reach not measured). */
export function midiSite(location) {
  if (!location || location.protocol === 'file:' || !location.host) return FILE_SITE;
  return location.host;
}

/** The exact copy of `state`, its placeholders filled. */
export function midiText(state, { site = FILE_SITE, names = [], name = '', error = '' } = {}) {
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
export function createMidiSupport({ navigator: nav, isSecureContext, site = FILE_SITE,
  onChange = () => {}, onMessage = () => {}, onSilence = () => {},
  queryTimeoutMs = MIDI_QUERY_TIMEOUT_MS } = {}) {
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

  // The midimessage listeners of the open access: one per connected input, removed when the
  // input leaves (then onSilence) or the access is dropped.
  const listen = () => {
    const connected = new Set();
    live.access.inputs.forEach((port) => {
      if (port.state !== 'connected' || port.type === 'output') return;
      connected.add(port);
      if (live.heard.has(port)) return;
      // The message's own time (DOMHighResTimeStamp), which the clock's tempo is measured on
      // (V508): the handler runs later than the message arrived, by however busy the page is.
      const fn = (event) => {
        if (event && event.data) onMessage(event.data, port, event.timeStamp);
      };
      live.heard.set(port, fn);
      port.addEventListener('midimessage', fn);
      // Opened explicitly: an added listener is not relied on to open the port implicitly.
      try {
        if (typeof port.open === 'function') Promise.resolve(port.open()).catch(() => {});
      } catch (error) { /* the port stays as it is; its messages, if any, still arrive */ }
    });
    let lost = false;
    for (const [port, fn] of live.heard) {
      if (connected.has(port)) continue;
      port.removeEventListener('midimessage', fn);
      live.heard.delete(port);
      lost = true;
    }
    if (lost) onSilence();
  };

  const drop = () => {
    if (!live) return;
    live.access.removeEventListener('statechange', live.listener);
    for (const [port, fn] of live.heard) port.removeEventListener('midimessage', fn);
    const heard = live.heard.size;
    live = null;
    if (heard) onSilence();
  };

  // The state an open access gives (rows 8 to 10); `leaving` is the port of the statechange.
  const fromAccess = (leaving) => {
    const names = connectedNames(live.access);
    const before = live.count;
    live.count = names.length;
    listen();
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
        live = { access, listener, everConnected: false, count: 0, lastName: '',
          heard: new Map() };
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
