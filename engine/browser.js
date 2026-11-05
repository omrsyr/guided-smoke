'use strict';
// Which installed browser to drive. Playwright drives Chrome and Edge through their installed channels, so nothing is
// downloaded. Order: --browser if given, else the system's default browser when it is Chrome or Edge, else Chrome, else Edge.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const CHANNELS = { chrome: 'chrome', edge: 'msedge' };

function run(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
}

/** 'chrome' | 'edge' | null — the system default, when it is one of the two. */
function systemDefault() {
  if (process.platform === 'win32') {
    const out = run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId']);
    if (/ChromeHTML/i.test(out)) return 'chrome';
    if (/MSEdgeHTM/i.test(out)) return 'edge';
    return null;
  }
  if (process.platform === 'darwin') {
    const out = run('defaults', ['read', path.join(os.homedir(), 'Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure'), 'LSHandlers']);
    const https = out.split('}').find(block => /LSHandlerURLScheme = https;/.test(block)) || '';
    if (/com\.google\.chrome/i.test(https)) return 'chrome';
    if (/com\.microsoft\.edgemac/i.test(https)) return 'edge';
    return null;
  }
  const out = run('xdg-settings', ['get', 'default-web-browser']);
  if (/chrome/i.test(out)) return 'chrome';
  if (/edge/i.test(out)) return 'edge';
  return null;
}

function installed(browser) {
  const paths = {
    win32: {
      chrome: [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')],
      edge: [path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe')],
    },
    darwin: {
      chrome: ['/Applications/Google Chrome.app', path.join(os.homedir(), 'Applications/Google Chrome.app')],
      edge: ['/Applications/Microsoft Edge.app', path.join(os.homedir(), 'Applications/Microsoft Edge.app')],
    },
  };
  const list = (paths[process.platform] || {})[browser];
  if (list) return list.some(p => p && fs.existsSync(p));
  const bins = { chrome: ['google-chrome', 'google-chrome-stable'], edge: ['microsoft-edge', 'microsoft-edge-stable'] }[browser] || [];
  return bins.some(b => run('which', [b]).trim());
}

/** Resolves the browser to use; throws with a readable message when none is available. */
function choose(requested) {
  if (requested) {
    const key = String(requested).toLowerCase();
    if (!CHANNELS[key]) throw new Error(`Unknown browser "${requested}". Use chrome or edge.`);
    if (!installed(key)) throw new Error(`${key === 'edge' ? 'Microsoft Edge' : 'Google Chrome'} is not installed on this machine.`);
    return { name: key, channel: CHANNELS[key], source: 'requested' };
  }
  const def = systemDefault();
  if (def && installed(def)) return { name: def, channel: CHANNELS[def], source: 'system default' };
  for (const name of ['chrome', 'edge']) {
    if (installed(name)) return { name, channel: CHANNELS[name], source: 'fallback' };
  }
  throw new Error('Neither Google Chrome nor Microsoft Edge is installed. Install one of them and run again.');
}

// --video needs Playwright's own ffmpeg build, the one download beside playwright-core, fetched only on request
// (setup --video). Playwright knows where it goes (PLAYWRIGHT_BROWSERS_PATH or its cache folder), so ask it instead of
// repeating its rules; a finished download leaves INSTALLATION_COMPLETE in that folder.
function playwrightCli(runtimeDir) {
  return path.join(path.dirname(require.resolve('playwright-core/package.json', { paths: [runtimeDir] })), 'cli.js');
}

function ffmpegFolder(runtimeDir) {
  const r = spawnSync(process.execPath, [playwrightCli(runtimeDir), 'install', '--dry-run', 'ffmpeg'], { encoding: 'utf8' });
  const m = /Install location:\s*(.+)/.exec(r.stdout || '');
  return m ? m[1].trim() : null;
}

function videoReady(runtimeDir) {
  try {
    const dir = ffmpegFolder(runtimeDir);
    return !!dir && fs.existsSync(path.join(dir, 'INSTALLATION_COMPLETE'));
  } catch { return false; }
}

function installFfmpeg(runtimeDir) {
  return spawnSync(process.execPath, [playwrightCli(runtimeDir), 'install', 'ffmpeg'], { stdio: 'inherit' }).status === 0;
}

module.exports = { choose, systemDefault, installed, CHANNELS, ffmpegFolder, videoReady, installFfmpeg };
