/**
 * Copyright 2017 Google Inc. All rights reserved.
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

let os = require('os');
let https = require('https');
let fs = require('fs');
let path = require('path');
let extract = require('extract-zip');
let util = require('util');
let URL = require('url');

let CHROMIUM_PATH = path.join(__dirname, '..', '.local-chromium');

let downloadURLs = {
  linux: 'https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/%d/chrome-linux.zip',
  mac: 'https://storage.googleapis.com/chromium-browser-snapshots/Mac/%d/chrome-mac.zip',
  win32: 'https://storage.googleapis.com/chromium-browser-snapshots/Win/%d/chrome-win32.zip',
  win64: 'https://storage.googleapis.com/chromium-browser-snapshots/Win_x64/%d/chrome-win32.zip',
};

module.exports = {
  /**
     * @return {!Array<string>}
     */
  supportedPlatforms: function() {
    return Object.keys(downloadURLs);
  },

  /**
     * @return {string}
     */
  currentPlatform: function() {
    let platform = os.platform();
    if (platform === 'darwin')
      return 'mac';
    if (platform === 'linux')
      return 'linux';
    if (platform === 'win32')
      return os.arch() === 'x64' ? 'win64' : 'win32';
    return '';
  },

  /**
     * @param {string} platform
     * @param {string} revision
     * @return {!Promise<boolean>}
     */
  canDownloadRevision: function(platform, revision) {
    console.assert(downloadURLs[platform], 'Unknown platform: ' + platform);
    let url = URL.parse(util.format(downloadURLs[platform], revision));
    let options = {
      method: 'HEAD',
      host: url.host,
      path: url.pathname,
    };
    let resolve;
    let promise = new Promise(x => resolve = x);
    let request = https.request(options, response => {
      resolve(response.statusCode === 200);
    });
    request.on('error', error => {
      console.error(error);
      resolve(false);
    });
    request.end();
    return promise;
  },

  /**
     * @param {string} platform
     * @param {string} revision
     * @param {?function(number, number)} progressCallback
     * @return {!Promise}
     */
  downloadRevision: async function(platform, revision, progressCallback) {
    let url = downloadURLs[platform];
    console.assert(url, `Unsupported platform: ${platform}`);
    url = util.format(url, revision);
    let zipPath = path.join(CHROMIUM_PATH, `download-${platform}-${revision}.zip`);
    let folderPath = getFolderPath(platform, revision);
    if (fs.existsSync(folderPath))
      return;
    try {
      if (!fs.existsSync(CHROMIUM_PATH))
        fs.mkdirSync(CHROMIUM_PATH);
      await downloadFile(url, zipPath, progressCallback);
      await extractZip(zipPath, folderPath);
    } finally {
      if (fs.existsSync(zipPath))
        fs.unlinkSync(zipPath);
    }
  },

  /**
     * @param {string} platform
     * @param {string} revision
     * @return {?{executablePath: string}}
     */
  revisionInfo: function(platform, revision) {
    let folderPath = getFolderPath(platform, revision);
    if (!fs.existsSync(folderPath))
      return null;
    let executablePath = '';
    if (platform === 'mac')
      executablePath = path.join(folderPath, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
    else if (platform === 'linux')
      executablePath = path.join(folderPath, 'chrome-linux', 'chrome');
    else if (platform === 'win32' || platform === 'win64')
      executablePath = path.join(folderPath, 'chrome-win32', 'chrome.exe');
    else
      throw 'Unsupported platfrom: ' + platfrom;
    return {
      executablePath: executablePath
    };
  },
};

/**
 * @param {string} platform
 * @param {number} revision
 * @return {string}
 */
function getFolderPath(platform, revision) {
  return path.join(CHROMIUM_PATH, platform + '-' + revision);
}

/**
 * @param {string} url
 * @param {string} destinationPath
 * @param {?function(number, number)} progressCallback
 * @return {!Promise}
 */
function downloadFile(url, destinationPath, progressCallback) {
  let fulfill, reject;
  let promise = new Promise((x, y) => { fulfill = x; reject = y; });
  let request = https.get(url, response => {
    if (response.statusCode !== 200) {
      let error = new Error(`Download failed: server returned code ${response.statusCode}. URL: ${url}`);
      // consume response data to free up memory
      response.resume();
      reject(error);
      return;
    }
    let file = fs.createWriteStream(destinationPath);
    file.on('finish', () => fulfill());
    file.on('error', error => reject(error));
    response.pipe(file);
    let totalBytes = parseInt(response.headers['content-length'], 10);
    if (progressCallback)
      response.on('data', onData.bind(null, totalBytes));
  });
  request.on('error', error => reject(error));
  return promise;

  function onData(totalBytes, chunk) {
    progressCallback(totalBytes, chunk.length);
  }
}

/**
 * @param {string} zipPath
 * @param {string} folderPath
 * @return {!Promise<?Error>}
 */
function extractZip(zipPath, folderPath) {
  return new Promise(fulfill => extract(zipPath, {dir: folderPath}, fulfill));
}