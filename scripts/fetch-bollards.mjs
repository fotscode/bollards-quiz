#!/usr/bin/env node
/**
 * Fetches bollard metadata from geohints.com/meta/bollards and writes public/bollards.json
 */
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const SOURCE_URL = "https://geohints.com/meta/bollards";
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "..", "public", "bollards.json");
const CONCURRENCY = 12;
const skipResolve = process.argv.includes("--skip-resolve");

const ENTRY_RE =
  /<span class="font-bold">\s*([^<]+?)\s*<\/span>\s*<img[^>]+src="([^"]+)"[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>\s*Open in Google Maps\s*<\/a>/gi;
const CONTINENT_RE =
  /<div class="text-center text-3xl font-bold">([^<]+)<\/div>/g;

function parseCoordsFromRedirect(location) {
  if (!location) return null;
  const m = location.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  return { lat: Number(m[1]), lng: Number(m[2]) };
}

async function resolveCoords(mapsUrl) {
  const res = await fetch(mapsUrl, { redirect: "manual" });
  const location = res.headers.get("location");
  const coords = parseCoordsFromRedirect(location);
  if (!coords) return { lat: null, lng: null, mapsViewUrl: mapsUrl };
  return {
    lat: coords.lat,
    lng: coords.lng,
    mapsViewUrl: location.split("?")[0],
  };
}

async function mapPool(items, fn, limit) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

function parseEntries(html) {
  const entries = [];
  const parts = html.split(CONTINENT_RE);

  if (parts.length > 1) {
    for (let i = 1; i < parts.length; i += 2) {
      const continent = parts[i].trim();
      const block = parts[i + 1] ?? "";
      let m;
      ENTRY_RE.lastIndex = 0;
      while ((m = ENTRY_RE.exec(block)) !== null) {
        const imageUrl = m[2].trim();
        const idMatch = imageUrl.match(/bollard_(\d+)\.jpg/);
        entries.push({
          id: idMatch ? Number(idMatch[1]) : entries.length,
          country: m[1].trim(),
          continent,
          imageUrl,
          mapsUrl: m[3].trim(),
          lat: null,
          lng: null,
          mapsViewUrl: null,
        });
      }
    }
  } else {
    let m;
    ENTRY_RE.lastIndex = 0;
    while ((m = ENTRY_RE.exec(html)) !== null) {
      const imageUrl = m[2].trim();
      const idMatch = imageUrl.match(/bollard_(\d+)\.jpg/);
      entries.push({
        id: idMatch ? Number(idMatch[1]) : entries.length,
        country: m[1].trim(),
        continent: "Unknown",
        imageUrl,
        mapsUrl: m[3].trim(),
        lat: null,
        lng: null,
        mapsViewUrl: null,
      });
    }
  }

  return entries;
}

async function main() {
  console.log(`Fetching ${SOURCE_URL}…`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
  const html = await res.text();
  const entries = parseEntries(html);
  console.log(`Parsed ${entries.length} bollards`);

  if (!skipResolve) {
    console.log(`Resolving coordinates (${CONCURRENCY} concurrent)…`);
    let resolved = 0;
    await mapPool(
      entries,
      async (entry, i) => {
        const coords = await resolveCoords(entry.mapsUrl);
        entry.lat = coords.lat;
        entry.lng = coords.lng;
        entry.mapsViewUrl = coords.mapsViewUrl;
        if (coords.lat != null) resolved++;
        if ((i + 1) % 100 === 0 || i + 1 === entries.length) {
          console.log(`  ${i + 1}/${entries.length} (${resolved} with coordinates)`);
        }
      },
      CONCURRENCY,
    );
    console.log(`Resolved coordinates for ${resolved}/${entries.length}`);
  }

  const countries = [...new Set(entries.map((e) => e.country))].sort();
  const byContinent = {};
  for (const e of entries) {
    (byContinent[e.continent] ??= new Set()).add(e.country);
  }
  for (const k of Object.keys(byContinent)) {
    byContinent[k] = [...byContinent[k]].sort();
  }

  const data = {
    source: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    count: entries.length,
    countries,
    byContinent,
    entries,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(data, null, 2));
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
