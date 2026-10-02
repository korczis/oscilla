// The V2 release version shown in the UI, in exported configs and on window.OSCILLA.
//
// core/constants.js APP_VERSION stays '1.0.0': the V1 freeze vectors (presets.data) pin it, and
// it is the version stamped into V1-schema data. V2 does not edit the frozen constant; it
// carries its own version here, so the freeze keeps passing byte-for-byte.
export const OSCILLA_VERSION = '2.0.0';
