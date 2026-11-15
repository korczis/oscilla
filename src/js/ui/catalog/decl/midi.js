// Declarations: the MIDI section of the Settings dialog (src/index.html; its controller
// midi/ui.js, the support state of midi/support.js, the device profiles of midi/devices.js and
// the monitor of midi/monitor.js, V501 and V507). The section owns no stored value: the support
// state is read from the browser, the devices from the connected inputs, the monitor's rows from
// the messages they send, and nothing of it outlives the page.
// Trace: scripts/ui-catalog/trace/midi.mjs.

import { defineComponent } from '../define.js';

export default [
  defineComponent({
    id: 'midi.status',
    kind: 'readout',
    label: 'Stav MIDI',
    docs: 'Říká, zda je MIDI v prohlížeči k dispozici, povolené a připojené, i s názvy vstupů.',
    state: { none: 'jen hlásí stav podpory MIDI v prohlížeči a nic nemění' },
  }),
  defineComponent({
    id: 'midi.actions',
    kind: 'panel',
    label: 'Akce MIDI',
    docs: 'Drží ovládání pro připojení MIDI, ukázané jen tam, kde prohlížeč Web MIDI nabízí.',
    state: { none: 'řádek drží ovládání a žádnou hodnotu nevlastní' },
  }),
  defineComponent({
    id: 'midi.connect',
    kind: 'action',
    label: 'Připojit MIDI',
    docs: 'Požádá prohlížeč o přístup ke vstupům MIDI; je to jediná výslovná žádost.',
    state: { none: 'přístup patří prohlížeči a žádá se na každé stránce znovu' },
    effect: { command: 'požádat prohlížeč o přístup k MIDI (bez SysEx)' },
  }),
  defineComponent({
    id: 'midi.devices',
    kind: 'readout',
    label: 'Zařízení',
    docs: 'Vypíše každý připojený vstup, známé zařízení, ke kterému patří, a k čemu jeho port slouží.',
    state: { none: 'jen vypisuje připojené vstupy a nic nemění' },
  }),
  defineComponent({
    id: 'midi.monitor',
    kind: 'readout',
    label: 'Monitor MIDI',
    docs: 'Ukazuje poslední zprávy všech vstupů, nejnovější nahoře, s ovladačem, který každou poslal.',
    state: { none: 'ukazuje, co vstupy posílají, a nic neuchová déle než stránka' },
  }),
  defineComponent({
    id: 'midi.clock',
    kind: 'readout',
    label: 'Hodiny MIDI',
    docs: 'Ukazuje tempo hodin MIDI, které vstup posílá, změřené z posledního celého taktu.',
    state: { none: 'jen měří příchozí hodiny a tempo transportu nemění' },
  }),
  defineComponent({
    id: 'midi.response',
    kind: 'switch',
    label: 'Otázka a odpověď',
    docs: 'Zapne režim otázky a odpovědi: po frázi hráče zahraje OSCILLA odpověď o kvintu výš na '
      + 'tomtéž nástroji; další nota hráče ji utne. Při každém načtení vypnuto.',
    state: 'ui.midiResponse',
  }),
  defineComponent({
    id: 'midi.monitor-clear',
    kind: 'action',
    label: 'Vymazat',
    docs: 'Vyprázdní monitor MIDI; zprávy, které přijdou potom, se ukazují znovu.',
    state: { none: 'vyprázdní monitor, který žije jen se stránkou' },
    effect: { command: 'vyprázdnit řádky monitoru MIDI' },
  }),
];
