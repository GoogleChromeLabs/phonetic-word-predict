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

// ==========================================================================
// Angular Suggestion Bar Component (suggestion-bar.component.ts - NgModule-based + Features)
//    - NgModule-based component with drag and dismiss functionality.
//    - Correct host element reference for Angular Elements context.
// ==========================================================================

import { Component, ElementRef, OnDestroy, OnInit, ChangeDetectorRef, ChangeDetectionStrategy, NgZone } from '@angular/core';

@Component({
  selector: 'app-suggestion-bar',
  standalone:false,
  templateUrl: './suggestion-bar.component.html',
  styleUrls: ['./suggestion-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SuggestionBarComponent implements OnInit, OnDestroy {

  suggestions: string[] = [];
  isLoading: boolean = true; // Start in loading state

  // --- Draggable State ---
  isDragging: boolean = false;
  private offsetX: number = 0;
  private offsetY: number = 0;
  private boundOnDragging: (event: MouseEvent) => void;
  private boundOnDragEnd: (event: MouseEvent) => void;
  // ---

  private observer: MutationObserver | null = null;
  private hostElement: HTMLElement; // This is the custom element itself

  constructor(
      // For Angular Elements, ElementRef refers to the instance of the custom element tag
      private elementRef: ElementRef<HTMLElement>,
      private cdRef: ChangeDetectorRef,
      private ngZone: NgZone
    ) {
      // Assign the custom element itself as the hostElement to observe/interact with
      this.hostElement = this.elementRef.nativeElement;
      console.log("SuggestionBarComponent: Constructor - Host element assigned:", this.hostElement?.tagName);
      // Bind methods correctly for event listeners
      this.boundOnDragging = this.onDragging.bind(this);
      this.boundOnDragEnd = this.onDragEnd.bind(this);
    }

  ngOnInit(): void {
    // Host element should be set in the constructor.
    if (this.hostElement) {
        console.log("SuggestionBarComponent: ngOnInit - Host element reference:", this.hostElement.tagName);
        // Use MutationObserver to react to attribute changes set by the content script
        this.observer = new MutationObserver(mutations => {
            this.ngZone.run(() => { // Run inside zone for change detection
                let stateChanged = false;
                let suggestionsChanged = false;
                mutations.forEach(mutation => {
                    // Check for loading state changes
                    if (mutation.type === 'attributes' && mutation.attributeName === 'data-loading-state') {
                         console.log("SuggestionBarComponent: Detected data-loading-state attribute change.");
                         this.updateLoadingState();
                         stateChanged = true;
                    }
                    // Check for suggestion changes
                    if (mutation.type === 'attributes' && mutation.attributeName === 'data-suggestions') {
                        console.log("SuggestionBarComponent: Detected data-suggestions attribute change.");
                        this.updateSuggestions();
                        suggestionsChanged = true;
                    }
                });
                 // Trigger change detection if either state changed
                 if (stateChanged || suggestionsChanged) {
                    // No need to call markForCheck here again,
                    // as updateLoadingState and updateSuggestions already call it.
                 }
            });
        });

        // Observe attributes needed
        this.observer.observe(this.hostElement, {
            attributes: true,
            attributeFilter: ['data-suggestions', 'data-loading-state'] // Observe both attributes
        });
        console.log("SuggestionBarComponent: MutationObserver attached to host element:", this.hostElement.tagName);

        // Perform initial checks for state and suggestions
        this.updateLoadingState();
        this.updateSuggestions();

        // Ensure host is positioned absolutely (set by content script initially)
        // Checking position just in case, though content script should handle it.
        if (getComputedStyle(this.hostElement).position === 'static') {
             console.warn("SuggestionBarComponent: Host element position was static, setting to relative for dragging.");
             // Setting to relative might be safer if content script manages absolute positioning
             this.hostElement.style.position = 'relative';
        }
         this.hostElement.style.cursor = 'default'; // Default cursor for the element

    } else {
         console.error("SuggestionBarComponent: Host element reference was not set in constructor.");
    }
  }

  // Helper function to read loading state attribute
  private updateLoadingState(): void {
      const loadingState = this.hostElement.getAttribute('data-loading-state');
      const newLoadingValue = (loadingState !== 'ready'); // Treat null, 'loading', 'error' as loading
      console.log(`SuggestionBarComponent: Reading data-loading-state attribute. Value: "${loadingState}". Setting isLoading to: ${newLoadingValue}`);
      if (this.isLoading !== newLoadingValue) {
          this.isLoading = newLoadingValue;
          this.cdRef.markForCheck(); // Trigger change detection
      }
  }

  // Helper function to read suggestions attribute
  private updateSuggestions(): void {
    const suggestionsAttr = this.hostElement.getAttribute('data-suggestions');
    console.log(`SuggestionBarComponent: Reading data-suggestions attribute. Value: "${suggestionsAttr}"`);
    try {
        const newSuggestions = suggestionsAttr ? JSON.parse(suggestionsAttr) : [];
        if (JSON.stringify(newSuggestions) !== JSON.stringify(this.suggestions)) {
            this.suggestions = newSuggestions;
            this.cdRef.markForCheck(); // Trigger change detection
            console.log('SuggestionBarComponent: Updated suggestions state:', this.suggestions);
        } else {
             console.log('SuggestionBarComponent: Suggestions attribute parsed, but data is unchanged.');
        }
    } catch (e) {
        console.error('SuggestionBarComponent: Failed to parse suggestions attribute:', e);
        if (this.suggestions.length > 0) {
             this.suggestions = []; // Clear suggestions on error
             this.cdRef.markForCheck();
        }
    }
  }

  ngOnDestroy(): void {
    if (this.observer) {
        this.observer.disconnect();
        console.log("SuggestionBarComponent: MutationObserver disconnected.");
    }
    // Clean up drag listeners if component is destroyed while dragging
    if (this.isDragging) {
         document.removeEventListener('mousemove', this.boundOnDragging, true);
         document.removeEventListener('mouseup', this.boundOnDragEnd, true);
         console.log("SuggestionBarComponent: Cleaned up drag listeners on destroy.");
    }
  }

  // --- Dismiss Logic ---
  dismiss(): void {
    console.log('SuggestionBarComponent: Dismiss requested.');
    // Dispatch a specific event for dismissal
    this.hostElement.dispatchEvent(new CustomEvent('dismissRequestEvent', {
        bubbles: true,
        composed: true
    }));
     console.log('SuggestionBarComponent: Dispatched dismissRequestEvent on host.');
     // Content script should listen for this and call hideSuggestionHost()
  }

  // --- Drag Logic ---
  onDragStart(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    // Ensure drag doesn't start if clicking the dismiss button directly
    // or one of the actual suggestion items (propagation stopped in template)
    if (target.classList.contains('dismiss-button') || target.classList.contains('suggestion-item')) {
        console.log("SuggestionBarComponent: Drag prevented on button or item.");
        return;
    }

    console.log("SuggestionBarComponent: Drag start.");
    this.isDragging = true;
    const rect = this.hostElement.getBoundingClientRect();
    // Calculate offset relative to the viewport
    this.offsetX = event.clientX - rect.left;
    this.offsetY = event.clientY - rect.top;
    // Ensure position is absolute or fixed to allow top/left changes
    const currentPosition = getComputedStyle(this.hostElement).position;
     if (currentPosition === 'static' || currentPosition === 'relative') {
          console.warn(`SuggestionBarComponent: Host position is ${currentPosition}. Changing to absolute for dragging.`);
          this.hostElement.style.position = 'absolute';
          // Recalculate offsets if position changed? Maybe not needed if using pageX/Y
     }

    this.hostElement.classList.add('dragging');
    event.preventDefault();
    event.stopPropagation(); // Prevent event bubbling

    document.addEventListener('mousemove', this.boundOnDragging, true);
    document.addEventListener('mouseup', this.boundOnDragEnd, true);
  }

  private onDragging(event: MouseEvent): void {
    if (!this.isDragging) return;
    event.preventDefault();
    // Use pageX/pageY which are relative to the document, works better with scrolling
    const newLeft = event.pageX - this.offsetX;
    const newTop = event.pageY - this.offsetY;
    // Run outside Angular zone to prevent excessive change detection cycles during drag
    this.ngZone.runOutsideAngular(() => {
        // Update style directly. Content script positioning logic will respect data-dragged.
        this.hostElement.style.left = `${newLeft}px`;
        this.hostElement.style.top = `${newTop}px`;
        // Clear bottom/right if setting top/left to avoid conflicts
        this.hostElement.style.bottom = 'auto';
        this.hostElement.style.right = 'auto';
    });
  }

  private onDragEnd(event: MouseEvent): void {
    if (!this.isDragging) return;
    event.preventDefault();
    event.stopPropagation(); // Prevent event bubbling

    console.log("SuggestionBarComponent: Drag end.");
    this.isDragging = false;
    this.hostElement.classList.remove('dragging');
    // IMPORTANT: Remove the global listeners
    document.removeEventListener('mousemove', this.boundOnDragging, true);
    document.removeEventListener('mouseup', this.boundOnDragEnd, true);

    // Set attribute to indicate element has been dragged
    this.hostElement.setAttribute('data-dragged', 'true');
    console.log("SuggestionBarComponent: Set data-dragged attribute.");
  }
  // --- End Drag Logic ---


  selectWord(word: string): void {
    console.log('SuggestionBarComponent: Word selected:', word);
    this.hostElement.dispatchEvent(new CustomEvent('wordSelectedEvent', {
        detail: word,
        bubbles: true,
        composed: true
    }));
     console.log('SuggestionBarComponent: Dispatched wordSelectedEvent on host.');
  }

  // Helper for template's @for trackBy
  trackByIndex(index: number, item: string): number {
    return index;
  }
}
