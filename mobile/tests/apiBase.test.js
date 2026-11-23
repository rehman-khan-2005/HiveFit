// Where the app looks for the API. Getting this wrong does not degrade the
// app, it disconnects it, and the symptom on a phone is every screen failing
// at once — so the rules are pinned here rather than discovered on a device.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveApiBase, devServerHost, hostOf } from '../src/api/apiBase.js';

const LOCAL = 'http://localhost:4000/api';

test('on the web, localhost is correct and left alone', () => {
  assert.equal(
    resolveApiBase({ configured: LOCAL, platform: 'web', hostCandidates: ['192.168.1.8:8081'] }),
    LOCAL
  );
});

test('on a device, localhost becomes the machine serving the bundle', () => {
  for (const platform of ['ios', 'android']) {
    assert.equal(
      resolveApiBase({ configured: LOCAL, platform, hostCandidates: ['192.168.1.8:8081'] }),
      'http://192.168.1.8:4000/api',
      `${platform} keeps the API port and path, and takes only the host`
    );
  }
});

test('the port and path from app.json survive the substitution', () => {
  assert.equal(
    resolveApiBase({
      configured: 'http://127.0.0.1:8080/v2/api',
      platform: 'ios',
      hostCandidates: ['10.0.0.5:8081'],
    }),
    'http://10.0.0.5:8080/v2/api'
  );
});

test('a configured hostname is meant, so it is not second-guessed', () => {
  const deployed = 'https://api.hivefit.app/api';
  assert.equal(
    resolveApiBase({ configured: deployed, platform: 'ios', hostCandidates: ['192.168.1.8:8081'] }),
    deployed
  );
});

test('EXPO_PUBLIC_API_URL overrides everything, including on a device', () => {
  assert.equal(
    resolveApiBase({
      override: 'https://hivefit-api.onrender.com/api',
      configured: LOCAL,
      platform: 'android',
      hostCandidates: ['192.168.1.8:8081'],
    }),
    'https://hivefit-api.onrender.com/api',
    'this is how a build given to someone off the LAN reaches a real server'
  );
});

test('a trailing slash on the override does not become a double slash', () => {
  assert.equal(
    resolveApiBase({ override: 'https://example.com/api/', platform: 'ios' }),
    'https://example.com/api'
  );
});

test('with no dev server to borrow from, the configured value is kept', () => {
  // A release build with no override. Returning the configured address means
  // the connection error names it, which is the only clue the user gets.
  assert.equal(
    resolveApiBase({ configured: LOCAL, platform: 'ios', hostCandidates: [] }),
    LOCAL
  );
});

test('a loopback dev host is not a usable substitute', () => {
  // Expo reports localhost when started with --localhost, or on a simulator
  // sharing the host's network. Swapping localhost for localhost fixes
  // nothing, so the later candidates get a turn.
  assert.equal(
    devServerHost(['localhost:8081', '127.0.0.1:8081', '192.168.1.8:8081']),
    '192.168.1.8'
  );
  assert.equal(devServerHost(['localhost:8081']), null);
});

test('the host is pulled out of every shape Expo reports', () => {
  assert.equal(hostOf('192.168.1.8:8081'), '192.168.1.8');
  assert.equal(hostOf('exp://192.168.1.8:8081'), '192.168.1.8');
  assert.equal(hostOf('http://192.168.1.8:8081/--/path'), '192.168.1.8');
  assert.equal(hostOf('192.168.1.8:8081/--/'), '192.168.1.8');
  assert.equal(hostOf('hivefit://192.168.1.8:8081'), '192.168.1.8');
  assert.equal(hostOf(undefined), null);
  assert.equal(hostOf(''), null);
});

test('an unparseable address is passed through rather than mangled', () => {
  assert.equal(
    resolveApiBase({ configured: 'not-a-url', platform: 'ios', hostCandidates: ['192.168.1.8:8081'] }),
    'not-a-url'
  );
});

test('the default is the laptop demo, so an empty config still runs', () => {
  assert.equal(resolveApiBase(), LOCAL);
});
