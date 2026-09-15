// ==========================================================================
// 1. Content Script Logic (Listen to Window Keystrokes)
//    - Injects into all frames.
//    - Top window creates the UI host and listens for messages from iframes.
//    - Iframes detect text selection/typing and post messages to the top window.
//    - Top window is the single source of truth for background communication.
// ==========================================================================

console.log('Content script (JS) loaded - Persistent Mode, Window Keystrokes.');

// --- Constants ---
const IS_TOP_WINDOW = window.self === window.top;
const MESSAGE_SOURCE = 'word-predictor-content-script';

// --- Diagnostic Logging ---
if (IS_TOP_WINDOW) {
  console.log('[ContentScript] Running in top window.');
} else {
  console.log('[ContentScript] Running in an iframe.');
}
// ---

// --- Configuration ---
const DEBOUNCE_MS = 300;
const MIN_WORD_LENGTH = 2;
const INITIAL_POS_BOTTOM = '20px';
const INITIAL_POS_RIGHT = '20px';
const PORT_NAME = 'suggestionState'; // Name for the connection port (MUST MATCH BACKGROUND)

// --- State Management ---
let currentEditableElement = null; // HTMLElement | null (focused editable element, relevant in the active frame)
let lastWordInfo = null; // { word: string; start: number; end: number; isEditableDiv?: boolean } | null
let suggestionHostElement = null; // Reference to the <suggestion-bar-host> element (TOP WINDOW ONLY)
let debounceTimer = null; // Timer ID for debouncing (per-frame)
let backgroundStatePort = null; // Holds the connection port to the background script (TOP WINDOW ONLY)


// --- Suggestion Host Management (TOP WINDOW ONLY) ---

/**
 * Ensures the host element exists in the DOM. Creates and positions it
 * the first time it's called. Adds necessary event listeners and connects to background.
 * @returns {HTMLElement | null} The suggestion host element or null if creation failed.
 */
function ensureSuggestionHostExists() {
  if (!IS_TOP_WINDOW) return null; // Only run in top window

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
      // This event is for when a user clicks a suggestion. The replacement logic is tricky
      // across frames, so for now, we'll just log it. A real implementation would
      // need to post a message back to the originating iframe to perform the replacement.
      suggestionHostElement.addEventListener('wordSelectedEvent', (event) => {
          const selectedWord = event.detail;
          console.log('Word selected event caught by top window. Replacement in iframes is a TODO.');
          // NOTE: The original replaceWord() function is difficult to make work reliably
          // across iframes without a more complex messaging system to handle the replacement.
          // For now, we just hide the suggestions.
          if (suggestionHostElement) {
            suggestionHostElement.setAttribute('data-suggestions', '[]');
          }
        });

      suggestionHostElement.addEventListener('manualWordUpdate', (event) => {
        const word = event.detail;
        console.log('Manual word update event caught by content script.');
        chrome.runtime.sendMessage({ type: 'CURRENT_WORD_UPDATE', payload: word }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Error sending message:', chrome.runtime.lastError.message);
            return;
          }
          if (response && response.success && response.matches) {
            if (response.matches.length > 0) {
              console.log('Received suggestions for manual input.');
              if (suggestionHostElement) { suggestionHostElement.setAttribute('data-suggestions', JSON.stringify(response.matches)); }
            } else {
              console.log('Received empty suggestions array for manual input.');
              if (suggestionHostElement) { suggestionHostElement.setAttribute('data-suggestions', '[]'); }
            }
          } else {
            console.log('No suggestions received or background failed for manual input.');
            if (suggestionHostElement) { suggestionHostElement.setAttribute('data-suggestions', '[]'); }
          }
        });
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
 * respecting the 'data-dragged' attribute.
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

// --- Connect to Background Script (TOP WINDOW ONLY) ---
/**
 * Establishes and manages the long-lived connection to the background script.
 */
function connectToBackground() {
  if (!IS_TOP_WINDOW) return;
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
      console.log("Background port disconnected.");
      if (chrome.runtime.lastError) { console.error("Disconnection error:", chrome.runtime.lastError.message); }
      backgroundStatePort = null;
    });
    console.log("Connection port established.");
  } catch (error) {
    console.error("Error connecting to background script:", error);
    backgroundStatePort = null;
  }
}

// --- Helper to detect sensitive input fields ---
function isSensitiveElement(element) {
  if (!element || !(element instanceof HTMLElement)) return false;

  if (element.getAttribute('aria-hidden') === 'true' || (element.closest && element.closest('[aria-hidden="true"]'))) {
    return true;
  }

  if (element instanceof HTMLInputElement) {
    const type = (element.type || '').toLowerCase();
    const sensitiveTypes = ['password', 'email', 'tel', 'number', 'hidden'];
    if (sensitiveTypes.includes(type)) return true;

    const autocomplete = (element.autocomplete || '').toLowerCase();
    if (/^(cc-|.*password|one-time-code|tel|email|transaction-)/.test(autocomplete)) return true;

    const inputmode = (element.inputMode || element.getAttribute('inputmode') || '').toLowerCase();
    if (inputmode === 'numeric' || inputmode === 'decimal' || inputmode === 'tel' || inputmode === 'email') return true;
  }

  if (element instanceof HTMLTextAreaElement) {
    const autocomplete = (element.autocomplete || '').toLowerCase();
    if (/^(cc-|.*password|one-time-code)/.test(autocomplete)) return true;
  }

  return false;
}

// --- Input Event Handling (ALL FRAMES) ---
/**
 * Handles debounced input events to detect words and trigger suggestion requests.
 * @param {HTMLElement} targetElement The editable element where typing occurred.
 */
function debouncedHandleInput(targetElement) {
  if (isSensitiveElement(targetElement)) {
    if (lastWordInfo) {
      window.top.postMessage({ source: MESSAGE_SOURCE, type: 'CLEAR_SUGGESTIONS' }, '*');
      lastWordInfo = null;
    }
    return;
  }

  currentEditableElement = targetElement; // Store the active editable element

  // --- Enhanced Diagnostic Logging ---
  console.log(`[ContentScript Debug] debouncedHandleInput triggered for element:`, targetElement.tagName);
  const selection = window.getSelection();
  // ---

  // --- Handle Text Selection ---
  if (selection && selection.toString().length > 0) {
    const selectedText = selection.toString().trim();
    if (selectedText.length >= MIN_WORD_LENGTH) {
      console.log(`[ContentScript] Detected selection in ${IS_TOP_WINDOW ? 'top window' : 'iframe'}`);
      // Always post to top window to handle the logic
      window.top.postMessage({ source: MESSAGE_SOURCE, type: 'WORD_UPDATE', payload: selectedText }, '*');
    }
    return; // Don't process further if there's a selection
  }

  // --- Handle Typed Text (Logic for finding current word) ---
  let textContent = '';
  let cursorPosition = null;

  if (targetElement instanceof HTMLInputElement || targetElement instanceof HTMLTextAreaElement) {
    textContent = targetElement.value;
    cursorPosition = targetElement.selectionStart;
  } else if (targetElement.isContentEditable) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && targetElement.contains(selection.anchorNode)) {
      textContent = targetElement.textContent || "";
      const range = selection.getRangeAt(0).cloneRange();
      range.selectNodeContents(targetElement);
      range.setEnd(selection.anchorNode, selection.anchorOffset);
      cursorPosition = range.toString().length;
    } else {
      return; // No valid selection
    }
  } else {
    return; // Not a recognized editable element
  }

  if (cursorPosition === null) {
    return;
  }

  const textBeforeCursor = textContent.slice(0, cursorPosition);
  const matchBefore = textBeforeCursor.match(/(\S+)$/);
  if (!matchBefore) {
      // No word before cursor, clear suggestions
      window.top.postMessage({ source: MESSAGE_SOURCE, type: 'CLEAR_SUGGESTIONS' }, '*');
      lastWordInfo = null;
      return;
  }

  const wordPartBefore = matchBefore[1];
  const start = matchBefore.index;

  const textAfterCursor = textContent.slice(cursorPosition);
  const matchAfter = textAfterCursor.match(/^(\S*)/);
  const wordPartAfter = matchAfter ? matchAfter[1] : '';
  const end = cursorPosition + wordPartAfter.length;

  const currentWord = wordPartBefore + wordPartAfter;

  const isPotentialWord = currentWord && currentWord.length >= MIN_WORD_LENGTH && !/\s/.test(currentWord);

  if (isPotentialWord) {
    const currentWordInfo = { word: currentWord, start: start, end: end };
    if (JSON.stringify(currentWordInfo) !== JSON.stringify(lastWordInfo)) {
      lastWordInfo = currentWordInfo;
      console.log('Potential word detected. Posting message to top window.');
      window.top.postMessage({ source: MESSAGE_SOURCE, type: 'WORD_UPDATE', payload: currentWord }, '*');
    }
  } else {
    if (lastWordInfo) {
      console.log('Input is not a valid word, clearing suggestions.');
      lastWordInfo = null;
      window.top.postMessage({ source: MESSAGE_SOURCE, type: 'CLEAR_SUGGESTIONS' }, '*');
    }
  }
}


// --- Event Listener Setup (ALL FRAMES) ---

// Listen for 'keyup' and 'selectionchange' on the document
function setupEventListeners() {
    const GDocsEditorSelector = '.kix-app-view-editor';

    const handleEvent = (event) => {
        const activeElement = document.activeElement;

        // We still need to find the right element to read from, which might be the activeElement
        // or a specific child of the event's target.
        let targetElement = activeElement;
        if (event.currentTarget && event.currentTarget.contains(activeElement)) {
            targetElement = activeElement;
        } else {
            // Fallback for when activeElement is not within the listener's target (e.g. body)
            targetElement = event.target;
        }

        if (targetElement instanceof HTMLInputElement ||
            targetElement instanceof HTMLTextAreaElement ||
            (targetElement instanceof HTMLElement && targetElement.isContentEditable)
        ) {
            if (isSensitiveElement(targetElement)) {
                if (lastWordInfo) {
                    window.top.postMessage({ source: MESSAGE_SOURCE, type: 'CLEAR_SUGGESTIONS' }, '*');
                    lastWordInfo = null;
                }
                return;
            }
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                debouncedHandleInput(targetElement);
            }, DEBOUNCE_MS);
        } else {
            if (lastWordInfo) {
                window.top.postMessage({ source: MESSAGE_SOURCE, type: 'CLEAR_SUGGESTIONS' }, '*');
                lastWordInfo = null;
            }
        }
    };

    const attachListeners = (element) => {
        console.log("[ContentScript] Attaching event listeners to:", element);
        element.addEventListener('keyup', handleEvent, true);
        element.addEventListener('selectionchange', handleEvent, true); // This might not fire on divs, but we try.
        // Mouseup is a good fallback for selection
        element.addEventListener('mouseup', handleEvent, true);
    };

    // Attempt to find the Google Docs editor immediately
    const gdocsEditor = document.querySelector(GDocsEditorSelector);
    if (gdocsEditor) {
        console.log("[ContentScript] Found Google Docs editor immediately.");
        attachListeners(gdocsEditor);
    } else {
        console.log("[ContentScript] Google Docs editor not found immediately. Using MutationObserver.");
        // If it's not there, watch for it to be added to the DOM
        const observer = new MutationObserver((mutations, obs) => {
            const editor = document.querySelector(GDocsEditorSelector);
            if (editor) {
                console.log("[ContentScript] Google Docs editor appeared.");
                attachListeners(editor);
                obs.disconnect(); // Stop observing once we've found it.
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Fallback for non-Google Docs sites
    attachListeners(document);

    console.log("Content script event listeners attached.");
}


// --- Message Listener (TOP WINDOW ONLY) ---
if (IS_TOP_WINDOW) {
  window.addEventListener('message', (event) => {
    // Basic validation
    if (event.source === window || !event.data || event.data.source !== MESSAGE_SOURCE) {
      return;
    }

    console.log('[Top Window] Received message from iframe:', event.data);

    const { type, payload } = event.data;
    const host = ensureSuggestionHostExists(); // Ensure host exists before processing
    if (!host) return;

    if (type === 'WORD_UPDATE') {
      // A word was selected or typed in an iframe.
      // We can't get a direct reference to the element, so replacement is tricky.
      // We store a placeholder info object.
      lastWordInfo = { word: payload, start: -1, end: -1, isEditableDiv: true };
      currentEditableElement = null; // Can't get a direct reference

      chrome.runtime.sendMessage(
        { type: 'CURRENT_WORD_UPDATE', payload: payload },
        (response) => {
          if (chrome.runtime.lastError) { console.error('Error sending message:', chrome.runtime.lastError.message); return; }
          if (response && response.success && response.matches) {
            if (response.matches.length > 0) {
              console.log('Received suggestions for iframe word:', response.matches);
              if (host) { host.style.display = 'block'; host.setAttribute('data-suggestions', JSON.stringify(response.matches)); }
            } else {
              console.log('Received empty suggestions array for iframe word. Hiding host.');
              hideSuggestionHost();
            }
          } else {
            console.log('No suggestions received or background failed for iframe word. Hiding host.');
            hideSuggestionHost();
          }
        }
      );
    } else if (type === 'CLEAR_SUGGESTIONS') {
      hideSuggestionHost();
    }
  });
}

// --- Initial Setup ---
function initialSetup() {
  if (IS_TOP_WINDOW) {
    ensureSuggestionHostExists(); // Creates host and connects port
  }
  setupEventListeners();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialSetup);
} else {
  initialSetup();
}