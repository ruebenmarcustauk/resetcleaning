// Shared helpers for the booking functions.
// Secrets live in Netlify environment variables, never in the page:
//   GHL_TOKEN (or GHL) Private Integration token (Settings → Private Integrations)
//   GHL_LOCATION_ID  Sub-account (location) ID
//   GHL_CALENDAR_ID  Calendar customers book into
const pricing = require("../../booking/pricing.json");

const GHL_BASE = "https://services.leadconnectorhq.com";

function config() {
  const token = process.env.GHL_TOKEN || process.env.GHL;
  const locationId = process.env.GHL_LOCATION_ID;
  const calendarId = process.env.GHL_CALENDAR_ID;
  if (!token || !locationId || !calendarId) return null;
  return { token, locationId, calendarId };
}

async function ghl(cfg, method, path, { version, query, body } = {}) {
  const url = new URL(GHL_BASE + path);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Version: version,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`GHL ${method} ${path} failed with ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Customer price for a clean. Returns { base, quote } where quote=true means
// the price must be confirmed manually (regular/deep over 5 bedrooms).
function quote(serviceId, bedrooms) {
  const s = pricing.services[serviceId];
  if (!s) return null;
  const beds = Number(bedrooms);
  if (!Number.isInteger(beds) || beds < 1 || beds > pricing.maxBedrooms) return null;
  if (beds <= 5) {
    return {
      base: s.prices[String(beds)],
      includedHours: s.includedHours ? s.includedHours[String(beds)] : null,
      quote: false,
    };
  }
  if (s.over5.type === "perBedroom") {
    return { base: s.prices["5"] + (beds - 5) * s.over5.amount, includedHours: null, quote: false };
  }
  return { base: null, includedHours: null, quote: true };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

module.exports = { pricing, config, ghl, quote, json };
