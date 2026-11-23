// Working out where the API lives, from the point of view of whatever is
// running this code.
//
// `localhost` means "this device". On a laptop that is the same machine as the
// server, so the configured default is right. On a phone it is the handset, and
// the request leaves for port 4000 on the phone where nothing is listening —
// which is the first thing that breaks when the web app is run on a device.
//
// Kept apart from client.js, and free of any react-native import, so the rules
// below can be tested without a bundler.

const LOOPBACK = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)$/i;
const ADDRESS = /^(https?:\/\/)([^/:]+)(:\d+)?(.*)$/i;

/** The bare host out of whatever shape Expo reports. */
export function hostOf(candidate) {
  if (!candidate) return null;
  // Shapes seen in practice: "192.168.1.8:8081", "exp://192.168.1.8:8081",
  // "192.168.1.8:8081/--/path". Strip scheme, then path, then port.
  const host = String(candidate)
    .replace(/^[a-z+.-]+:\/\//i, '')
    .split('/')[0]
    .replace(/:\d+$/, '');
  return host || null;
}

/**
 * The machine serving the JS bundle, as the device can reach it.
 *
 * Expo publishes this because the device has to fetch the bundle from that
 * machine, so whatever address works for the bundle works for the API. Reading
 * it beats asking the team to look up their own IP every time the campus
 * network hands them a new one.
 */
export function devServerHost(candidates = []) {
  for (const candidate of candidates) {
    const host = hostOf(candidate);
    if (host && !LOOPBACK.test(host)) return host;
  }
  return null;
}

/**
 * @param {string}   override        EXPO_PUBLIC_API_URL, if set
 * @param {string}   configured      expo.extra.apiBaseUrl from app.json
 * @param {string}   platform        Platform.OS
 * @param {string[]} hostCandidates  Expo's reported dev server addresses
 */
export function resolveApiBase({
  override,
  configured = 'http://localhost:4000/api',
  platform = 'web',
  hostCandidates = [],
} = {}) {
  // An explicit URL wins outright: it is how a build handed to someone off the
  // LAN points at a deployed server. Expo inlines EXPO_PUBLIC_* at bundle
  // time, so in a release build this is fixed rather than looked up.
  if (override) return String(override).replace(/\/+$/, '');

  // In a browser, localhost is the machine the server is on. Nothing to do.
  if (platform === 'web') return configured;

  const match = ADDRESS.exec(configured);
  if (!match) return configured;

  const [, scheme, host, port = '', path = ''] = match;

  // A real hostname was configured, so it was meant. Only loopback is wrong
  // on a device.
  if (!LOOPBACK.test(host)) return configured;

  const lan = devServerHost(hostCandidates);
  // No dev server to borrow an address from, which is a release build. Leave
  // the configured value so the failure names it.
  return lan ? `${scheme}${lan}${port}${path}` : configured;
}
