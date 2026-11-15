// The tempo control follows the model (K017 criterion 3; G1 coherence contract 2.4, persist-5).
// After a load or an import the <select> shows model.tempoBpm, also a tempo that is not one of
// its offered steps: that tempo gets one added option (data-osc-dynamic), which goes again when
// the model returns to an offered step. Pure apart from the select and the document it is given,
// so tests/unit/sequencer-chrome.test.mjs runs it on a fake select.
//
//   syncTempoSelect(select, tempoBpm, doc) -> select   sequencer-panel.js runs it on render

export function syncTempoSelect(select, tempoBpm, doc) {
  if (!select) return select;
  const v = String(tempoBpm);
  if (select.value === v) return select;
  const dyn = select.querySelector('option[data-osc-dynamic]');
  let i = Array.from(select.options).findIndex((o) => o.value === v && o !== dyn);
  if (i < 0) {
    if (dyn) dyn.remove();
    const opt = doc.createElement('option');
    opt.value = v;
    opt.textContent = `${v} BPM`;
    opt.dataset.oscDynamic = '1';
    select.appendChild(opt);
    i = select.options.length - 1;
  } else if (dyn) {
    dyn.remove();
    i = Array.from(select.options).findIndex((o) => o.value === v);
  }
  select.selectedIndex = i;
  return select;
}
