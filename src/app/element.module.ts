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


import { BrowserModule } from '@angular/platform-browser';
import { NgModule, Injector, DoBootstrap } from '@angular/core';
import { CommonModule } from '@angular/common'; // Import CommonModule here for component directives
import { createCustomElement } from '@angular/elements';

// Import the component to be turned into an element
import { SuggestionBarComponent } from './suggestion-bar/suggestion-bar.component'; // Adjust path if needed

@NgModule({
  declarations: [
    SuggestionBarComponent
  ],
  imports: [
    BrowserModule,
    CommonModule
  ],
  providers: [],
})
export class ElementModule implements DoBootstrap { // Implement DoBootstrap
  constructor(private injector: Injector) {
    console.log('ElementModule: Constructor - Defining custom element...');
    // Convert the component to a custom element
    const SuggestionElement = createCustomElement(SuggestionBarComponent, { injector: this.injector });

    // Define the custom element tag
    const customElementName = 'suggestion-bar-host';
    if (customElements.get(customElementName)) {
        console.warn(`ElementModule: Custom element "${customElementName}" is already defined.`);
    } else {
        customElements.define(customElementName, SuggestionElement);
        console.log(`ElementModule: Custom element "${customElementName}" defined successfully.`);
    }
  }

  ngDoBootstrap() {
    console.log('ElementModule: ngDoBootstrap called.');
  }
}
