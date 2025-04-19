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
// Imports
// ==========================================================================
import phonex from 'talisman/phonetics/french/phonex';
import soundex2 from 'talisman/phonetics/french/soundex2';
import fonem from 'talisman/phonetics/french/fonem';
import sonnex from 'talisman/phonetics/french/sonnex';
import soundex from 'talisman/phonetics/soundex';
import metaphone from 'talisman/phonetics/metaphone';
import levenshtein from 'fast-levenshtein'; // Used for final sorting

// ==========================================================================
// Configuration
// ==========================================================================
type TalismanPhoneticAlgorithm = 'phonex' | 'soundex2' | 'fonem' | 'sonnex' | 'soundex' | 'metaphone';

// List of Talisman algorithms to actually use
const ACTIVE_TALISMAN_ALGORITHMS: TalismanPhoneticAlgorithm[] = [
  'phonex',
  'soundex2',
  'metaphone',
  // 'fonem',
  // 'sonnex',
  // 'soundex'
];

const FINAL_SUGGESTION_LIMIT = 7; // Max suggestions to show after combining/sorting
const SUGGESTIONS_PER_METHOD = 5; // How many suggestions each method should aim for initially

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
  private isReady: boolean = false; // Simplified state: just ready or not
  private readonly wordListUrl: string = 'frenchwords.json';
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
    this.initializationPromise = this.initialize();
    this.initializationPromise.catch(error => {
      console.error(`PhoneticSearcher (${this.algorithmType}): Init failed:`, error);
    });
  }

  public getIsReady(): boolean {return this.isReady;}

  public async initialize(): Promise<void> {
    // Ensure initialize logic runs only once using the stored promise
    if (!this.initializationPromise) {
      this.initializationPromise = this._doInitialize();
    }
    return this.initializationPromise;
  }

  private async _doInitialize(): Promise<void> {
    if (this.isInitializing || this.isReady) {return;} // Don't re-run if initializing or ready
    this.isInitializing = true;
    console.log(`PhoneticSearcher (${this.algorithmType}): Starting initialization...`);
    try {
      this.db = await this.openDatabase();
      const isInitialized = await this.checkIfInitialized();
      if (!isInitialized) {
        console.log(`PhoneticSearcher (${this.algorithmType}): Building index...`);
        await this.buildAndStorePhoneticIndex();
        await this.markAsInitialized();
      } else {
        console.log(`PhoneticSearcher (${this.algorithmType}): Already initialized.`);
      }
      this.isReady = true; // Mark as ready
      console.log(`PhoneticSearcher (${this.algorithmType}): Initialization complete.`);
    } catch (error) {
      console.error(`PhoneticSearcher (${this.algorithmType}): CRITICAL Init Error:`, error);
      this.db = null;
      this.isReady = false; // Ensure not marked as ready on error
      throw error; // Re-throw
    } finally {
      this.isInitializing = false;
    }
  }

  // --- openDatabase, checkIfInitialized, markAsInitialized ---
  private openDatabase(): Promise<IDBDatabase> {return new Promise((resolve, reject) => {console.log(`Opening DB "${this.dbName}"`); const request = indexedDB.open(this.dbName, DB_VERSION); request.onerror = (e) => reject(request.error); request.onsuccess = (e) => resolve(request.result); request.onupgradeneeded = (e) => {const db = request.result; console.log(`Upgrading DB ${this.dbName}`); if (!db.objectStoreNames.contains(STORE_NAME_COMMON)) {db.createObjectStore(STORE_NAME_COMMON, {keyPath: 'phoneticKey'}).createIndex(INDEX_NAME_COMMON, 'phoneticKey', {unique: true});} if (!db.objectStoreNames.contains(this.initStoreName)) {db.createObjectStore(this.initStoreName, {keyPath: 'key'});} };});}
  private checkIfInitialized(): Promise<boolean> {return new Promise(async (resolve, reject) => {if (!this.db) return reject(new Error("DB not open")); if (!this.db.objectStoreNames.contains(this.initStoreName)) {return resolve(false);} try {const tx = this.db.transaction(this.initStoreName, 'readonly'); const req = tx.objectStore(this.initStoreName).get(this.initializedKey); req.onerror = (e) => reject(req.error); req.onsuccess = (e) => resolve(!!req.result?.value);} catch (err) {reject(err);} });}
  private markAsInitialized(): Promise<void> {return new Promise(async (resolve, reject) => {if (!this.db) return reject(new Error("DB not open")); if (!this.db.objectStoreNames.contains(this.initStoreName)) {return reject(new Error(`Init store ${this.initStoreName} not found.`));} try {const tx = this.db.transaction(this.initStoreName, 'readwrite'); const req = tx.objectStore(this.initStoreName).put({key: this.initializedKey, value: true}); req.onerror = (e) => reject(req.error); req.onsuccess = (e) => resolve();} catch (err) {reject(err);} });}
  // --- buildAndStorePhoneticIndex ---
  private async buildAndStorePhoneticIndex(): Promise<void> {if (!this.db) throw new Error("DB not open"); if (!this.wordListUrl) throw new Error("No URL"); console.time(`build (${this.algorithmType})`); let wordsArray: string[] = []; try {const response = await fetch(this.wordListUrl); if (!response.ok) throw new Error(`Fetch failed: ${response.status}`); wordsArray = await response.json(); if (!Array.isArray(wordsArray)) throw new Error("Invalid JSON");} catch (error) {console.error(`Word list error.`, error); throw error;} let batch = new Map<string, Set<string>>(); const batchSize = 5000; const writeBatch = async (b: Map<string, Set<string>>) => {if (!this.db || b.size === 0) return; const tx = this.db.transaction(STORE_NAME_COMMON, 'readwrite'); const store = tx.objectStore(STORE_NAME_COMMON); let promises: Promise<void>[] = []; for (const [k, ws] of b.entries()) {const wta = Array.from(ws); const gr = store.get(k); const p = new Promise<void>((res, rej) => {gr.onsuccess = () => {const er = gr.result; let pr: IDBRequest; if (er) {pr = store.put({phoneticKey: k, words: Array.from(new Set([...er.words, ...wta]))});} else {pr = store.add({phoneticKey: k, words: wta});} pr.onsuccess = () => res(); pr.onerror = () => rej(pr.error);}; gr.onerror = () => rej(gr.error);}); promises.push(p);} try {await Promise.all(promises);} catch (dbError) {console.error(`Batch write error:`, dbError);} }; for (const word of wordsArray) {const tw = word?.trim(); if (!tw) continue; try {const nw = tw.toLowerCase(); const key = this.activeAlgorithm(nw); if (key && typeof key === 'string') {if (!batch.has(key)) {batch.set(key, new Set());} batch.get(key)!.add(tw); if (batch.size >= batchSize) {await writeBatch(batch); batch.clear();} } else if (key === '') {if (!batch.has(key)) {batch.set(key, new Set());} batch.get(key)!.add(tw);} } catch (error) {console.warn(`${this.algorithmType} error for "${tw}":`, error);} } if (batch.size > 0) {await writeBatch(batch);} console.timeEnd(`build (${this.algorithmType})`);}
  // --- suggestMatches ---
  public async suggestMatches(query: string, limit: number = SUGGESTIONS_PER_METHOD): Promise<string[]> {if (!this.isReady || !this.db) {return [];} const normalizedQuery = query?.toLowerCase().trim(); if (!normalizedQuery) return []; try {const queryKey = this.activeAlgorithm(normalizedQuery); if (typeof queryKey !== 'string') {return [];} const matchingWords = await this.getWordsForKey(queryKey); if (matchingWords.length === 0) {return [];} const wordsWithDistance = matchingWords.map(word => ({word: word, distance: levenshtein.get(normalizedQuery, word.toLowerCase())})); wordsWithDistance.sort((a, b) => a.distance - b.distance); const sortedSuggestions = wordsWithDistance.map(item => item.word); return sortedSuggestions.slice(0, limit);} catch (error) {console.error(`Error during ${this.algorithmType} search for "${query}":`, error); return [];} }
  // --- getWordsForKey ---
  private getWordsForKey(key: string): Promise<string[]> {return new Promise((resolve, reject) => {if (!this.db) return reject(new Error("DB not open")); if (!this.db.objectStoreNames.contains(STORE_NAME_COMMON)) {return resolve([]);} try {const tx = this.db.transaction(STORE_NAME_COMMON, 'readonly'); const store = tx.objectStore(STORE_NAME_COMMON); const request = store.get(key); request.onerror = (e) => reject(request.error); request.onsuccess = (e) => resolve(request.result?.words || []);} catch (error) {reject(error);} });}
}

// ==========================================================================
// Background Script Logic (Combine Active Talisman Algorithms)
// ==========================================================================

console.log("Background script starting...");

// --- Instantiate ALL configured Talisman suggestors ---
// Use a Record type for PhoneticSearcher instances only
const suggestors: Partial<Record<TalismanPhoneticAlgorithm, PhoneticSearcher>> = {};

ACTIVE_TALISMAN_ALGORITHMS.forEach(algo => {
  console.log(`Instantiating PhoneticSearcher for: ${algo}`);
  suggestors[algo] = new PhoneticSearcher(algo);
});

console.log("PhoneticSearcher instances created (initialization running in background).");

// --- Function to get all suggestions from active Talisman algorithms ---
async function getAllSuggestions(query: string): Promise<string[]> {
  console.log(`Combining suggestions for "${query}" from algorithms: ${ACTIVE_TALISMAN_ALGORITHMS.join(', ')}`);
  // Get only the active instances based on ACTIVE_TALISMAN_ALGORITHMS
  const activeInstances = ACTIVE_TALISMAN_ALGORITHMS
    .map(algo => suggestors[algo])
    .filter(instance => !!instance) as PhoneticSearcher[]; // Filter out undefined and assert type

  if (activeInstances.length === 0) {
    console.warn("No active Talisman algorithms configured.");
    return [];
  }

  const allResults = await Promise.allSettled(
    activeInstances.map(async (instance) => {
      await instance.initialize(); // Ensure initialized
      if (instance.getIsReady()) { // Use internal isReady flag
        return await instance.suggestMatches(query, SUGGESTIONS_PER_METHOD);
      }
      return []; // Return empty if not ready
    })
  );

  const combined: string[] = [];
  allResults.forEach((result, index) => {
    const algoName = ACTIVE_TALISMAN_ALGORITHMS[index]; // Get algo name based on index
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      console.log(`Suggestions from ${algoName}:`, result.value);
      combined.push(...result.value);
    } else if (result.status === 'rejected') {
      console.error(`Error getting suggestions from ${algoName}:`, result.reason);
    }
  });

  // Deduplicate
  const uniqueSuggestions = Array.from(new Set(combined));
  console.log("Unique suggestions:", uniqueSuggestions);

  // Sort by Levenshtein distance
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return []; // Avoid sorting if query is empty

  const suggestionsWithDistance = uniqueSuggestions.map(word => ({
    word: word,
    distance: levenshtein.get(normalizedQuery, word.toLowerCase())
  }));
  suggestionsWithDistance.sort((a, b) => a.distance - b.distance);

  // Apply final limit
  const finalSuggestions = suggestionsWithDistance.map(item => item.word).slice(0, FINAL_SUGGESTION_LIMIT);
  console.log("Final sorted/limited suggestions:", finalSuggestions);
  return finalSuggestions;
}


// --- Event Listeners ---
chrome.runtime.onInstalled.addListener(details => {
  console.log(`Extension ${details.reason}. Triggering initializations for all active suggestors.`);
  Object.values(suggestors).forEach(instance => { // Initialize all instantiated suggestors
    instance?.initialize().catch(err => console.error(`Init error on install for a suggestor:`, err));
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle suggestion requests via simple messaging
  if (message.type === 'CURRENT_WORD_UPDATE' && typeof message.payload === 'string') {
    const query = message.payload;
    console.log(`Background: Received suggestion request for "${query}" (combining Talisman methods)`);
    (async () => {
      try {
        const matches = await getAllSuggestions(query);
        console.log(`Background: Found ${matches.length} combined matches for "${query}". Sending response.`);
        sendResponse({success: true, matches: matches});
      } catch (error) {
        console.error(`Background: Error processing combined suggestion request for "${query}":`, error);
        sendResponse({success: false, error: String(error)});
      }
    })();
    return true;
  }
  else {
    console.log("Background: Received unhandled message type:", message.type);
    return false;
  }
});

console.log("Background script loaded and event listeners attached.");
// Initialize all suggestors on first load as well
Object.values(suggestors).forEach(instance => {
  instance?.initialize().catch(err => console.error(`Initial init error for a suggestor:`, err));
});

