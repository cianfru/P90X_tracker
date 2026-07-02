/*
 * Geocoding for the training map. Location labels in the log are free text the
 * owner types — city names, IATA codes, or a place + "casa" (home). We resolve
 * each to a known place with coordinates so the map can plot where every
 * session happened. Unknown labels return null (they stay in the data, just
 * off the map). Built-in table — no network, works offline.
 */

export interface Place {
  key: string
  name: string
  country: string
  lat: number
  lon: number
}

// Canonical places (key → coords). Coordinates are city-centre, good enough
// for a dot on a world map.
const PLACES: Record<string, Omit<Place, 'key'>> = {
  doha: { name: 'Doha', country: 'Qatar', lat: 25.2854, lon: 51.531 },
  lusail: { name: 'Lusail', country: 'Qatar', lat: 25.4106, lon: 51.4917 },
  bangkok: { name: 'Bangkok', country: 'Thailand', lat: 13.7563, lon: 100.5018 },
  huahin: { name: 'Hua Hin', country: 'Thailand', lat: 12.5684, lon: 99.9577 },
  phuket: { name: 'Phuket', country: 'Thailand', lat: 7.8804, lon: 98.3923 },
  phnompenh: { name: 'Phnom Penh', country: 'Cambodia', lat: 11.5564, lon: 104.9282 },
  siemreap: { name: 'Siem Reap', country: 'Cambodia', lat: 13.3611, lon: 103.8598 },
  sihanoukville: {
    name: 'Sihanoukville',
    country: 'Cambodia',
    lat: 10.6104,
    lon: 103.529,
  },
  rome: { name: 'Rome', country: 'Italy', lat: 41.9028, lon: 12.4964 },
  olbia: { name: 'Olbia', country: 'Italy', lat: 40.9236, lon: 9.4989 },
  pescasseroli: {
    name: 'Pescasseroli',
    country: 'Italy',
    lat: 41.7906,
    lon: 13.7906,
  },
  madrid: { name: 'Madrid', country: 'Spain', lat: 40.4168, lon: -3.7038 },
  barcelona: { name: 'Barcelona', country: 'Spain', lat: 41.3851, lon: 2.1734 },
  toulouse: { name: 'Toulouse', country: 'France', lat: 43.6047, lon: 1.4442 },
  london: { name: 'London', country: 'UK', lat: 51.5072, lon: -0.1276 },
  amsterdam: { name: 'Amsterdam', country: 'Netherlands', lat: 52.3676, lon: 4.9041 },
  athens: { name: 'Athens', country: 'Greece', lat: 37.9838, lon: 23.7275 },
  spata: { name: 'Spata', country: 'Greece', lat: 37.9583, lon: 23.9167 },
  larnaca: { name: 'Larnaca', country: 'Cyprus', lat: 34.9182, lon: 33.6221 },
  belgrade: { name: 'Belgrade', country: 'Serbia', lat: 44.7866, lon: 20.4489 },
  bucharest: { name: 'Bucharest', country: 'Romania', lat: 44.4268, lon: 26.1025 },
  zagreb: { name: 'Zagreb', country: 'Croatia', lat: 45.815, lon: 15.9819 },
  dubai: { name: 'Dubai', country: 'UAE', lat: 25.2048, lon: 55.2708 },
  shanghai: { name: 'Shanghai', country: 'China', lat: 31.2304, lon: 121.4737 },
  shenyang: { name: 'Shenyang', country: 'China', lat: 41.8057, lon: 123.4315 },
  shenzhen: { name: 'Shenzhen', country: 'China', lat: 22.5431, lon: 114.0579 },
  jieyang: { name: 'Jieyang', country: 'China', lat: 23.5498, lon: 116.3728 },
  shijiazhuang: {
    name: 'Shijiazhuang',
    country: 'China',
    lat: 38.0428,
    lon: 114.5149,
  },
  nagpur: { name: 'Nagpur', country: 'India', lat: 21.1458, lon: 79.0882 },
  trivandrum: {
    name: 'Trivandrum',
    country: 'India',
    lat: 8.5241,
    lon: 76.9366,
  },
  calicut: { name: 'Calicut', country: 'India', lat: 11.2588, lon: 75.7804 },
  zanzibar: { name: 'Zanzibar', country: 'Tanzania', lat: -6.1659, lon: 39.2026 },
  palma: { name: 'Palma', country: 'Spain', lat: 39.5696, lon: 2.6502 },
}

// Alias → place key. Covers the historical labels (cities, IATA codes, and
// common misspellings). Matched against the label with home/gym suffixes and
// separators stripped, so "Bkk casa", "Bkk247", "BKK 247" all map via "bkk".
const ALIAS: Record<string, string> = {
  doha: 'doha', doh: 'doha', lusail: 'lusail',
  bkk: 'bangkok', bangkok: 'bangkok',
  huah: 'huahin', hua: 'huahin', huahin: 'huahin', hhq: 'huahin',
  phuket: 'phuket', hkt: 'phuket',
  pnh: 'phnompenh', pp: 'phnompenh', phnompenh: 'phnompenh',
  rep: 'siemreap', siemreap: 'siemreap',
  kos: 'sihanoukville', sihanouk: 'sihanoukville', sihanoukville: 'sihanoukville',
  roma: 'rome', rome: 'rome', rm: 'rome',
  olbia: 'olbia', ol: 'olbia', olb: 'olbia', okbia: 'olbia', obx: 'olbia',
  palma: 'palma', pmi: 'palma',
  pescass: 'pescasseroli', pesca: 'pescasseroli', pescas: 'pescasseroli',
  pescasseroli: 'pescasseroli',
  madrid: 'madrid', mad: 'madrid',
  barcellona: 'barcelona', barcelona: 'barcelona', bcn: 'barcelona',
  toulouse: 'toulouse', tls: 'toulouse',
  london: 'london', lon: 'london', ldn: 'london',
  ams: 'amsterdam', amsterdam: 'amsterdam',
  athens: 'athens', ath: 'athens', spata: 'spata',
  larnaca: 'larnaca', lca: 'larnaca',
  belgrado: 'belgrade', belgrade: 'belgrade', beg: 'belgrade',
  bucarest: 'bucharest', bucharest: 'bucharest', otp: 'bucharest',
  zagreb: 'zagreb', zag: 'zagreb',
  dubai: 'dubai', dxb: 'dubai',
  shanghai: 'shanghai', pudong: 'shanghai', pvg: 'shanghai',
  shenyang: 'shenyang', shenzhen: 'shenzhen', jieyang: 'jieyang',
  shijia: 'shijiazhuang', shijiazhuang: 'shijiazhuang',
  nagpur: 'nagpur', nag: 'nagpur',
  trv: 'trivandrum', trivandrum: 'trivandrum',
  ccj: 'calicut', calicut: 'calicut',
  znz: 'zanzibar', zanzibar: 'zanzibar',
}

// Words that describe *where within* a place (home, gym, quarantine, a specific
// venue) rather than the place itself — stripped before matching.
const SUFFIX =
  /\b(casa|cas|home|quar|condo|comdo|gym|hun|hunh|hunu|huh|sf|mess|va|eur|fra|247|24|7|dopo|inj|c)\b/g
const HOME = /\b(casa|cas|home)\b/

export interface ResolvedLocation extends Place {
  home: boolean
  raw: string
}

function haversineKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * Nearest known place to a coordinate, within `maxKm`. Used to turn a GPS fix
 * captured at workout start into a familiar location label. null if nowhere
 * known is close enough (then we keep the raw coordinates only).
 */
export function nearestPlace(
  lat: number,
  lon: number,
  maxKm = 150,
): Place | null {
  let best: Place | null = null
  let bestKm = Infinity
  for (const [key, p] of Object.entries(PLACES)) {
    const km = haversineKm(lat, lon, p.lat, p.lon)
    if (km < bestKm) {
      bestKm = km
      best = { key, ...p }
    }
  }
  return best && bestKm <= maxKm ? best : null
}

/** Resolve a raw location label to a known place, or null if unrecognised. */
export function resolveLocation(raw: string): ResolvedLocation | null {
  const label = raw.trim()
  if (!label) return null
  const low = label.toLowerCase()
  const home = HOME.test(low)
  // Try the whole cleaned string, then each token, against the alias table.
  const cleaned = low
    .replace(/[/.,]/g, ' ')
    .replace(/\d+/g, ' ') // drop glued digits like the "247" in "bkk247"
    .replace(SUFFIX, ' ')
    .trim()
  const candidates = [cleaned.replace(/\s+/g, ''), ...cleaned.split(/\s+/), low]
  let key: string | undefined
  for (const c of candidates) {
    if (c && ALIAS[c]) {
      key = ALIAS[c]
      break
    }
  }
  if (!key) return null
  return { key, ...PLACES[key], home, raw }
}
