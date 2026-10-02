// Dev-only preview boot: registers the shell component with the npm Alpine build and starts it.
// The production bundle does the same from src/js/main.js (owned by the integration).
import Alpine from '/node_modules/alpinejs/dist/module.esm.js';
import { registerOscillaUi } from '/src/js/ui/app.js';

registerOscillaUi(Alpine);
window.Alpine = Alpine;
Alpine.start();
window.__oscReady = true;
