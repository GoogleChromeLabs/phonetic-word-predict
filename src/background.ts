// ==========================================================================
// Imports
// ==========================================================================
import phonex from 'talisman/phonetics/french/phonex';
import soundex2 from 'talisman/phonetics/french/soundex2';
import fonem from 'talisman/phonetics/french/fonem';
import sonnex from 'talisman/phonetics/french/sonnex';
import soundex from 'talisman/phonetics/soundex';
import metaphone from 'talisman/phonetics/metaphone';
import levenshtein from 'fast-levenshtein'; // Used for final sorting
// REMOVED: import Spellchecker from 'simple-spellchecker';

// ==========================================================================
// Configuration
// ==========================================================================
type TalismanPhoneticAlgorithm = 'phonex' | 'soundex2' | 'fonem' | 'sonnex' | 'soundex' | 'metaphone';
// --- RE-ADD BackgroundState and PORT_NAME ---
type BackgroundState = 'initializing' | 'building' | 'ready' | 'error';
const PORT_NAME = 'suggestionState'; // Name for the connection port (MUST MATCH CONTENT SCRIPT)
// ---

// List of Talisman algorithms to actually use
const ACTIVE_TALISMAN_ALGORITHMS: TalismanPhoneticAlgorithm[] = [
  'phonex',
  'soundex2',
  'metaphone'
];
const FINAL_SUGGESTION_LIMIT = 7;
const SUGGESTIONS_PER_METHOD = 5;

// ==========================================================================
// PhoneticSearcher Class Definition (Handles Multiple Talisman Algorithms)
// ==========================================================================
const DB_PREFIX = 'FrenchPhoneticsDB_';
const STORE_NAME_COMMON = 'phoneticMapStore';
const INDEX_NAME_COMMON = 'phoneticKeyIndex';
const INIT_STORE_NAME_PREFIX = 'initStatusStore_';
const INIT_KEY_PREFIX = 'dbInitialized_';
const DB_VERSION = 1;

export class PhoneticSearcher {
  private db: IDBDatabase | null = null;
  private isInitializing: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private initState: BackgroundState = 'initializing'; // Re-added state tracking
  private isReady: boolean = false;
  private readonly localWordListPath: string = 'frenchwords.json'; // Using local file
  private readonly algorithmType: TalismanPhoneticAlgorithm;
  private readonly activeAlgorithm: (text: string) => string;
  private readonly dbName: string;
  private readonly initializedKey: string;
  private readonly initStoreName: string;

  private static algorithmMap: Record<TalismanPhoneticAlgorithm, (text: string) => string> = {
    phonex, soundex2, fonem, sonnex, soundex, metaphone
  };

  constructor(algorithm: TalismanPhoneticAlgorithm) {
    this.algorithmType = algorithm;
    this.activeAlgorithm = PhoneticSearcher.algorithmMap[algorithm];
    if (!this.activeAlgorithm) throw new Error(`Unsupported algorithm: ${algorithm}`);
    this.dbName = `${DB_PREFIX}${this.algorithmType}`;
    this.initializedKey = `${INIT_KEY_PREFIX}${this.algorithmType}`;
    this.initStoreName = `${INIT_STORE_NAME_PREFIX}${this.algorithmType}`;
    console.log(`PhoneticSearcher (${this.algorithmType}): Instantiated.`);
      // Set initial state internally first, which will trigger notification
      this.setState('initializing');
      this.initializationPromise = this.initialize();
      this.initializationPromise.catch(error => {
        console.error(`PhoneticSearcher (${this.algorithmType}): Init failed:`, error);
           this.setState('error'); // Ensure error state is set and notified
         });
    }

  public getIsReady(): boolean {return this.isReady;}
  public getState(): BackgroundState {return this.initState;}

  /** Sets internal state and triggers notification via connected ports */
  private setState(newState: BackgroundState): void {
    if (this.initState !== newState) {
      console.log(`PhoneticSearcher (${this.algorithmType}): State changing to ${newState}.`);
      this.initState = newState;
      // Trigger global notification function which checks overall state
      notifyConnectedContentScripts(); // Notify with the new OVERALL state
    }
  }

  public async initialize(): Promise<void> {
      if (!this.initializationPromise) {this.initializationPromise = this._doInitialize();}
      // Send current state again if initialize is called when ready
      if (this.isReady) {notifyConnectedContentScripts();}
      return this.initializationPromise;
    }

  private async _doInitialize(): Promise<void> {
      if (this.isInitializing || this.isReady) {return;}
      this.isInitializing = true;
      // Initializing state was set in constructor (which calls setState)

      try {
        this.db = await this.openDatabase();
        const isInitialized = await this.checkIfInitialized();
        if (!isInitialized) {
              this.setState('building');
              await this.buildAndStorePhoneticIndex();
              await this.markAsInitialized();
              this.isReady = true;
              this.setState('ready');
            } else {
              this.isReady = true;
              this.setState('ready');
            }
          console.log(`PhoneticSearcher (${this.algorithmType}): Initialization complete.`);
        } catch (error) {
          console.error(`PhoneticSearcher (${this.algorithmType}): CRITICAL Init Error:`, error);
        this.db = null; this.isReady = false;
        this.setState('error');
        this.isInitializing = false;
        throw error;
      } finally {
        this.isInitializing = false;
      }
    }

  // --- openDatabase, checkIfInitialized, markAsInitialized, buildAndStorePhoneticIndex, suggestMatches, getWordsForKey ---
  // (These methods remain the same as the previous version that used localWordListPath)
  private openDatabase(): Promise<IDBDatabase> {return new Promise((resolve, reject) => {console.log(`Opening DB "${this.dbName}"`); const request = indexedDB.open(this.dbName, DB_VERSION); request.onerror = (e) => reject(request.error); request.onsuccess = (e) => resolve(request.result); request.onupgradeneeded = (e) => {const db = request.result; console.log(`Upgrading DB ${this.dbName}`); if (!db.objectStoreNames.contains(STORE_NAME_COMMON)) {db.createObjectStore(STORE_NAME_COMMON, {keyPath: 'phoneticKey'}).createIndex(INDEX_NAME_COMMON, 'phoneticKey', {unique: true});} if (!db.objectStoreNames.contains(this.initStoreName)) {db.createObjectStore(this.initStoreName, {keyPath: 'key'});} };});}
  private checkIfInitialized(): Promise<boolean> {return new Promise(async (resolve, reject) => {if (!this.db) return reject(new Error("DB not open")); if (!this.db.objectStoreNames.contains(this.initStoreName)) {return resolve(false);} try {const tx = this.db.transaction(this.initStoreName, 'readonly'); const req = tx.objectStore(this.initStoreName).get(this.initializedKey); req.onerror = (e) => reject(req.error); req.onsuccess = (e) => resolve(!!req.result?.value);} catch (err) {reject(err);} });}
  private markAsInitialized(): Promise<void> {return new Promise(async (resolve, reject) => {if (!this.db) return reject(new Error("DB not open")); if (!this.db.objectStoreNames.contains(this.initStoreName)) {return reject(new Error(`Init store ${this.initStoreName} not found.`));} try {const tx = this.db.transaction(this.initStoreName, 'readwrite'); const req = tx.objectStore(this.initStoreName).put({key: this.initializedKey, value: true}); req.onerror = (e) => reject(req.error); req.onsuccess = (e) => resolve();} catch (err) {reject(err);} });}
  private async buildAndStorePhoneticIndex(): Promise<void> {if (!this.db) throw new Error("DB not open"); console.time(`build (${this.algorithmType})`); let wordsArray: string[] = []; try {if (!chrome?.runtime?.getURL) throw new Error("chrome.runtime.getURL not available."); const fileUrl = chrome.runtime.getURL(this.localWordListPath); console.log(`Fetching local wordlist from: ${fileUrl} for ${this.algorithmType}`); const response = await fetch(fileUrl); if (!response.ok) throw new Error(`Fetch failed for ${fileUrl}: ${response.status} ${response.statusText}`); wordsArray = await response.json(); if (!Array.isArray(wordsArray)) throw new Error("Invalid JSON array from local file.");} catch (error) {console.error(`Word list error (${this.localWordListPath}):`, error); throw error;} let batch = new Map<string, Set<string>>(); const batchSize = 5000; const writeBatch = async (b: Map<string, Set<string>>) => {if (!this.db || b.size === 0) return; const tx = this.db.transaction(STORE_NAME_COMMON, 'readwrite'); const store = tx.objectStore(STORE_NAME_COMMON); let promises: Promise<void>[] = []; for (const [k, ws] of b.entries()) {const wta = Array.from(ws); const gr = store.get(k); const p = new Promise<void>((res, rej) => {gr.onsuccess = () => {const er = gr.result; let pr: IDBRequest; if (er) {pr = store.put({phoneticKey: k, words: Array.from(new Set([...er.words, ...wta]))});} else {pr = store.add({phoneticKey: k, words: wta});} pr.onsuccess = () => res(); pr.onerror = () => rej(pr.error);}; gr.onerror = () => rej(gr.error);}); promises.push(p);} try {await Promise.all(promises);} catch (dbError) {console.error(`Batch write error:`, dbError);} }; for (const word of wordsArray) {const tw = word?.trim(); if (!tw) continue; try {const nw = tw.toLowerCase(); const key = this.activeAlgorithm(nw); if (key && typeof key === 'string') {if (!batch.has(key)) {batch.set(key, new Set());} batch.get(key)!.add(tw); if (batch.size >= batchSize) {await writeBatch(batch); batch.clear();} } else if (key === '') {if (!batch.has(key)) {batch.set(key, new Set());} batch.get(key)!.add(tw);} } catch (error) {console.warn(`${this.algorithmType} error for "${tw}":`, error);} } if (batch.size > 0) {await writeBatch(batch);} console.timeEnd(`build (${this.algorithmType})`);}
  public async suggestMatches(query: string, limit: number = SUGGESTIONS_PER_METHOD): Promise<string[]> {if (!this.isReady || !this.db) {return [];} const normalizedQuery = query?.toLowerCase().trim(); if (!normalizedQuery) return []; try {const queryKey = this.activeAlgorithm(normalizedQuery); if (typeof queryKey !== 'string') {return [];} const matchingWords = await this.getWordsForKey(queryKey); if (matchingWords.length === 0) {return [];} const wordsWithDistance = matchingWords.map(word => ({word: word, distance: levenshtein.get(normalizedQuery, word.toLowerCase())})); wordsWithDistance.sort((a, b) => a.distance - b.distance); const sortedSuggestions = wordsWithDistance.map(item => item.word); return sortedSuggestions.slice(0, limit);} catch (error) {console.error(`Error during ${this.algorithmType} search for "${query}":`, error); return [];} }
  private getWordsForKey(key: string): Promise<string[]> {return new Promise((resolve, reject) => {if (!this.db) return reject(new Error("DB not open")); if (!this.db.objectStoreNames.contains(STORE_NAME_COMMON)) {return resolve([]);} try {const tx = this.db.transaction(STORE_NAME_COMMON, 'readonly'); const store = tx.objectStore(STORE_NAME_COMMON); const request = store.get(key); request.onerror = (e) => reject(request.error); request.onsuccess = (e) => resolve(request.result?.words || []);} catch (error) {reject(error);} });}
}

// ==========================================================================
// Background Script Logic (Using runtime.connect for State)
// ==========================================================================

console.log("Background script starting...");

// --- Instantiate ALL configured Talisman suggestors ---
const suggestors: Partial<Record<TalismanPhoneticAlgorithm, PhoneticSearcher>> = {};
// --- Flag to ensure one-time instantiation logic ---
let suggestorsInitialized = false;

/**
 * Ensures all configured PhoneticSearcher instances are created.
 */
function ensureSuggestorInstances(): void {
  if (suggestorsInitialized) {
    return;
  }
  console.log("Ensuring suggestor instances are created...");
  ACTIVE_TALISMAN_ALGORITHMS.forEach(algo => {
      if (!suggestors[algo]) {
          console.log(`Instantiating PhoneticSearcher for: ${algo}`);
          suggestors[algo] = new PhoneticSearcher(algo);
        }
    });
  suggestorsInitialized = true;
  console.log("PhoneticSearcher instances now available.");
}
// ---

// --- Store connected content script ports ---
const connectedPorts = new Map<number, chrome.runtime.Port>();
let nextPortId = 0; // Simple counter for port IDs

/** Gets the combined readiness state (ready if ALL active suggestors are ready) */
function getOverallReadinessState(): BackgroundState {
  ensureSuggestorInstances(); // Make sure instances exist before checking state
  let combinedState: BackgroundState = 'ready';
  let isActiveSuggestorInitializing = false;
  let isActiveSuggestorBuilding = false;
  let isActiveSuggestorError = false;

  const activeInstances = ACTIVE_TALISMAN_ALGORITHMS
    .map(algo => suggestors[algo])
    .filter(instance => !!instance) as PhoneticSearcher[];

  if (activeInstances.length === 0) return 'error';

  for (const instance of activeInstances) {
    const instanceState = instance.getState();
    if (instanceState === 'error') isActiveSuggestorError = true;
    if (instanceState === 'building') isActiveSuggestorBuilding = true;
    if (instanceState === 'initializing') isActiveSuggestorInitializing = true;
  }

  if (isActiveSuggestorError) return 'error';
  if (isActiveSuggestorBuilding) return 'building';
  if (isActiveSuggestorInitializing) return 'initializing';

  return 'ready';
}

/** Sends state update to all connected ports */
function notifyConnectedContentScripts(): void { // Removed state parameter
  const overallState = getOverallReadinessState();
  const message = {type: 'BACKGROUND_STATE_UPDATE', payload: overallState};

  if (connectedPorts.size > 0) {
    console.log(`Background: Notifying ${connectedPorts.size} connected ports state: ${overallState}`);
    connectedPorts.forEach((port, portId) => {
      try {port.postMessage(message);}
      catch (error) {console.warn(`Error posting to port ${portId}:`, error); connectedPorts.delete(portId);}
    });
  } else {
    console.log(`Background: State changed to ${overallState}, but no content scripts connected.`);
  }
}
// ---

// --- Listen for new connections from content scripts ---
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PORT_NAME) {
    ensureSuggestorInstances(); // Ensure suggestors are created before getting state
    const portId = nextPortId++;
    console.log(`Background: Content script connected via port ${portId}. Sender:`, port.sender?.tab?.id);
    connectedPorts.set(portId, port);

      const currentState = getOverallReadinessState();
      console.log(`Background: Sending initial overall state ${currentState} to port ${portId}`);
      try {port.postMessage({type: 'BACKGROUND_STATE_UPDATE', payload: currentState});}
      catch (error) {console.warn(`Error posting initial message to port ${portId}:`, error); connectedPorts.delete(portId);}

      port.onDisconnect.addListener(() => {
        console.log(`Background: Port ${portId} disconnected.`);
        connectedPorts.delete(portId);
        if (chrome.runtime.lastError) {console.warn(`Port ${portId} disconnect error:`, chrome.runtime.lastError.message);}
      });

    port.onMessage.addListener((message) => {
      console.log(`Background: Message received on port ${portId}:`, message);
      // Handle messages FROM content script on port if needed
    });
  } else {
    console.log("Background: Connection received from unexpected port name:", port.name);
  }
});
// ---

// --- Function to get all suggestions ---
async function getAllSuggestions(query: string): Promise<string[]> { /* ... same as before ... */
  ensureSuggestorInstances(); console.log(`Combining suggestions from algorithms: ${ACTIVE_TALISMAN_ALGORITHMS.join(', ')}`); const activeInstances = ACTIVE_TALISMAN_ALGORITHMS.map(algo => suggestors[algo]).filter(instance => !!instance) as PhoneticSearcher[]; if (activeInstances.length === 0) {console.warn("No active Talisman algorithms configured."); return [];} const allResults = await Promise.allSettled(activeInstances.map(async (instance) => {await instance.initialize(); if (instance.getIsReady()) {return await instance.suggestMatches(query, SUGGESTIONS_PER_METHOD);} return [];})); const combined: string[] = []; allResults.forEach((result, index) => {const algoName = ACTIVE_TALISMAN_ALGORITHMS[index]; if (result.status === 'fulfilled' && Array.isArray(result.value)) {console.log(`Suggestions from ${algoName}:`, result.value.length); combined.push(...result.value);} else if (result.status === 'rejected') {console.error(`Error getting suggestions from ${algoName}:`, result.reason);} }); const uniqueSuggestions = Array.from(new Set(combined)); console.log("Unique suggestions count:", uniqueSuggestions.length); const normalizedQuery = query.toLowerCase().trim(); if (!normalizedQuery) return []; const suggestionsWithDistance = uniqueSuggestions.map(word => ({word: word, distance: levenshtein.get(normalizedQuery, word.toLowerCase())})); suggestionsWithDistance.sort((a, b) => a.distance - b.distance); const finalSuggestions = suggestionsWithDistance.map(item => item.word).slice(0, FINAL_SUGGESTION_LIMIT); return finalSuggestions;
}


// --- Event Listeners ---
chrome.runtime.onInstalled.addListener(details => {
  console.log(`Extension ${details.reason}. Triggering initializations for all active suggestors.`);
  ensureSuggestorInstances(); // Ensure instances are created
  Object.values(suggestors).forEach(instance => {
    instance?.initialize().catch(err => console.error(`Init error on install for a suggestor:`, err));
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle suggestion requests via simple messaging
  if (message.type === 'CURRENT_WORD_UPDATE' && typeof message.payload === 'string') {
    const query = message.payload;
    console.log(`Background: Received suggestion request (combining Talisman methods)`);
    (async () => {
      ensureSuggestorInstances(); // Ensure instances are ready
      try {
        const matches = await getAllSuggestions(query);
        console.log(`Background: Found ${matches.length} combined matches. Sending response.`);
        sendResponse({success: true, matches: matches});
      } catch (error) {
        console.error(`Background: Error processing combined suggestion request:`, error);
        sendResponse({success: false, error: String(error)});
      }
    })();
    return true; // Indicate async response
  }
    // REMOVED GET_BACKGROUND_STATE handler
  else {
    console.log("Background: Received unhandled message type:", message.type);
    return false;
  }
});

console.log("Background script loaded and event listeners attached.");
// Initialize all suggestors on first load as well, after a brief delay
setTimeout(() => {
  console.log("Initial delayed initialization trigger for suggestors.");
  ensureSuggestorInstances();
  Object.values(suggestors).forEach(instance => {
    instance?.initialize().catch(err => console.error(`Initial init error for a suggestor:`, err));
  });
}, 100);

