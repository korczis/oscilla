// The number formats the /lab/ pages share between the generator (scripts/landing/charts.mjs,
// page.mjs) and the page's own script (client.js, bundled by scripts/landing.mjs): one Czech
// grouping, so a count the script writes after a filter reads like the count the page was
// generated with (review r517b P3-5). No Node module is imported here; the browser bundle
// takes this file as it is.

/** 12345 -> '12 345' (Czech grouping, a no-break space). */
export function fmtInt(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** The live count a filter writes: 'Zobrazeno 1 234 z 2 345 <noun>'. */
export function shownText(shown, total, noun) {
  return `Zobrazeno ${fmtInt(shown)} z ${fmtInt(total)} ${noun}`;
}
