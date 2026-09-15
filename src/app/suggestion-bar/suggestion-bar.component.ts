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

import {Component, ElementRef, ViewEncapsulation, OnDestroy, OnInit, ChangeDetectorRef, ChangeDetectionStrategy, NgZone, ViewChild} from '@angular/core';

@Component({
  selector: 'app-suggestion-bar',
  standalone: false,
  templateUrl: './suggestion-bar.component.html',
  styleUrls: ['./suggestion-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuggestionBarComponent implements OnInit, OnDestroy {
  chrome: any = (window as any).chrome;

  suggestions: string[] = [];
  isLoading: boolean = true;
  isInputVisible: boolean = false;

  @ViewChild('manualInput') manualInput!: ElementRef<HTMLInputElement>;

  // --- Draggable State ---
  isDragging: boolean = false;
  private offsetX: number = 0;
  private offsetY: number = 0;
  private boundOnDragging: (event: MouseEvent) => void;
  private boundOnDragEnd: (event: MouseEvent) => void;
  // ---

  private observer: MutationObserver | null = null;
  private hostElement: HTMLElement;

  constructor(
      private elementRef: ElementRef<HTMLElement>,
      private cdRef: ChangeDetectorRef,
      private ngZone: NgZone
  ) {
      this.hostElement = this.elementRef.nativeElement;
    console.log("SuggestionBarComponent: Constructor - Host element assigned:", this.hostElement?.tagName);
      this.boundOnDragging = this.onDragging.bind(this);
      this.boundOnDragEnd = this.onDragEnd.bind(this);
    }

  ngOnInit(): void {
    if (this.hostElement) {
      console.log("SuggestionBarComponent: ngOnInit - Host element reference:", this.hostElement.tagName);
        this.observer = new MutationObserver(mutations => {
          this.ngZone.run(() => {
                let stateChanged = false;
                let suggestionsChanged = false;
            mutations.forEach(mutation => {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'data-loading-state') {
                         console.log("SuggestionBarComponent: Detected data-loading-state attribute change.");
                         this.updateLoadingState();
                         stateChanged = true;
                    }
                    if (mutation.type === 'attributes' && mutation.attributeName === 'data-suggestions') {
                        console.log("SuggestionBarComponent: Detected data-suggestions attribute change.");
                        this.updateSuggestions();
                        suggestionsChanged = true;
                    }
            });
            });
        });

        this.observer.observe(this.hostElement, {
            attributes: true,
          attributeFilter: ['data-suggestions', 'data-loading-state']
        });
        console.log("SuggestionBarComponent: MutationObserver attached to host element:", this.hostElement.tagName);

        this.updateLoadingState();
        this.updateSuggestions();

        if (getComputedStyle(this.hostElement).position === 'static') {
          console.warn("SuggestionBarComponent: Host element position was static, setting to relative for dragging.");
             this.hostElement.style.position = 'relative';
        }
      this.hostElement.style.cursor = 'default';

    } else {
         console.error("SuggestionBarComponent: Host element reference was not set in constructor.");
    }
  }

  private updateLoadingState(): void {
      const loadingState = this.hostElement.getAttribute('data-loading-state');
    const newLoadingValue = (loadingState !== 'ready');
      console.log(`SuggestionBarComponent: Reading data-loading-state attribute. Value: "${loadingState}". Setting isLoading to: ${newLoadingValue}`);
      if (this.isLoading !== newLoadingValue) {
          this.isLoading = newLoadingValue;
        this.cdRef.markForCheck();
      }
  }

  private updateSuggestions(): void {
    const suggestionsAttr = this.hostElement.getAttribute('data-suggestions');
    try {
        const raw = suggestionsAttr ? JSON.parse(suggestionsAttr) : [];
        const newSuggestions: string[] = Array.isArray(raw)
          ? raw.filter((item: unknown): item is string => typeof item === 'string').map(s => s.slice(0, 100))
          : [];
        if (JSON.stringify(newSuggestions) !== JSON.stringify(this.suggestions)) {
            this.suggestions = newSuggestions;
          this.isLoading = false;
          this.cdRef.markForCheck();
        }
    } catch (e) {
        console.error('SuggestionBarComponent: Failed to parse suggestions attribute:', e);
        if (this.suggestions.length > 0) {
          this.suggestions = [];
          this.cdRef.markForCheck();
        }
    }
  }

  ngOnDestroy(): void {
    if (this.observer) {
        this.observer.disconnect();
        console.log("SuggestionBarComponent: MutationObserver disconnected.");
    }
    if (this.isDragging) {
         document.removeEventListener('mousemove', this.boundOnDragging, true);
         document.removeEventListener('mouseup', this.boundOnDragEnd, true);
         console.log("SuggestionBarComponent: Cleaned up drag listeners on destroy.");
    }
  }

  dismiss(): void {
    console.log('SuggestionBarComponent: Dismiss requested.');
    this.hostElement.dispatchEvent(new CustomEvent('dismissRequestEvent', {
        bubbles: true,
        composed: true
    }));
    console.log('SuggestionBarComponent: Dispatched dismissRequestEvent on host.');
  }

  onDragStart(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.classList.contains('dismiss-button') || target.classList.contains('suggestion-item') || target.classList.contains('collapse-toggle') || target.classList.contains('manual-input')) {
      console.log("SuggestionBarComponent: Drag prevented on interactive element.");
        return;
    }

    console.log("SuggestionBarComponent: Drag start.");
    this.isDragging = true;
    const rect = this.hostElement.getBoundingClientRect();
    this.offsetX = event.clientX - rect.left;
    this.offsetY = event.clientY - rect.top;
    const currentPosition = getComputedStyle(this.hostElement).position;
     if (currentPosition === 'static' || currentPosition === 'relative') {
          console.warn(`SuggestionBarComponent: Host position is ${currentPosition}. Changing to absolute for dragging.`);
       this.hostElement.style.position = 'absolute';
     }

    this.hostElement.classList.add('dragging');
    event.preventDefault();
    event.stopPropagation();

    document.addEventListener('mousemove', this.boundOnDragging, true);
    document.addEventListener('mouseup', this.boundOnDragEnd, true);
  }

  private onDragging(event: MouseEvent): void {
    if (!this.isDragging) return;
    event.preventDefault();
    const newLeft = event.pageX - this.offsetX;
    const newTop = event.pageY - this.offsetY;
    this.ngZone.runOutsideAngular(() => {
        this.hostElement.style.left = `${newLeft}px`;
      this.hostElement.style.top = `${newTop}px`;
        this.hostElement.style.bottom = 'auto';
        this.hostElement.style.right = 'auto';
    });
  }

  private onDragEnd(event: MouseEvent): void {
    if (!this.isDragging) return;
    event.preventDefault();
    event.stopPropagation();

    console.log("SuggestionBarComponent: Drag end.");
    this.isDragging = false;
    this.hostElement.classList.remove('dragging');
    document.removeEventListener('mousemove', this.boundOnDragging, true);
    document.removeEventListener('mouseup', this.boundOnDragEnd, true);

    this.hostElement.setAttribute('data-dragged', 'true');
    console.log("SuggestionBarComponent: Set data-dragged attribute.");
  }

  selectWord(word: string): void {
    console.log('SuggestionBarComponent: Word selected:', word);
    navigator.clipboard.writeText(word).then(() => {
      console.log('Word copied to clipboard');
      // Optionally, provide user feedback that copy was successful
    }).catch(err => {
      console.error('Failed to copy word: ', err);
    });
  }

  toggleInput(): void {
    this.isInputVisible = !this.isInputVisible;
    this.cdRef.markForCheck();
  }

  onManualInput(): void {
    const value = this.manualInput.nativeElement.value;
    if (value.length > 1) {
      // Dispatch event to content script to get suggestions
      this.hostElement.dispatchEvent(new CustomEvent('manualWordUpdate', {
        detail: value,
        bubbles: true,
        composed: true
      }));
    } else {
      this.suggestions = [];
      this.cdRef.markForCheck();
    }
  }

  trackByIndex(index: number, item: string): number {
    return index;
  }
}
