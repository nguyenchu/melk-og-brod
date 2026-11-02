import { describe, expect, it } from 'vitest';
import { findSdk, hasRunningEmulator, parseAvds, toolPath } from './android.mjs';

describe('findSdk', () => {
  const all = () => true;

  it('foretrekker ANDROID_HOME, så ANDROID_SDK_ROOT', () => {
    expect(findSdk({ platform: 'darwin', env: { ANDROID_HOME: '/a', ANDROID_SDK_ROOT: '/b' }, home: '/h', exists: all })).toBe('/a');
    expect(findSdk({ platform: 'darwin', env: { ANDROID_SDK_ROOT: '/b' }, home: '/h', exists: all })).toBe('/b');
  });

  it('bruker standardstien på macOS og Windows', () => {
    expect(findSdk({ platform: 'darwin', env: {}, home: '/Users/x', exists: all })).toBe('/Users/x/Library/Android/sdk');
    expect(findSdk({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }, home: 'C:\\Users\\x', exists: all })).toBe(
      'C:\\Users\\x\\AppData\\Local\\Android\\Sdk',
    );
  });

  it('returnerer null når ingen sti finnes', () => {
    expect(findSdk({ platform: 'linux', env: {}, home: '/h', exists: () => false })).toBeNull();
  });
});

describe('toolPath', () => {
  it('legger til .exe på Windows', () => {
    expect(toolPath('C:\\sdk', 'adb', 'win32')).toBe('C:\\sdk\\platform-tools\\adb.exe');
    expect(toolPath('C:\\sdk', 'emulator', 'win32')).toBe('C:\\sdk\\emulator\\emulator.exe');
    expect(toolPath('/sdk', 'emulator', 'darwin')).toBe('/sdk/emulator/emulator');
  });
});

describe('parseAvds', () => {
  it('filtrerer bort INFO-linjer og CRLF', () => {
    expect(parseAvds('INFO    | Storing crashdata in: C:\\tmp\r\nFast\r\nPixel_8_API_35\r\n')).toEqual(['Fast', 'Pixel_8_API_35']);
  });
});

describe('hasRunningEmulator', () => {
  it('kjenner igjen en kjørende emulator', () => {
    expect(hasRunningEmulator('List of devices attached\nemulator-5554\tdevice\n')).toBe(true);
    expect(hasRunningEmulator('List of devices attached\nR58M123\tdevice\n')).toBe(false);
    expect(hasRunningEmulator('List of devices attached\n\n')).toBe(false);
  });
});
