import { countryName } from '@/lib/countries';

/**
 * Where a runner runs, as their profile keeps it: a city and a country (ISO 3166-1 alpha-2), both shown
 * with the profile, and an optional neighbourhood that only the runner sees unless they choose to show
 * it. Detection runs once on the phone with its own geocoder; the runner can edit every part.
 */
export interface HomePlace {
  city: string | null;
  countryCode: string | null;
  area: string | null;
}

/** The parts of the phone geocoder's answer that are used (expo-location `reverseGeocodeAsync`). */
export interface GeocodedPlace {
  city?: string | null;
  /** The neighbourhood (Android sub-locality, iOS subLocality), for example Gulistan-e-Johar. */
  district?: string | null;
  subregion?: string | null;
  region?: string | null;
  country?: string | null;
  isoCountryCode?: string | null;
}

/** Longest city or area name the server keeps. */
export const PLACE_MAX = 60;

/** Trimmed, inner spaces collapsed, at most 60 characters; null when blank. */
export function cleanPlace(s: string | null | undefined): string | null {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, PLACE_MAX).trim() : null;
}

/** A two-letter country code in upper case, or null. */
export function cleanCountry(code: string | null | undefined): string | null {
  const c = (code ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/**
 * The city, country and neighbourhood a geocoder result names. Without a city the county or province
 * stands in; the neighbourhood is dropped when it only repeats the city.
 */
export function placeFromGeocode(g: GeocodedPlace | null | undefined): HomePlace {
  const city = cleanPlace(g?.city) ?? cleanPlace(g?.subregion) ?? cleanPlace(g?.region);
  let area = cleanPlace(g?.district);
  if (area && city && area.toLowerCase() === city.toLowerCase()) area = null;
  return { city, countryCode: cleanCountry(g?.isoCountryCode), area };
}

/**
 * How a place reads: "Gulistan-e-Johar, Karachi, Pakistan", with only the parts that are known. A city
 * saved before countries were kept may already end with the country, which is then not repeated.
 */
export function placeText(city: string | null | undefined, countryCode: string | null | undefined, area?: string | null): string | null {
  const c = cleanPlace(city);
  const country = countryName(cleanCountry(countryCode));
  const parts = [cleanPlace(area), c];
  if (country && !(c && (c.toLowerCase() === country.toLowerCase() || c.toLowerCase().endsWith(`, ${country.toLowerCase()}`)))) parts.push(country);
  return parts.filter(Boolean).join(', ') || null;
}

/** Same matching as the server's city key: case and extra spaces do not matter. */
export function sameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = cleanPlace(a)?.toLowerCase();
  return Boolean(ka) && ka === cleanPlace(b)?.toLowerCase();
}
