/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// --- Polyfill for Custom Elements ---
// Keep this import if needed for browser compatibility
import '@webcomponents/custom-elements/custom-elements.min.js';
// ---

// Import the platform browser dynamic for bootstrapping NgModules
import {platformBrowserDynamic} from '@angular/platform-browser-dynamic';
// Import the ElementModule you created
import {ElementModule} from './app/element.module';

// --- Flag to prevent multiple definition attempts in the same context ---
const definitionGuardFlag = '__suggestionBarElementDefined';

if ((window as any)[definitionGuardFlag]) {
  console.log('main.ts: SuggestionBar element definition already attempted in this context.');
} else {
  // Set flag immediately
  (window as any)[definitionGuardFlag] = true;
  console.log('main.ts: Running element definition logic via ElementModule bootstrap...');

  // Bootstrap the ElementModule.
  // The element definition (createCustomElement, customElements.define)
  // happens inside ElementModule's constructor.
  // This platform bootstrap typically provides a more complete injector context.
  platformBrowserDynamic().bootstrapModule(ElementModule, {
    // Optionally configure ngZone ('noop' can sometimes help in extensions if zone causes issues)
    // ngZone: 'noop'
  })
    .then(() => console.log('main.ts: ElementModule bootstrapped successfully (element defined).'))
    .catch(err => {
      console.error('main.ts: Error bootstrapping ElementModule:', err);
      // Reset flag on failure so subsequent attempts might retry (optional)
      (window as any)[definitionGuardFlag] = false;
    });
}
