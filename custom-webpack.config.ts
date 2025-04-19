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

import type {Configuration} from 'webpack';

module.exports = {
  entry: {
    background: {import: 'src/background.ts', runtime: false},
  },
  resolve: {
    fallback: {
      // Keep necessary fallbacks for Node core modules
      "path": require.resolve("path-browserify"),
      "zlib": require.resolve("browserify-zlib"),
      "crypto": require.resolve("crypto-browserify"),
      "fs": false,
      "assert": require.resolve("assert/"),
      "util": require.resolve("util/"),
      "os": require.resolve("os-browserify/browser"),
      "vm": require.resolve("vm-browserify"),
      "stream": require.resolve("stream-browserify"),
      "process": require.resolve("process/browser")
    }
  },
} as Configuration;
