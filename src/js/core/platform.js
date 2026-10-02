// Browser and platform names for the Device & Limits panel. Never fabricates the output device:
// anything the browser does not report reads "Not identified" / "Not reported".
// Extracted from V1 (index.html@a7b7a23, section 2). `navigator` is injectable for tests; the
// default is the global navigator.

const nav = (n) => n || (typeof navigator !== 'undefined' ? navigator : {});

/** V1: browserName (index.html@a7b7a23) */
export function browserName(navigatorLike) {
  const navigator = nav(navigatorLike);
  const ua = navigator.userAgent || '';
  const tests = [
    ['Edge', /Edg\/(\d+)/], ['Opera', /OPR\/(\d+)/], ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/], ['Safari', /Version\/(\d+)[\d.]*.*Safari/],
  ];
  for (const [name, re] of tests) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1]}`;
  }
  return 'Not identified';
}

/** V1: platformName (index.html@a7b7a23) */
export function platformName(navigatorLike) {
  const navigator = nav(navigatorLike);
  try {
    return navigator.userAgentData?.platform || navigator.platform || 'Not reported';
  } catch (e) {
    return 'Not reported';
  }
}
