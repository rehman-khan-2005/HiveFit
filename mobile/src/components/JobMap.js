// Leaflet map of the job pool, on web and on device.
//
// Why Leaflet and not react-native-maps: react-native-maps has no web
// renderer, and the web portal is also how this project demos. Why not the
// Google Maps JavaScript API: it needs a billing account with a card on file,
// and the rest of this app runs with no paid keys. OpenStreetMap tiles need
// neither, and give real pan and zoom.
//
// Leaflet is loaded from a CDN at runtime rather than installed, so nothing is
// added to package.json. On web, react-native-web renders a View as a div, so
// the ref is a real DOM node and Leaflet mounts into it directly. On iOS and
// Android the same Leaflet calls run inside a WebView.
//
// Clustering, the pin badge and the tooltip text are computed here, once, and
// handed to whichever renderer is mounted. Two copies of that logic would
// drift, and the map is the one screen where the two platforms are supposed to
// agree about what is where.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Platform, Linking } from 'react-native';
import { colors, spacing, type } from '../theme';

// Required rather than imported so the web build never evaluates it. On web
// react-native-webview resolves to a stub that renders nothing, and reaching
// it would be a silently blank map.
const WebView = Platform.OS === 'web' ? null : require('react-native-webview').WebView;

const LEAFLET_VERSION = '1.9.4';
const CSS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const JS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
// Required by the OSM tile usage policy.
const ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Continental US, far enough out that a first load shows the whole pool.
const START_CENTER = [39.83, -98.58];
const START_ZOOM = 4;
const MAX_ZOOM = 18;

// Legal inside a JSON string, illegal as JS source. JSON.stringify leaves
// them raw, and the result is injected into the WebView as source.
const JS_LINE_SEPARATORS = new RegExp('[\u2028\u2029]', 'g');

const LOAD_FAILED = 'Could not load the map library. Check the network connection.';

/** Load Leaflet once, however many maps mount. Web only. */
let leafletPromise = null;
function loadLeaflet() {
  if (globalThis.L) return Promise.resolve(globalThis.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${CSS_URL}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CSS_URL;
      document.head.appendChild(link);
    }

    const script = document.createElement('script');
    script.src = JS_URL;
    script.async = true;
    script.onload = () => resolve(globalThis.L);
    script.onerror = () => {
      leafletPromise = null;
      reject(new Error(LOAD_FAILED));
    };
    document.head.appendChild(script);
  });
  return leafletPromise;
}

/**
 * Group postings that sit on top of each other.
 *
 * City-level coordinates mean every job in Seattle shares one point, so
 * without grouping the map is one pin hiding forty. Rounding to two decimals
 * (~1km) merges those without merging neighbouring towns.
 */
function cluster(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    if (job.latitude == null || job.longitude == null) continue;
    const key = `${Number(job.latitude).toFixed(2)},${Number(job.longitude).toFixed(2)}`;
    const group = groups.get(key) ?? {
      key,
      latitude: Number(job.latitude),
      longitude: Number(job.longitude),
      jobs: [],
    };
    group.jobs.push(job);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** A count badge, drawn as HTML so Leaflet's image assets are never needed. */
function markerHtml(count) {
  const size = count > 99 ? 38 : count > 9 ? 32 : 26;
  return `
    <div style="
      width:${size}px;height:${size}px;border-radius:${size}px;
      background:${colors.honeyDark};border:2px solid #fff;
      box-shadow:0 1px 4px rgba(0,0,0,.35);
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-weight:700;font-size:${count > 99 ? 12 : 13}px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    ">${count > 999 ? '999+' : count}</div>`;
}

// Job titles and company names come from third-party boards, and Leaflet
// inserts a tooltip string as HTML. Escaped so a posting cannot put markup
// into the page.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tooltipFor(group) {
  const first = group.jobs[0];
  if (group.jobs.length === 1) {
    const company = first.company ? ` · ${first.company}` : '';
    return escapeHtml(`${first.title}${company}`);
  }
  return escapeHtml(`${group.jobs.length} jobs · ${first.location ?? ''}`);
}

/** Clustered groups in the shape both renderers draw, plus a key lookup. */
function prepare(jobs) {
  const groups = [];
  const byKey = new Map();

  for (const group of cluster(jobs)) {
    groups.push({
      key: group.key,
      latitude: group.latitude,
      longitude: group.longitude,
      badge: markerHtml(group.jobs.length),
      tooltip: tooltipFor(group),
    });
    byKey.set(group.key, group.jobs);
  }
  return { groups, byKey };
}

const frame = (height) => ({
  height,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: colors.line,
  overflow: 'hidden',
  backgroundColor: colors.canvas,
});

/* ------------------------------------------------------------------ web ---- */

function WebLeaflet({ groups, onBounds, onSelectKey, height }) {
  const container = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  // Kept in refs so the handlers, registered once, always call the current
  // callback rather than the one captured on first render.
  const onBoundsRef = useRef(onBounds);
  onBoundsRef.current = onBounds;
  const onSelectRef = useRef(onSelectKey);
  onSelectRef.current = onSelectKey;

  useEffect(() => {
    if (!container.current) return undefined;

    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !container.current || map.current) return;

        map.current = L.map(container.current, {
          // Scroll-wheel zoom hijacks page scrolling on a long form; the
          // buttons and double-click still zoom.
          scrollWheelZoom: false,
        }).setView(START_CENTER, START_ZOOM);

        L.tileLayer(TILE_URL, { maxZoom: MAX_ZOOM, attribution: ATTRIBUTION })
          .addTo(map.current);

        layer.current = L.layerGroup().addTo(map.current);

        map.current.on('moveend', () => {
          onBoundsRef.current?.(map.current.getBounds().toBBoxString());
        });

        setReady(true);
        onBoundsRef.current?.(map.current.getBounds().toBBoxString());
      })
      .catch((err) => { if (!cancelled) setError(err.message); });

    return () => {
      cancelled = true;
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Redraw pins whenever the postings change.
  useEffect(() => {
    if (!ready || !layer.current || !globalThis.L) return;
    const L = globalThis.L;

    layer.current.clearLayers();

    for (const group of groups) {
      const marker = L.marker([group.latitude, group.longitude], {
        icon: L.divIcon({ html: group.badge, className: '', iconSize: null }),
      });
      marker.bindTooltip(group.tooltip, { direction: 'top' });
      marker.on('click', () => onSelectRef.current?.(group.key));
      marker.addTo(layer.current);
    }
  }, [groups, ready]);

  return (
    <View>
      <View ref={container} style={frame(height)} />
      {error ? <Text style={[type.small, { color: colors.danger, marginTop: 4 }]}>{error}</Text> : null}
      {!ready && !error ? <Text style={[type.small, { marginTop: 4 }]}>Loading map…</Text> : null}
    </View>
  );
}

/* --------------------------------------------------------------- native ---- */

// The document the WebView runs. Static, so it is built once: the pins arrive
// afterwards through setGroups, which means panning and filtering never reload
// the page or refetch Leaflet.
const MAP_DOCUMENT = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="${CSS_URL}" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: ${colors.canvas}; }
  #map { position: absolute; inset: 0; }
  .leaflet-container { background: ${colors.canvas}; }
</style>
</head>
<body>
<div id="map"></div>
<script src="${JS_URL}"></script>
<script>
  function post(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  // A failed external script is skipped and this one still runs, so an absent
  // L is how a CDN failure shows up.
  if (!window.L) {
    post({ type: 'error', message: ${JSON.stringify(LOAD_FAILED)} });
  } else {
    var map = L.map('map').setView(${JSON.stringify(START_CENTER)}, ${START_ZOOM});
    L.tileLayer(${JSON.stringify(TILE_URL)}, {
      maxZoom: ${MAX_ZOOM},
      attribution: ${JSON.stringify(ATTRIBUTION)}
    }).addTo(map);

    var layer = L.layerGroup().addTo(map);

    window.setGroups = function (groups) {
      layer.clearLayers();
      groups.forEach(function (group) {
        var marker = L.marker([group.latitude, group.longitude], {
          icon: L.divIcon({ html: group.badge, className: '', iconSize: null })
        });
        // Tap, not hover: a tooltip nobody can trigger is dead weight, so the
        // tap reports the group and the app draws the list below the map.
        marker.on('click', function () { post({ type: 'select', key: group.key }); });
        marker.addTo(layer);
      });
    };

    var report = function () {
      post({ type: 'bounds', bbox: map.getBounds().toBBoxString() });
    };
    map.on('moveend', report);

    post({ type: 'ready' });
    report();
  }
</script>
</body>
</html>`;

/**
 * Keep the WebView on our own document.
 *
 * Tiles and the Leaflet script are sub-loads, not navigations, so they never
 * reach here. What does is a tap on the OpenStreetMap attribution, which would
 * otherwise replace the map with openstreetmap.org and leave no way back.
 * That opens in the real browser instead.
 */
function allowNavigation(request) {
  const url = request.url ?? '';
  if (url === 'about:blank' || url.startsWith('data:') || url.startsWith('https://unpkg.com/')) {
    return true;
  }
  if (/^https?:\/\//i.test(url)) {
    Linking.openURL(url).catch(() => {});
  }
  return false;
}

function NativeLeaflet({ groups, onBounds, onSelectKey, height }) {
  const webview = useRef(null);
  const ready = useRef(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const onBoundsRef = useRef(onBounds);
  onBoundsRef.current = onBounds;
  const onSelectRef = useRef(onSelectKey);
  onSelectRef.current = onSelectKey;

  // U+2028 and U+2029 are legal inside a JSON string and illegal in JS source,
  // and this string is injected as source. A job title carrying one would
  // otherwise break the whole injection.
  const payload = useMemo(
    () => JSON.stringify(groups).replace(
      JS_LINE_SEPARATORS,
      (char) => '\\u' + char.charCodeAt(0).toString(16)
    ),
    [groups]
  );

  const push = useCallback(() => {
    if (!ready.current || !webview.current) return;
    // The trailing true keeps iOS from warning about a non-serializable result.
    webview.current.injectJavaScript(`window.setGroups(${payload}); true;`);
  }, [payload]);

  useEffect(() => { push(); }, [push]);

  const handleMessage = useCallback((event) => {
    let message;
    try { message = JSON.parse(event.nativeEvent.data); } catch { return; }

    if (message.type === 'ready') {
      ready.current = true;
      setLoaded(true);
      push();
    } else if (message.type === 'bounds') {
      onBoundsRef.current?.(message.bbox);
    } else if (message.type === 'select') {
      onSelectRef.current?.(message.key);
    } else if (message.type === 'error') {
      setError(message.message);
    }
  }, [push]);

  return (
    <View>
      <View style={frame(height)}>
        <WebView
          ref={webview}
          // baseUrl only names the document's origin — it is never fetched.
          // Without one, an HTML string has no origin of its own on iOS and
          // the request for Leaflet is refused.
          source={{ html: MAP_DOCUMENT, baseUrl: 'https://unpkg.com/' }}
          originWhitelist={['*']}
          onMessage={handleMessage}
          // Without this, dragging the map scrolls the page behind it.
          nestedScrollEnabled
          // The map fills its frame and has its own gestures; letting the
          // WebView bounce or scroll on top of that fights them.
          scrollEnabled={false}
          bounces={false}
          onShouldStartLoadWithRequest={allowNavigation}
          style={{ flex: 1, backgroundColor: colors.canvas }}
          onError={() => setError(LOAD_FAILED)}
        />
      </View>
      {error ? <Text style={[type.small, { color: colors.danger, marginTop: 4 }]}>{error}</Text> : null}
      {!loaded && !error ? <Text style={[type.small, { marginTop: 4 }]}>Loading map…</Text> : null}
    </View>
  );
}

/* ------------------------------------------------------------------- api --- */

/**
 * @param {object[]} jobs      postings with latitude/longitude
 * @param {function} onBounds  called with Leaflet's "minLng,minLat,maxLng,maxLat"
 * @param {function} onSelect  called with the postings at a tapped pin
 */
export function JobMap({ jobs = [], onBounds, onSelect, height = 320 }) {
  const { groups, byKey } = useMemo(() => prepare(jobs), [jobs]);

  // Only the group key crosses into the renderer, so the WebView is never sent
  // whole postings and both platforms resolve a tap the same way.
  const handleSelectKey = useCallback((key) => {
    const picked = byKey.get(key);
    if (picked) onSelect?.(picked);
  }, [byKey, onSelect]);

  if (Platform.OS !== 'web' && !WebView) {
    return (
      <View style={{ ...frame(height), alignItems: 'center', justifyContent: 'center', padding: spacing.md }}>
        <Text style={[type.body, { textAlign: 'center' }]}>The map needs react-native-webview.</Text>
        <Text style={[type.small, { textAlign: 'center', marginTop: spacing.xs }]}>
          Run `npx expo install react-native-webview`, then restart Expo.
        </Text>
      </View>
    );
  }

  const Renderer = Platform.OS === 'web' ? WebLeaflet : NativeLeaflet;
  return (
    <Renderer
      groups={groups}
      onBounds={onBounds}
      onSelectKey={handleSelectKey}
      height={height}
    />
  );
}
