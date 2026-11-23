// The map on iOS and Android is a Leaflet document running in a WebView, and
// nothing else in the suite can reach it: it is a string in a React component,
// so a bundler will happily ship it broken.
//
// These tests extract that document, run its script against a stub Leaflet and
// check the message protocol the app depends on. They do not prove the map
// draws — only a device shows that — but they do prove the document parses,
// opens where it is meant to, keeps the attribution OSM requires, and reports
// bounds, taps and a failed load in the shape JobMap expects.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = new URL('../src/components/JobMap.js', import.meta.url);

// The constants JobMap interpolates into the document. Kept here rather than
// imported because importing the component would pull in react-native.
const VALUES = {
  CSS_URL: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  JS_URL: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  TILE_URL: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  ATTRIBUTION: '(c) OpenStreetMap contributors',
  START_CENTER: [39.83, -98.58],
  START_ZOOM: 4,
  MAX_ZOOM: 18,
  LOAD_FAILED: 'Could not load the map library. Check the network connection.',
  colors: { canvas: '#FFFDF7' },
};

/** The document string, built the way the component builds it. */
function readDocument() {
  const src = readFileSync(SOURCE, 'utf8');
  const open = 'const MAP_DOCUMENT = `';
  const start = src.indexOf(open);
  assert.ok(start >= 0, 'JobMap still declares MAP_DOCUMENT');
  const from = start + open.length;
  const to = src.indexOf('`;', from);
  assert.ok(to > from, 'MAP_DOCUMENT template is terminated');

  const names = Object.keys(VALUES);
  const build = new Function(...names, 'return `' + src.slice(from, to) + '`');
  return build(...names.map((name) => VALUES[name]));
}

/** The one script in the document that has no src, i.e. ours. */
function inlineScript(html) {
  const found = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(found.length, 1, 'the document has exactly one inline script');
  return found[0][1];
}

/** A Leaflet stand-in that records what the document asks it to draw. */
function stubLeaflet() {
  const calls = [];
  const handlers = {};

  const map = {
    setView: (center, zoom) => { calls.push({ call: 'setView', center, zoom }); return map; },
    on: (event, fn) => { handlers[event] = fn; },
    getBounds: () => ({ toBBoxString: () => '-125,24,-66,50' }),
    pan: () => handlers.moveend?.(),
  };

  const markers = [];
  const layer = {
    markers,
    clearLayers: () => { markers.length = 0; },
    tap: (index) => markers[index].onClick?.(),
  };

  const L = {
    map: (id, options) => { calls.push({ call: 'map', id, options }); return map; },
    tileLayer: (url, options) => ({ addTo: () => calls.push({ call: 'tileLayer', url, options }) }),
    layerGroup: () => ({ addTo: () => layer }),
    divIcon: (options) => ({ divIcon: options }),
    marker: (position, options) => {
      const marker = { position, options, onClick: null };
      marker.on = (event, fn) => { if (event === 'click') marker.onClick = fn; };
      marker.bindTooltip = (text) => { marker.tooltip = text; };
      marker.addTo = () => markers.push(marker);
      return marker;
    },
  };

  return { L, map, layer, calls };
}

/** Run the document's script the way a WebView would. */
function runDocument({ leafletLoaded = true } = {}) {
  const messages = [];
  const { L, map, layer, calls } = stubLeaflet();

  const window = {
    ReactNativeWebView: { postMessage: (json) => messages.push(JSON.parse(json)) },
  };
  // An absent L is how a failed CDN fetch presents itself.
  if (leafletLoaded) window.L = L;

  const code = inlineScript(readDocument());
  // `with (window)` makes the document's bare `L` resolve off window, the way
  // a browser global would.
  vm.runInContext(`with (window) { ${code} }`, vm.createContext({ window }));

  return { messages, window, map, layer, calls };
}

// Values built inside the vm carry that realm's prototypes, so deepEqual
// rejects them on identity alone. Compare the values.
const sameValue = (actual, expected, message) =>
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);

test('the document is a parseable page that loads Leaflet', () => {
  const html = readDocument();
  assert.ok(html.startsWith('<!doctype html>'), 'has a doctype, so no quirks mode');
  assert.ok(html.includes('<div id="map">'), 'has the container the script mounts into');
  assert.ok(html.includes(VALUES.JS_URL), 'loads Leaflet');
  assert.ok(html.includes(VALUES.CSS_URL), 'loads Leaflet styles');
  assert.ok(html.includes('width=device-width'), 'sets a viewport, or a phone renders it at desktop width');
});

test('it announces itself and its opening viewport', () => {
  const { messages } = runDocument();
  assert.deepEqual(messages[0], { type: 'ready' });
  // Unprompted, because the app cannot ask for pins until it knows the bounds.
  assert.deepEqual(messages[1], { type: 'bounds', bbox: '-125,24,-66,50' });
});

test('it opens where the component says, with the attribution OSM requires', () => {
  const { calls } = runDocument();

  const view = calls.find((entry) => entry.call === 'setView');
  sameValue(view.center, VALUES.START_CENTER, 'opens on the configured centre');
  assert.equal(view.zoom, VALUES.START_ZOOM);

  const tiles = calls.find((entry) => entry.call === 'tileLayer');
  assert.equal(tiles.url, VALUES.TILE_URL);
  assert.equal(tiles.options.maxZoom, VALUES.MAX_ZOOM);
  assert.equal(tiles.options.attribution, VALUES.ATTRIBUTION,
    'the OSM tile usage policy requires attribution');
});

test('pins arrive by injection and replace the previous set', () => {
  const { window, layer } = runDocument();
  assert.equal(typeof window.setGroups, 'function', 'JobMap injects a call to this');

  window.setGroups([
    { key: '40.75,-73.98', latitude: 40.75, longitude: -73.98, badge: '<div>3</div>' },
    { key: '47.61,-122.33', latitude: 47.61, longitude: -122.33, badge: '<div>1</div>' },
  ]);

  assert.equal(layer.markers.length, 2, 'one marker per group');
  sameValue(layer.markers[0].position, [40.75, -73.98]);
  assert.equal(layer.markers[0].options.icon.divIcon.html, '<div>3</div>',
    'draws the badge the component computed, so both platforms show the same pin');

  // Filtering sends a new set. Stacking them would leave stale pins behind.
  window.setGroups([{ key: 'x', latitude: 1, longitude: 2, badge: '<div>9</div>' }]);
  assert.equal(layer.markers.length, 1);
});

test('a tap reports the group key and nothing else', () => {
  const { window, layer, messages } = runDocument();
  window.setGroups([{ key: '40.75,-73.98', latitude: 40.75, longitude: -73.98, badge: '' }]);

  layer.tap(0);

  // The key, not the postings: the WebView is never sent whole listings, and
  // the app resolves the key against the jobs it already holds.
  assert.deepEqual(messages.at(-1), { type: 'select', key: '40.75,-73.98' });
});

test('panning reports the new bounds', () => {
  const { map, messages } = runDocument();
  const before = messages.length;

  map.pan();

  assert.deepEqual(messages[before], { type: 'bounds', bbox: '-125,24,-66,50' });
});

test('a failed Leaflet load is reported, not left as a blank frame', () => {
  const { messages } = runDocument({ leafletLoaded: false });
  assert.deepEqual(messages, [{ type: 'error', message: VALUES.LOAD_FAILED }]);
});
