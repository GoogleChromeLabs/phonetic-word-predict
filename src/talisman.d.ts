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


declare module 'talisman/phonetics/french/phonex' {
  const phonex: (text: string) => string;
  export default phonex;
}
declare module 'talisman/phonetics/french/soundex2' {
  const soundex2: (text: string) => string;
  export default soundex2;
}
declare module 'talisman/phonetics/french/fonem' {
  const fonem: (text: string) => string;
  export default fonem;
}
declare module 'talisman/phonetics/french/sonnex' {
  const sonnex: (text: string) => string;
  export default sonnex;
}
declare module 'talisman/phonetics/soundex' {
  const soundex: (text: string) => string;
  export default soundex;
}
declare module 'talisman/phonetics/metaphone' {
  const metaphone: (text: string) => string;
  export default metaphone;
}
