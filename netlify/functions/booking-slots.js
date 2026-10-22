// GET /.netlify/functions/booking-slots?month=2026-11
// Returns available start times from the GoHighLevel calendar for that month:
//   { timezone, days: { "2026-11-03": ["2026-11-03T08:00:00+10:00", ...], ... } }
const { pricing, config, ghl, json } = require("../lib/booking");

exports.handler = async (event) => {
  const cfg = config();
  if (!cfg) return json(503, { error: "Online booking isn't set up yet." });

  const month = (event.queryStringParameters || {}).month || "";
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return json(400, { error: "month must look like 2026-11" });

  // Month boundaries in Gold Coast time (UTC+10, no daylight saving).
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const start = Date.UTC(year, mon - 1, 1) - 10 * 3600e3;
  const end = Date.UTC(year, mon, 1) - 10 * 3600e3 - 1;
  const from = Math.max(start, Date.now());
  if (from > end) return json(200, { timezone: pricing.timezone, days: {} });

  try {
    const data = await ghl(cfg, "GET", `/calendars/${cfg.calendarId}/free-slots`, {
      version: "2021-04-15",
      query: { startDate: from, endDate: end, timezone: pricing.timezone },
    });
    const days = {};
    Object.entries(data || {}).forEach(([day, v]) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && v && Array.isArray(v.slots) && v.slots.length) {
        days[day] = v.slots;
      }
    });
    return json(200, { timezone: pricing.timezone, days });
  } catch (err) {
    console.error(err.message, JSON.stringify(err.data));
    const d = err.data || {};
    // TEMP: list this account's calendars so the right ID can be set
    let calendars = null;
    try {
      const list = await ghl(cfg, "GET", "/calendars/", { version: "2021-04-15", query: { locationId: cfg.locationId } });
      calendars = (list.calendars || []).map((c) => ({ id: c.id, name: c.name, active: c.isActive }));
    } catch (e) {
      calendars = { status: e.status, message: [].concat((e.data || {}).message || "").join("; ") };
    }
    return json(502, {
      calendars,
      error: "Couldn't load availability. Please try again.",
      // TEMP: GoHighLevel's reason, for setup troubleshooting
      ghlStatus: err.status || null,
      ghlMessage: [].concat(d.message || d.error || d.msg || "").join("; ").slice(0, 200),
    });
  }
};
