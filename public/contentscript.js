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
// 1. Content Script Logic (Updated Suggestion Clearing Logic)
//    - Creates host element once on load.
//    - Connects to background script via chrome.runtime.connect.
//    - Listens for state updates on the connection port.
//    - Hides element on dismiss, doesn't destroy automatically.
//    - Preserves dragged position.
//    - Keeps old suggestions if no new ones are found.
//    - Clears suggestions when whitespace/punctuation is typed after a word.
// ==========================================================================

console.log('Content script (JS) loaded - Persistent Mode.');

// --- Configuration ---
const DEBOUNCE_MS = 300;
const MIN_WORD_LENGTH = 2;
const INITIAL_POS_BOTTOM = '20px';
const INITIAL_POS_RIGHT = '20px';
const PORT_NAME = 'suggestionState'; // Name for the connection port (MUST MATCH BACKGROUND)

// --- State Management ---
let currentInputElement = null; // Currently focused input/textarea
let lastWordInfo = null; // Info about the word being typed { word, start, end }
let suggestionHostElement = null; // Reference to the <suggestion-bar-host> element
let debounceTimer = null; // Timer ID for debouncing
let backgroundStatePort = null; // Holds the connection port to the background script

// --- Suggestion Host Management ---

/**
 * Ensures the host element exists in the DOM. Creates and positions it
 * the first time it's called. Adds necessary event listeners and connects to background.
 * @returns {HTMLElement | null} The suggestion host element or null if creation failed.
 */
function ensureSuggestionHostExists() {
  // If element already exists, return it
  if (suggestionHostElement && document.body.contains(suggestionHostElement)) {
    return suggestionHostElement;
  }
  // If reference exists but element detached, clean up
  if (suggestionHostElement && !document.body.contains(suggestionHostElement)) {
    console.warn("Suggestion host reference existed but element was not in body. Resetting.");
      if (backgroundStatePort) { // Disconnect old port if element is gone
        backgroundStatePort.disconnect();
      }
      suggestionHostElement = null;
    }

  console.log('Creating suggestion host element for the first time.');
  try {
    suggestionHostElement = document.createElement('suggestion-bar-host'); // Tag defined by Angular Element
    suggestionHostElement.id = 'phonetic-suggestion-app-host'; // Unique ID
      suggestionHostElement.setAttribute('data-loading-state', 'loading');
      suggestionHostElement.setAttribute('data-suggestions', '[]'); // Start empty

      // --- Event Listener for Word Selection ---
      suggestionHostElement.addEventListener('wordSelectedEvent', (event) => {
          const selectedWord = event.detail;
          console.log('Word selected event caught by content script:', selectedWord);
          if (currentInputElement && lastWordInfo && typeof selectedWord === 'string') {
            replaceWord(currentInputElement, lastWordInfo, selectedWord);
          }
          if (suggestionHostElement) { // Clear suggestions after selection
            suggestionHostElement.setAttribute('data-suggestions', '[]');
          }
        });

      // --- Event Listener for Dismiss Request ---
      suggestionHostElement.addEventListener('dismissRequestEvent', (event) => {
        console.log('Dismiss requested event caught by content script.');
          hideSuggestionHost();
        });
      // ---

      document.body.appendChild(suggestionHostElement);
      positionSuggestionHostInitially();
      console.log("Suggestion host created and positioned initially.");

      // --- Establish connection to background script ---
      connectToBackground();
      // ---

      return suggestionHostElement;

    } catch (error) {
      console.error("Error creating suggestion host element:", error);
      suggestionHostElement = null;
      return null;
    }
}

/**
 * Sets the initial fixed position of the suggestion host,
 * respecting the 'data-dragged' attribute if the element somehow pre-exists.
 */
function positionSuggestionHostInitially() {
  if (!suggestionHostElement) return;
  if (suggestionHostElement.getAttribute('data-dragged') === 'true') {
    console.log('Host has been dragged previously, skipping initial positioning.');
      suggestionHostElement.style.display = 'block';
      return;
    }
  console.log('Positioning suggestion host initially (fixed).');
  suggestionHostElement.style.position = 'fixed';
  suggestionHostElement.style.bottom = INITIAL_POS_BOTTOM;
  suggestionHostElement.style.right = INITIAL_POS_RIGHT;
  suggestionHostElement.style.left = 'auto';
  suggestionHostElement.style.top = 'auto';
  suggestionHostElement.style.zIndex = '99999';
  suggestionHostElement.style.display = 'block';
  suggestionHostElement.removeAttribute('data-dragged');
}

/**
 * Hides the host element and clears its suggestions attribute.
 */
function hideSuggestionHost() {
  if (suggestionHostElement) {
    console.log('Hiding suggestion host element.');
      suggestionHostElement.style.display = 'none';
      suggestionHostElement.setAttribute('data-suggestions', '[]');
      lastWordInfo = null;
    }
}

/**
 * Updates the loading attribute on the host element based on received state.
 * @param {string | undefined} state The state received ('ready', 'building', etc.)
 */
function updateLoadingAttribute(state) {
  if (suggestionHostElement && document.body.contains(suggestionHostElement)) {
    const loadingState = (state === 'ready') ? 'ready' : 'loading';
    if (suggestionHostElement.getAttribute('data-loading-state') !== loadingState) {
      suggestionHostElement.setAttribute('data-loading-state', loadingState);
      console.log(`Set data-loading-state based on '${state}' to: ${loadingState}`);
    }
  }
}

// --- Connect to Background Script ---
/**
 * Establishes and manages the long-lived connection to the background script.
 */
function connectToBackground() {
  if (backgroundStatePort) { return; } // Already connected
  try {
    console.log(`Connecting to background script with port name: ${PORT_NAME}`);
    backgroundStatePort = chrome.runtime.connect({ name: PORT_NAME });
    backgroundStatePort.onMessage.addListener((message) => {
      console.log('[ContentScript Port] Received message:', message);
      if (message && message.type === 'BACKGROUND_STATE_UPDATE') {
        updateLoadingAttribute(message.payload);
      }
    });
    backgroundStatePort.onDisconnect.addListener(() => {
      console.error("Background port disconnected.");
      if (chrome.runtime.lastError) { console.error("Disconnection error:", chrome.runtime.lastError.message); }
      backgroundStatePort = null;
      updateLoadingAttribute('error');
    });
    console.log("Connection port established.");
  } catch (error) {
    console.error("Error connecting to background script:", error);
    backgroundStatePort = null;
    updateLoadingAttribute('error');
  }
}

// --- Input Event Handling ---
/**
 * Handles debounced input events to detect words and trigger suggestion requests.
 * @param {Event} event - The input event object.
 */
function debouncedHandleInput(event) {
  const target = event.target;
  currentInputElement = target;
  const text = target.value;
  const cursorPosition = target.selectionStart;

  const host = ensureSuggestionHostExists();
  if (!host) return;

  if (cursorPosition === null) {
    host.setAttribute('data-suggestions', '[]');
      lastWordInfo = null;
      return;
    }

  // Find word boundaries
  const textBeforeCursor = text.slice(0, cursorPosition);
  const textAfterCursor = text.slice(cursorPosition);
  const matchBefore = textBeforeCursor.match(/(\S+)$/);
  const start = matchBefore?.index ?? cursorPosition;
  const matchAfter = textAfterCursor.match(/^(\S*)/);
  const wordPartAfter = matchAfter ? matchAfter[1] : '';
  const wordEnd = cursorPosition + wordPartAfter.length;

  if (start === undefined) {
    host.setAttribute('data-suggestions', '[]');
      lastWordInfo = null;
      return;
    }

  const currentWord = text.slice(start, wordEnd).trim();
  const isPotentialWord = currentWord && currentWord.length >= MIN_WORD_LENGTH && !/\s/.test(currentWord);

  // Check if it's a potential word to get suggestions for
  if (isPotentialWord) {
    const currentWordInfo = { word: currentWord, start: start, end: wordEnd };
    // Only send if the word or position actually changed
    if (JSON.stringify(currentWordInfo) !== JSON.stringify(lastWordInfo)) {
          lastWordInfo = currentWordInfo; // Store info about the word we are requesting for
          console.log(`Potential word detected: "${currentWord}"`);

          // Send message to background script for suggestions
          chrome.runtime.sendMessage(
            { type: 'CURRENT_WORD_UPDATE', payload: currentWord },
            (response) => {
                  if (chrome.runtime.lastError) { console.error('Error sending message:', chrome.runtime.lastError.message); return; }

                  // Check if context is still valid
                  const stillValidContext = document.activeElement === currentInputElement &&
                    lastWordInfo &&
                    lastWordInfo.word === currentWord &&
                    currentInputElement.selectionStart >= lastWordInfo.start &&
                    currentInputElement.selectionStart <= lastWordInfo.end;

                  if (!stillValidContext) {
                      console.log("Context changed during suggestion fetch, discarding suggestions response.");
                      return; // Don't update suggestions if context changed
                    }

                  // --- Logic for handling suggestions response ---
                  if (response && response.success && response.matches) {
                      // Only update if suggestions array is NOT empty
                      if (response.matches.length > 0) {
                          console.log('Received suggestions:', response.matches);
                          if (host) {
                            host.style.display = 'block'; // Ensure visible
                            host.setAttribute('data-suggestions', JSON.stringify(response.matches));
                          }
                        } else {
                          // Received empty array - DO NOTHING to attribute
                          console.log('Received empty suggestions array. Keeping previous suggestions displayed.');
                          // Ensure host stays visible if it was already
                          if (host) { host.style.display = 'block'; }
                        }
                    } else {
                      // Background reported failure or invalid response
                      console.log('No suggestions received or background failed. Keeping previous suggestions displayed.');
                      // DO NOTHING to attribute here either
                      // Ensure host stays visible if it was already
                      if (host) { host.style.display = 'block'; }
                    }
                  // --- End Logic ---
                }
            );
        }
    } else {
      // Not a potential word (e.g., too short, contains space/punctuation, empty)
      // Clear suggestions ONLY if we were previously tracking a word (i.e., user typed space/deleted)
      if (lastWordInfo) {
          console.log(`Input "${currentWord}" is not a valid word for suggestions (or whitespace typed), clearing suggestions.`);
          lastWordInfo = null;
          if (host) {
            host.setAttribute('data-suggestions', '[]'); // Clear suggestions attribute
          }
        }
    }
}

// --- Word Replacement Function ---
function replaceWord(element, wordInfo, replacement) {
  const originalValue = element.value;
  const prefix = originalValue.substring(0, wordInfo.start);
  const suffix = originalValue.substring(wordInfo.end);
  element.value = prefix + replacement + ' ' + suffix;
  const newCursorPos = wordInfo.start + replacement.length + 1;
  element.focus();
  element.setSelectionRange(newCursorPos, newCursorPos);
  element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  lastWordInfo = null;
  if (suggestionHostElement) {
    // Clear suggestions after replacing word
    suggestionHostElement.setAttribute('data-suggestions', '[]');
  }
}

// --- Event Listener Setup ---

// Input listener
document.addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debouncedHandleInput(event);
    }, DEBOUNCE_MS);
  }
}, true);

// Listener for Background State Updates (via port)
// (Listener added in connectToBackground)

// --- Initial Setup ---
let hostEnsured = false;
function initialSetup() {
  if (hostEnsured) return;
  hostEnsured = true;
  ensureSuggestionHostExists(); // Creates host and connects port
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialSetup);
} else {
  initialSetup();
}

console.log("Content script event listeners attached.");

