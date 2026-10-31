#!/usr/bin/env node
// Plattformuavhengige hjelpere for Android-emulatoren (macOS, Windows, Linux).
//
//   node scripts/android.mjs emu    – start emulator (om ingen kjører) og vent til den har bootet
//   node scripts/android.mjs start  – start emulator i bakgrunnen (om ingen kjører), uten å vente
//   node scripts/android.mjs go     – adb reverse + åpne appen i Expo Go
//   node scripts/android.mjs info   – vis SDK-sti, verktøy og AVD-er
//
// SDK finnes via ANDROID_HOME / ANDROID_SDK_ROOT, ellers standardstien for plattformen.
// AVD velges fra ANDROID_AVD, ellers den første i `emulator -list-avds`.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {Record<string, string | undefined>} Env */

/** @param {Env} [env] */
export function defaultSdkPaths(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
    return [path.win32.join(localAppData, 'Android', 'Sdk')];
  }
  if (platform === 'darwin') return [path.posix.join(home, 'Library', 'Android', 'sdk')];
  return [path.posix.join(home, 'Android', 'Sdk'), path.posix.join(home, 'Android', 'sdk')];
}

/** @param {{ platform?: string, env?: Env, home?: string, exists?: (p: string) => boolean }} [opts] */
export function findSdk({ platform = process.platform, env = process.env, home = os.homedir(), exists = existsSync } = {}) {
  const candidates = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, ...defaultSdkPaths(platform, env, home)].filter(Boolean);
  return candidates.find((p) => exists(p)) ?? null;
}

export function toolPath(sdk, tool, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const ext = platform === 'win32' ? '.exe' : '';
  const dir = tool === 'adb' ? 'platform-tools' : 'emulator';
  return p.join(sdk, dir, tool + ext);
}

// Nyere emulatorer kan skrive INFO/WARNING-linjer på stdout; behold bare AVD-navn.
export function parseAvds(output) {
  return output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.includes('|') && !/\s/.test(l));
}

export function hasRunningEmulator(adbDevicesOutput) {
  return adbDevicesOutput.split(/\r?\n/).some((l) => /^emulator-\d+\s+device\b/.test(l.trim()));
}

function sdkOrExit() {
  const sdk = findSdk();
  if (!sdk) {
    console.error(
      'Fant ikke Android SDK. Sett ANDROID_HOME, eller installer SDK-en på standardstien:\n  ' +
        defaultSdkPaths().join('\n  '),
    );
    process.exit(1);
  }
  return { sdk, adb: toolPath(sdk, 'adb'), emulator: toolPath(sdk, 'emulator') };
}

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8' });
}

function listAvds(emulator) {
  return parseAvds(run(emulator, ['-list-avds']).stdout ?? '');
}

function pickAvd(emulator) {
  if (process.env.ANDROID_AVD) return process.env.ANDROID_AVD;
  const avd = listAvds(emulator)[0];
  if (!avd) {
    console.error('Fant ingen AVD. Opprett en i Android Studio (Device Manager) eller sett ANDROID_AVD.');
    process.exit(1);
  }
  return avd;
}

function ensureEmulator({ adb, emulator }) {
  if (hasRunningEmulator(run(adb, ['devices']).stdout ?? '')) return;
  const avd = pickAvd(emulator);
  console.log(`Starter emulator ${avd}`);
  const args = ['-avd', avd, '-no-metrics', '-memory', '2048', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect'];
  spawn(emulator, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function waitForBoot(adb) {
  for (;;) {
    if (run(adb, ['shell', 'getprop', 'sys.boot_completed']).stdout?.trim() === '1') return;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function adbOrExit(adb, args) {
  const res = spawnSync(adb, args, { stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

async function main(cmd) {
  const tools = sdkOrExit();
  switch (cmd) {
    case 'emu':
      ensureEmulator(tools);
      await waitForBoot(tools.adb);
      console.log('Emulator klar');
      break;
    case 'start':
      ensureEmulator(tools);
      break;
    case 'go':
      adbOrExit(tools.adb, ['reverse', 'tcp:8081', 'tcp:8081']);
      adbOrExit(tools.adb, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://127.0.0.1:8081']);
      break;
    case 'info':
      console.log(`SDK:      ${tools.sdk}`);
      console.log(`adb:      ${tools.adb}${existsSync(tools.adb) ? '' : ' (mangler)'}`);
      console.log(`emulator: ${tools.emulator}${existsSync(tools.emulator) ? '' : ' (mangler)'}`);
      console.log(`AVD-er:   ${listAvds(tools.emulator).join(', ') || '(ingen)'}`);
      console.log(`Valgt:    ${process.env.ANDROID_AVD || listAvds(tools.emulator)[0] || '(ingen)'}`);
      break;
    default:
      console.error('Bruk: node scripts/android.mjs <emu|start|go|info>');
      process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2]);
}
