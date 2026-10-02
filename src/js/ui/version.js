// The product version shown in the UI, in exported configs and on window.OSCILLA. It is not
// written here: package.json "version" is the only authority, projected at build time into
// core/build-info.js (metadata region + esbuild define).
//
// core/constants.js APP_VERSION is a different thing: the frozen legacy V1 stamp ('1.0.0')
// pinned by the V1 freeze vectors. It is never shown or exported as the product version.
import { BUILD } from '../core/build-info.js';

export const OSCILLA_VERSION = BUILD.version;
