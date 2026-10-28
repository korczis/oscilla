// The MIDI test seam (ADR 0058, V500 note, option (a)): a test-harness substitute for the
// platform's navigator.requestMIDIAccess, installed from outside the page before any page script
// runs. It is not a window.OSCILLA member and it does not ship in dist/index.html.
//
//   const midiStub = require('./lib/midi-stub.cjs');
//   await context.addInitScript(midiStub.install, {});   // seam group: the stub
//   await context.addInitScript(midiStub.spy);           // seam group: count calls, call through
//   await page.evaluate(() => window.__oscMidiSeam.resolve(0, ['TEST STUB · MIDI input']));
//
// The page cannot tell the stub from the platform, so the stub names itself: its inputs are
// named "TEST STUB · MIDI input" (a suffix tells several apart) and their manufacturer is
// "OSCILLA test". Its marker, window.__oscMidiSeam, is what a seam check asserts and a measured
// check asserts absent. The test drives the stub, never the page:
//
//   calls()                    the options of every requestMIDIAccess call, in order
//   resolve(i, names)          resolve request i with a fake MIDIAccess holding those inputs
//   reject(i, name, message)   reject request i with a DOMException of that name
//   plug(name) / unplug(name)  an input appears / is disconnected on the latest access; a
//                              statechange with its port is dispatched on the access and port
//   message(name, bytes)       a midimessage with a Uint8Array data and a timeStamp on an input
//   port(name)                 the stub input itself (in the page), to listen on it
//
// PAGE_READS lists every member src/js/midi reads on these objects (tests/unit/midi holds the
// module to it); tests/browser/midi.cjs compares them with MIDIAccess.prototype,
// MIDIInputMap.prototype and MIDIPort.prototype in the gate builds that have them.
'use strict';

const STUB_NAME = 'TEST STUB · MIDI input';
const STUB_MANUFACTURER = 'OSCILLA test';
const PAGE_READS = Object.freeze({
  access: Object.freeze(['inputs', 'addEventListener', 'removeEventListener']),
  inputs: Object.freeze(['forEach']),
  port: Object.freeze(['name', 'state', 'type']),
});

// Runs in the page (serialised by addInitScript / evaluate): self-contained. With
// `cfg.dry`, nothing is installed; it returns how each member in `cfg.reads` is held by the
// stub's objects and by the real interfaces, for the fidelity check.
function install(cfg) {
  const config = cfg || {};
  const NAME = 'TEST STUB · MIDI input';
  const MAKER = 'OSCILLA test';

  class StubPort extends EventTarget {
    constructor(id, name, type) {
      super();
      this.id = id;
      this.name = name;
      this.manufacturer = MAKER;
      this.type = type;
      this.version = 'stub';
      this.state = 'connected';
      this.connection = 'closed';
      this.onstatechange = null;
    }

    open() { this.connection = 'open'; return Promise.resolve(this); }

    close() { this.connection = 'closed'; return Promise.resolve(this); }
  }

  class StubInput extends StubPort {
    constructor(id, name) {
      super(id, name, 'input');
      this.onmidimessage = null;
    }
  }

  class StubAccess extends EventTarget {
    constructor(names) {
      super();
      this.inputs = new Map();
      this.outputs = new Map();
      this.sysexEnabled = false;
      this.onstatechange = null;
      for (const n of names) this.add(n);
    }

    add(name) {
      const port = new StubInput(`stub-input-${this.inputs.size + 1}`, name);
      this.inputs.set(port.id, port);
      return port;
    }

    emit(port) {
      for (const target of [port, this]) {
        const ev = new Event('statechange');
        Object.defineProperty(ev, 'port', { value: port, enumerable: true });
        target.dispatchEvent(ev);
      }
    }
  }

  if (config.dry) {
    const access = new StubAccess([NAME]);
    const port = access.inputs.values().next().value;
    const kind = (proto, member) => {
      for (let p = proto; p; p = Object.getPrototypeOf(p)) {
        const d = Object.getOwnPropertyDescriptor(p, member);
        if (d) return d.get ? 'property' : typeof d.value === 'function' ? 'function' : 'property';
      }
      return 'missing';
    };
    const stubKind = (obj, member) => (!(member in obj) ? 'missing'
      : typeof obj[member] === 'function' ? 'function' : 'property');
    const real = {
      access: typeof MIDIAccess === 'function' ? MIDIAccess.prototype : null,
      inputs: typeof MIDIInputMap === 'function' ? MIDIInputMap.prototype : null,
      port: typeof MIDIInput === 'function' ? MIDIInput.prototype : null,
    };
    const objects = { access, inputs: access.inputs, port };
    const rows = [];
    for (const [group, members] of Object.entries(config.reads || {})) {
      for (const member of members) {
        rows.push({ member: `${group}.${member}`, stub: stubKind(objects[group], member),
          real: real[group] ? kind(real[group], member) : 'no interface' });
      }
    }
    return rows;
  }

  const requests = [];
  let latest = null;
  const find = (name) => {
    if (!latest) throw new Error('midi stub: no access has been resolved');
    const port = [...latest.inputs.values()].find((p) => p.name === name);
    if (!port) throw new Error(`midi stub: no input named ${name}`);
    return port;
  };
  Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function requestMIDIAccess(options) {
      return new Promise((resolve, reject) => {
        const copy = options === undefined ? null : JSON.parse(JSON.stringify(options));
        requests.push({ options: copy, resolve, reject, settled: false });
      });
    },
  });
  const settle = (i) => {
    const r = requests[i];
    if (!r) throw new Error(`midi stub: no request ${i} (${requests.length} made)`);
    if (r.settled) throw new Error(`midi stub: request ${i} is already settled`);
    r.settled = true;
    return r;
  };
  window.__oscMidiSeam = Object.freeze({
    kind: 'stub',
    name: NAME,
    manufacturer: MAKER,
    calls: () => requests.map((r) => r.options),
    resolve(i, names) {
      const access = new StubAccess(names || []);
      latest = access;
      settle(i).resolve(access);
      return true;
    },
    reject(i, name, message) {
      settle(i).reject(new DOMException(message || `${name} (stub)`, name));
      return true;
    },
    port: (name) => find(name),
    plug(name) {
      if (!latest) throw new Error('midi stub: no access has been resolved');
      latest.emit(latest.add(name));
      return true;
    },
    unplug(name) {
      const port = find(name);
      port.state = 'disconnected';
      latest.emit(port);
      return true;
    },
    message(name, bytes) {
      const port = find(name);
      const ev = new Event('midimessage');
      Object.defineProperty(ev, 'data', { value: Uint8Array.from(bytes), enumerable: true });
      Object.defineProperty(ev, 'timeStamp', { value: performance.now(), enumerable: true });
      port.dispatchEvent(ev);
      return true;
    },
  });
  return true;
}

// Runs in the page: counts requestMIDIAccess calls and MIDI permission queries and calls
// through to the platform. Where the method is absent it stays absent (the page's state is the
// platform's), and the count is of calls nobody could make.
function spy() {
  const counts = { requests: [], queries: [] };
  const native = Navigator.prototype.requestMIDIAccess;
  const present = typeof native === 'function';
  if (present) {
    Object.defineProperty(Navigator.prototype, 'requestMIDIAccess', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function requestMIDIAccess(...args) {
        counts.requests.push(args[0] === undefined ? null : JSON.parse(JSON.stringify(args[0])));
        return native.apply(this, args);
      },
    });
  }
  if (typeof Permissions === 'function' && typeof Permissions.prototype.query === 'function') {
    const query = Permissions.prototype.query;
    Permissions.prototype.query = function spiedQuery(descriptor, ...rest) {
      counts.queries.push(descriptor && descriptor.name);
      return query.call(this, descriptor, ...rest);
    };
  }
  window.__oscMidiSeam = Object.freeze({
    kind: 'spy',
    present,
    counts: () => JSON.parse(JSON.stringify(counts)),
  });
}

module.exports = { install, spy, STUB_NAME, STUB_MANUFACTURER, PAGE_READS };
