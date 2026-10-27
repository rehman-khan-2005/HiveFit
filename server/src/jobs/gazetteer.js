// A small offline gazetteer: place name -> coordinates.
//
// Only Adzuna resolves coordinates for us. Amazon and Greenhouse give a city
// string ("Seattle, WA", "Dublin", "AU, NSW, Sydney"), so those need resolving
// before they can appear on a map.
//
// Bundled rather than looked up over the network, for three reasons: it is
// free and instant, it has no rate limit to respect (Nominatim's policy caps
// bulk use at one request a second), and a job board's locations are
// overwhelmingly major metros — a few hundred entries cover almost the whole
// pool. Anything unresolved stays off the map and in the list, which is the
// right failure: a pin in the wrong city is worse than no pin.
//
// Coordinates are city centroids to ~4 decimal places. That is the honest
// precision: a posting says "Seattle", not a street address, so the pin means
// "a job in this city" and the map is zoomed to match.

// city key -> [lat, lng]. Keys are normalized: lowercase, punctuation
// stripped, so "New York, NY" and "new-york ny" both land here.
const CITIES = {
  // --- United States, by metro size ---
  'new york': [40.7128, -74.0060], 'brooklyn': [40.6782, -73.9442],
  'los angeles': [34.0522, -118.2437], 'chicago': [41.8781, -87.6298],
  'houston': [29.7604, -95.3698], 'phoenix': [33.4484, -112.0740],
  'philadelphia': [39.9526, -75.1652], 'san antonio': [29.4241, -98.4936],
  'san diego': [32.7157, -117.1611], 'dallas': [32.7767, -96.7970],
  'austin': [30.2672, -97.7431], 'san jose': [37.3382, -121.8863],
  'fort worth': [32.7555, -97.3308], 'jacksonville': [30.3322, -81.6557],
  'columbus': [39.9612, -82.9988], 'charlotte': [35.2271, -80.8431],
  'indianapolis': [39.7684, -86.1581], 'san francisco': [37.7749, -122.4194],
  'seattle': [47.6062, -122.3321], 'denver': [39.7392, -104.9903],
  'washington': [38.9072, -77.0369], 'boston': [42.3601, -71.0589],
  'nashville': [36.1627, -86.7816], 'detroit': [42.3314, -83.0458],
  'portland': [45.5152, -122.6784], 'las vegas': [36.1699, -115.1398],
  'memphis': [35.1495, -90.0490], 'louisville': [38.2527, -85.7585],
  'baltimore': [39.2904, -76.6122], 'milwaukee': [43.0389, -87.9065],
  'albuquerque': [35.0844, -106.6504], 'tucson': [32.2226, -110.9747],
  'fresno': [36.7378, -119.7871], 'sacramento': [38.5816, -121.4944],
  'kansas city': [39.0997, -94.5786], 'mesa': [33.4152, -111.8315],
  'atlanta': [33.7490, -84.3880], 'omaha': [41.2565, -95.9345],
  'colorado springs': [38.8339, -104.8214], 'raleigh': [35.7796, -78.6382],
  'virginia beach': [36.8529, -75.9780], 'long beach': [33.7701, -118.1937],
  'miami': [25.7617, -80.1918], 'oakland': [37.8044, -122.2712],
  'minneapolis': [44.9778, -93.2650], 'tulsa': [36.1540, -95.9928],
  'bakersfield': [35.3733, -119.0187], 'wichita': [37.6872, -97.3301],
  'arlington': [32.7357, -97.1081], 'aurora': [39.7294, -104.8319],
  'tampa': [27.9506, -82.4572], 'new orleans': [29.9511, -90.0715],
  'cleveland': [41.4993, -81.6944], 'honolulu': [21.3099, -157.8581],
  'anaheim': [33.8366, -117.9143], 'lexington': [38.0406, -84.5037],
  'stockton': [37.9577, -121.2908], 'corpus christi': [27.8006, -97.3964],
  'henderson': [36.0395, -114.9817], 'riverside': [33.9806, -117.3755],
  'newark': [40.7357, -74.1724], 'saint paul': [44.9537, -93.0900],
  'santa ana': [33.7455, -117.8677], 'cincinnati': [39.1031, -84.5120],
  'irvine': [33.6846, -117.8265], 'orlando': [28.5383, -81.3792],
  'pittsburgh': [40.4406, -79.9959], 'st louis': [38.6270, -90.1994],
  'greensboro': [36.0726, -79.7920], 'lincoln': [40.8136, -96.7026],
  'plano': [33.0198, -96.6989], 'anchorage': [61.2181, -149.9003],
  'durham': [35.9940, -78.8986], 'jersey city': [40.7178, -74.0431],
  'chandler': [33.3062, -111.8413], 'madison': [43.0731, -89.4012],
  'buffalo': [42.8864, -78.8784], 'chula vista': [32.6401, -117.0842],
  'reno': [39.5296, -119.8138], 'boise': [43.6150, -116.2023],
  'richmond': [37.5407, -77.4360], 'salt lake city': [40.7608, -111.8910],
  'des moines': [41.5868, -93.6250], 'fayetteville': [35.0527, -78.8784],
  'scottsdale': [33.4942, -111.9261], 'spokane': [47.6588, -117.4260],
  'tacoma': [47.2529, -122.4443], 'bellevue': [47.6101, -122.2015],
  'redmond': [47.6740, -122.1215], 'mountain view': [37.3861, -122.0839],
  'palo alto': [37.4419, -122.1430], 'sunnyvale': [37.3688, -122.0363],
  'santa clara': [37.3541, -121.9552], 'cupertino': [37.3230, -122.0322],
  'menlo park': [37.4530, -122.1817], 'cambridge': [42.3736, -71.1097],
  'arlington va': [38.8816, -77.0910], 'alexandria': [38.8048, -77.0469],
  'reston': [38.9586, -77.3570], 'bethesda': [38.9847, -77.0947],
  'ann arbor': [42.2808, -83.7430], 'boulder': [40.0150, -105.2705],
  'provo': [40.2338, -111.6585], 'chattanooga': [35.0456, -85.3097],
  'huntsville': [34.7304, -86.5861], 'rochester': [43.1566, -77.6088],
  'syracuse': [43.0481, -76.1474], 'albany': [42.6526, -73.7562],
  'hartford': [41.7658, -72.6734], 'providence': [41.8240, -71.4128],
  'charleston': [32.7765, -79.9311], 'savannah': [32.0809, -81.0912],
  'birmingham': [33.5186, -86.8104], 'little rock': [34.7465, -92.2896],
  'oklahoma city': [35.4676, -97.5164], 'el paso': [31.7619, -106.4850],

  // --- International tech hubs ---
  'toronto': [43.6532, -79.3832], 'vancouver': [49.2827, -123.1207],
  'montreal': [45.5019, -73.5674], 'ottawa': [45.4215, -75.6972],
  'calgary': [51.0447, -114.0719], 'waterloo': [43.4643, -80.5204],
  'london': [51.5074, -0.1278], 'manchester': [53.4808, -2.2426],
  'edinburgh': [55.9533, -3.1883], 'dublin': [53.3498, -6.2603],
  'berlin': [52.5200, 13.4050], 'munich': [48.1351, 11.5820],
  'hamburg': [53.5511, 9.9937], 'frankfurt': [50.1109, 8.6821],
  'paris': [48.8566, 2.3522], 'amsterdam': [52.3676, 4.9041],
  'madrid': [40.4168, -3.7038], 'barcelona': [41.3874, 2.1686],
  'lisbon': [38.7223, -9.1393], 'milan': [45.4642, 9.1900],
  'rome': [41.9028, 12.4964], 'zurich': [47.3769, 8.5417],
  'stockholm': [59.3293, 18.0686], 'copenhagen': [55.6761, 12.5683],
  'oslo': [59.9139, 10.7522], 'helsinki': [60.1699, 24.9384],
  'warsaw': [52.2297, 21.0122], 'krakow': [50.0647, 19.9450],
  'prague': [50.0755, 14.4378], 'budapest': [47.4979, 19.0402],
  'bucharest': [44.4268, 26.1025], 'vienna': [48.2082, 16.3738],
  'brussels': [50.8503, 4.3517], 'tel aviv': [32.0853, 34.7818],
  'haifa': [32.7940, 34.9896], 'bangalore': [12.9716, 77.5946],
  'bengaluru': [12.9716, 77.5946], 'hyderabad': [17.3850, 78.4867],
  'pune': [18.5204, 73.8567], 'mumbai': [19.0760, 72.8777],
  'chennai': [13.0827, 80.2707], 'delhi': [28.7041, 77.1025],
  'gurgaon': [28.4595, 77.0266], 'noida': [28.5355, 77.3910],
  'singapore': [1.3521, 103.8198], 'tokyo': [35.6762, 139.6503],
  'osaka': [34.6937, 135.5023], 'seoul': [37.5665, 126.9780],
  'hong kong': [22.3193, 114.1694], 'shanghai': [31.2304, 121.4737],
  'beijing': [39.9042, 116.4074], 'shenzhen': [22.5431, 114.0579],
  'taipei': [25.0330, 121.5654], 'sydney': [-33.8688, 151.2093],
  'melbourne': [-37.8136, 144.9631], 'brisbane': [-27.4698, 153.0251],
  'perth': [-31.9505, 115.8605], 'auckland': [-36.8485, 174.7633],
  'wellington': [-41.2866, 174.7756], 'sao paulo': [-23.5505, -46.6333],
  'rio de janeiro': [-22.9068, -43.1729], 'buenos aires': [-34.6037, -58.3816],
  'santiago': [-33.4489, -70.6693], 'bogota': [4.7110, -74.0721],
  'mexico city': [19.4326, -99.1332], 'guadalajara': [20.6597, -103.3496],
  'monterrey': [25.6866, -100.3161], 'cape town': [-33.9249, 18.4241],
  'johannesburg': [-26.2041, 28.0473], 'nairobi': [-1.2921, 36.8219],
  'lagos': [6.5244, 3.3792], 'cairo': [30.0444, 31.2357],
  'dubai': [25.2048, 55.2708], 'istanbul': [41.0082, 28.9784],
};

// Region centroids, for a posting that names only a state or province. Coarse
// by design: a pin in the middle of Texas says "somewhere in Texas", which is
// all the posting said.
const REGIONS = {
  alabama: [32.806, -86.791], alaska: [61.370, -152.404], arizona: [33.729, -111.431],
  arkansas: [34.969, -92.373], california: [36.116, -119.681], colorado: [39.059, -105.311],
  connecticut: [41.597, -72.755], delaware: [39.318, -75.507], florida: [27.766, -81.686],
  georgia: [33.040, -83.643], hawaii: [21.094, -157.498], idaho: [44.240, -114.478],
  illinois: [40.349, -88.986], indiana: [39.849, -86.258], iowa: [42.011, -93.210],
  kansas: [38.526, -96.726], kentucky: [37.668, -84.670], louisiana: [31.169, -91.867],
  maine: [44.693, -69.381], maryland: [39.064, -76.802], massachusetts: [42.230, -71.530],
  michigan: [43.326, -84.536], minnesota: [45.694, -93.900], mississippi: [32.741, -89.678],
  missouri: [38.456, -92.288], montana: [46.921, -110.454], nebraska: [41.125, -98.268],
  nevada: [38.313, -117.055], 'new hampshire': [43.452, -71.563], 'new jersey': [40.298, -74.521],
  'new mexico': [34.840, -106.248], 'new york state': [42.165, -74.948], 'north carolina': [35.630, -79.806],
  'north dakota': [47.528, -99.784], ohio: [40.388, -82.764], oklahoma: [35.565, -96.928],
  oregon: [44.572, -122.071], pennsylvania: [40.590, -77.209], 'rhode island': [41.680, -71.511],
  'south carolina': [33.856, -80.945], 'south dakota': [44.299, -99.439], tennessee: [35.747, -86.692],
  texas: [31.054, -97.563], utah: [40.150, -111.862], vermont: [44.045, -72.710],
  virginia: [37.769, -78.170], 'west virginia': [38.491, -80.954], wisconsin: [44.268, -89.616],
  wyoming: [42.756, -107.302], 'district of columbia': [38.897, -77.026],
  'new south wales': [-31.840, 145.612], victoria: [-36.857, 144.281],
  ontario: [51.253, -85.323], 'british columbia': [53.726, -127.648], quebec: [52.939, -73.549],
  england: [52.356, -1.174], scotland: [56.490, -4.203], wales: [52.133, -3.783],
};

// Country centroids, the last resort before giving up.
const COUNTRIES = {
  us: [39.828, -98.579], usa: [39.828, -98.579], 'united states': [39.828, -98.579],
  ca: [56.130, -106.347], can: [56.130, -106.347], canada: [56.130, -106.347],
  gb: [55.378, -3.436], uk: [55.378, -3.436], 'united kingdom': [55.378, -3.436],
  ie: [53.413, -8.244], irl: [53.413, -8.244], ireland: [53.413, -8.244],
  de: [51.166, 10.452], deu: [51.166, 10.452], germany: [51.166, 10.452],
  fr: [46.228, 2.214], fra: [46.228, 2.214], france: [46.228, 2.214],
  in: [20.594, 78.963], ind: [20.594, 78.963], india: [20.594, 78.963],
  au: [-25.274, 133.775], aus: [-25.274, 133.775], australia: [-25.274, 133.775],
  jp: [36.205, 138.253], jpn: [36.205, 138.253], japan: [36.205, 138.253],
  il: [31.046, 34.852], isr: [31.046, 34.852], israel: [31.046, 34.852],
  sg: [1.352, 103.820], sgp: [1.352, 103.820], singapore: [1.352, 103.820],
  nl: [52.133, 5.291], nld: [52.133, 5.291], netherlands: [52.133, 5.291],
  es: [40.464, -3.749], esp: [40.464, -3.749], spain: [40.464, -3.749],
  pl: [51.919, 19.145], pol: [51.919, 19.145], poland: [51.919, 19.145],
  br: [-14.235, -51.925], bra: [-14.235, -51.925], brazil: [-14.235, -51.925],
  mx: [23.635, -102.553], mex: [23.635, -102.553], mexico: [23.635, -102.553],
};

// US state abbreviations, since boards write both "WA" and "Washington".
const STATE_ABBR = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california',
  co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia',
  hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
  ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
  ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi',
  mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire',
  nj: 'new jersey', nm: 'new mexico', ny: 'new york state', nc: 'north carolina',
  nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania',
  ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee',
  tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington state',
  wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming', dc: 'district of columbia',
  nsw: 'new south wales', vic: 'victoria', 'on': 'ontario', bc: 'british columbia',
  qc: 'quebec',
};

// Seattle the city and Washington the state collide on the word "washington".
// A posting saying "Washington, DC" means the capital; "Washington" alone
// after a city name means the state.
REGIONS['washington state'] = [47.401, -121.491];

const REMOTE = /\b(remote|anywhere|work from home|wfh|telecommute|distributed|virtual)\b/i;

/** Lowercase, strip punctuation, collapse whitespace. */
function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a location string to coordinates.
 *
 * Tried most specific first: the whole string as a city, then each
 * comma-separated part as a city, then a region, then a country. A remote
 * posting resolves to nothing on purpose — it has no place to pin.
 *
 * @param {string} location
 * @param {string[]} [area] a provider's structured location, coarse-to-fine
 * @returns {{latitude: number, longitude: number, precision: string}|null}
 */
export function locate(location, area = []) {
  const raw = String(location ?? '');
  if (!raw.trim() && area.length === 0) return null;

  // Remote is not a place. Pinning it to a country centroid would put a fake
  // cluster in the middle of Kansas.
  if (REMOTE.test(raw)) return null;

  // Provider-structured area is ordered country -> region -> ... -> city, so
  // the most specific element is last.
  const parts = [
    ...[...area].reverse(),
    ...raw.split(/[,/|·]/),
  ].map(normalize).filter(Boolean);

  for (const part of parts) {
    if (CITIES[part]) {
      const [latitude, longitude] = CITIES[part];
      return { latitude, longitude, precision: 'city' };
    }
  }

  for (const part of parts) {
    const expanded = STATE_ABBR[part] ?? part;
    if (REGIONS[expanded]) {
      const [latitude, longitude] = REGIONS[expanded];
      return { latitude, longitude, precision: 'region' };
    }
  }

  for (const part of parts) {
    if (COUNTRIES[part]) {
      const [latitude, longitude] = COUNTRIES[part];
      return { latitude, longitude, precision: 'country' };
    }
  }

  return null;
}

/** How many places the bundled gazetteer knows, for the README to stay honest. */
export function gazetteerSize() {
  return {
    cities: Object.keys(CITIES).length,
    regions: Object.keys(REGIONS).length,
    countries: new Set(Object.values(COUNTRIES).map(String)).size,
  };
}
