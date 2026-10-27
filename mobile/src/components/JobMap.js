// Leaflet map of the job pool, for the web build.
//
// Why Leaflet and not react-native-maps: react-native-maps has no web
// renderer, and the web portal is what this project demos. Why not the Google
// Maps JavaScript API: it needs a billing account with a card on file, and the
// rest of this app runs with no paid keys. OpenStreetMap tiles need neither,
// and give real pan and zoom.
//
// Leaflet is loaded from a CDN at runtime rather than installed, so nothing is
// added to package.json and the native build does not have to carry a library
// it cannot use. react-native-web renders a View as a div, so the ref is a
// real DOM node and Leaflet can mount into it directly.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Platform } from 'react-native';
import { colors, spacing, type } from '../theme';

const LEAFLET_VERSION = '1.9.4';
const CSS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const JS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;

/** Load Leaflet once, however many maps mount. */
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
      reject(new Error('Could not load the map library. Check the network connection.'));
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

/**
 * @param {object[]} jobs      postings with latitude/longitude
 * @param {function} onBounds  called with Leaflet's "minLng,minLat,maxLng,maxLat"
 * @param {function} onSelect  called with the postings at a clicked pin
 */
export function JobMap({ jobs = [], onBounds, onSelect, height = 320 }) {
  const container = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  // Kept in a ref so the moveend handler, registered once, always calls the
  // current callback rather than the one captured on first render.
  const onBoundsRef = useRef(onBounds);
  onBoundsRef.current = onBounds;

  useEffect(() => {
    if (Platform.OS !== 'web' || !container.current) return undefined;

    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !container.current || map.current) return;

        map.current = L.map(container.current, {
          // Scroll-wheel zoom hijacks page scrolling on a long form; the
          // buttons and double-click still zoom.
          scrollWheelZoom: false,
        }).setView([39.83, -98.58], 4);

        L.tileLayer(`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`, {
          maxZoom: 18,
          // Required by the OSM tile usage policy.
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map.current);

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

    for (const group of cluster(jobs)) {
      const marker = L.marker([group.latitude, group.longitude], {
        icon: L.divIcon({
          html: markerHtml(group.jobs.length),
          className: '',
          iconSize: null,
        }),
      });

      const first = group.jobs[0];
      marker.bindTooltip(
        group.jobs.length === 1
          ? `${first.title}${first.company ? ` · ${first.company}` : ''}`
          : `${group.jobs.length} jobs · ${first.location ?? ''}`,
        { direction: 'top' }
      );
      marker.on('click', () => onSelect?.(group.jobs));
      marker.addTo(layer.current);
    }
  }, [jobs, ready, onSelect]);

  if (Platform.OS !== 'web') {
    return (
      <View style={{
        height, borderRadius: 10, borderWidth: 1, borderColor: colors.line,
        alignItems: 'center', justifyContent: 'center', padding: spacing.md,
      }}>
        <Text style={[type.body, { textAlign: 'center' }]}>
          The map runs in the web build.
        </Text>
        <Text style={[type.small, { textAlign: 'center', marginTop: spacing.xs }]}>
          Press w in Expo to open it. On device, use the list view.
        </Text>
      </View>
    );
  }

  return (
    <View>
      <View
        ref={container}
        style={{
          height,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: colors.line,
          overflow: 'hidden',
          backgroundColor: colors.canvas,
        }}
      />
      {error ? <Text style={[type.small, { color: colors.danger, marginTop: 4 }]}>{error}</Text> : null}
      {!ready && !error ? <Text style={[type.small, { marginTop: 4 }]}>Loading map…</Text> : null}
    </View>
  );
}
