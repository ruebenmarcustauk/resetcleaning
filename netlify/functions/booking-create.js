// POST /.netlify/functions/booking-create
// Creates (or updates) the contact in GoHighLevel, books the appointment on the
// calendar, and adds a note with the full booking details.
const { pricing, config, ghl, quote, json, startTimeAllowed, bookingStage, opportunityFields } = require("../lib/booking");

const clean = (v, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function money(n) {
  return "$" + (Number.isInteger(n) ? n : n.toFixed(2));
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  const cfg = config();
  if (!cfg) return json(503, { error: "Online booking isn't set up yet." });

  let b;
  try { b = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid request" }); }

  // Honeypot: real people never fill this hidden field.
  if (clean(b.company)) return json(200, { ok: true, bookingId: "ok" });

  const service = pricing.services[b.service];
  const q = quote(b.service, b.bedrooms);
  if (!service || !q) return json(400, { error: "Please choose a clean type and home size." });

  const frequency = service.frequencies.includes(b.frequency) ? b.frequency : service.frequencies[0];
  const bathrooms = Math.min(Math.max(parseInt(b.bathrooms, 10) || 1, 1), 6);
  const extraIds = Array.isArray(b.extras) ? b.extras : [];
  const extras = pricing.extras.filter((x) => extraIds.includes(x.id) && !x.includedIn.includes(b.service));
  const access = pricing.accessOptions.find((a) => a.id === b.access) || null;

  const c = b.contact || {};
  const firstName = clean(c.firstName, 60);
  const lastName = clean(c.lastName, 60);
  const email = clean(c.email, 120);
  const phone = clean(c.phone, 30);
  const street = clean(c.street, 150);
  const suburb = clean(c.suburb, 80);
  const postcode = clean(c.postcode, 10);
  const addrState = c.state === "NSW" ? "NSW" : "QLD";
  const notes = clean(c.notes, 1000);
  const accessDetails = clean(c.accessDetails, 300);

  if (!firstName || !phone || !email || !street) {
    return json(400, { error: "Please fill in your name, phone, email and address." });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Please check your email address." });

  const startMs = Date.parse(b.startTime);
  if (!startMs || startMs < Date.now() || !startTimeAllowed(b.startTime)) return json(400, { error: "Please choose a time." });

  // Each extra is charged as one hour at the clean type's extra-time rate.
  const extraHours = pricing.extraHoursEach || 1;
  const extraPrice = service.extraPerHour * extraHours;
  const extrasTotal = extras.length * extraPrice;
  const total = q.quote ? null : q.base + extrasTotal;
  const hours = q.includedHours ? q.includedHours + extras.length * extraHours : null;

  const freqLabel = pricing.frequencyLabels[frequency];
  const bedLabel = `${b.bedrooms} bed`;
  const priceText = q.quote
    ? "Clean to be quoted (over 5 bedrooms)" + (extras.length ? ` + extras ${money(extrasTotal)}` : "")
    : extras.length ? `${money(q.base)} clean + ${money(extrasTotal)} extras = ${money(total)}` : money(q.base);
  const address = suburb ? `${street}, ${suburb} ${addrState} ${postcode}`.trim() : street;
  const when = new Date(startMs).toLocaleString("en-AU", {
    timeZone: pricing.timezone, weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  const noteLines = [
    "WEBSITE BOOKING",
    `Service: ${service.label}`,
    `Frequency: ${freqLabel}`,
    `Size: ${bedLabel}, ${bathrooms} bath`,
    `Price: ${priceText}` + (hours ? ` (includes up to ${hours} hrs)` : ""),
    `Extra time rate: ${money(service.extraPerHour)}/hr, 30-min blocks, only with customer approval`,
    `Extras: ${extras.length ? extras.map((x) => `${x.label} (+${money(extraPrice)})`).join(", ") : "None"}`,
    `When: ${when}`,
    `Address: ${address}`,
    `Access: ${access ? access.label : "Not specified"}${accessDetails ? " - " + accessDetails : ""}`,
    `Customer notes: ${notes || "None"}`,
  ];

  try {
    const contactRes = await ghl(cfg, "POST", "/contacts/upsert", {
      version: "2021-07-28",
      body: {
        locationId: cfg.locationId,
        firstName,
        lastName,
        email,
        phone,
        address1: street,
        ...(suburb ? { city: suburb, state: addrState } : {}),
        ...(postcode ? { postalCode: postcode } : {}),
        country: "AU",
        source: "Website booking",
        tags: ["website booking", `${b.service} clean`],
      },
    });
    const contactId = contactRes && contactRes.contact && contactRes.contact.id;
    if (!contactId) throw new Error("No contact id returned");

    let appt;
    try {
      appt = await ghl(cfg, "POST", "/calendars/events/appointments", {
        version: "2021-04-15",
        body: {
          calendarId: cfg.calendarId,
          locationId: cfg.locationId,
          contactId,
          startTime: new Date(startMs).toISOString(),
          title: `${service.label} - ${bedLabel} - ${firstName} ${lastName}`.trim(),
          appointmentStatus: "confirmed",
          address,
          toNotify: true,
        },
      });
    } catch (err) {
      // GHL rejects times that are no longer free.
      if (/slot|available/i.test(JSON.stringify(err.data || ""))) {
        console.error(err.message, JSON.stringify(err.data));
        return json(409, { error: "Sorry, that time was just taken. Please choose another time." });
      }
      throw err;
    }

    const appointmentId = (appt && (appt.id || (appt.appointment && appt.appointment.id))) || null;

    // The booking exists at this point, so a failed note shouldn't fail the request.
    try {
      await ghl(cfg, "POST", `/contacts/${contactId}/notes`, {
        version: "2021-07-28",
        body: { body: noteLines.join("\n") },
      });
    } catch (err) {
      console.error("Note failed:", err.message, JSON.stringify(err.data));
    }

    // Add the booking to the Website Bookings pipeline. As above, the booking
    // already exists, so a failure here is logged rather than shown to the customer.
    let opportunity = false;
    try {
      const { pipelineId, stageId } = await bookingStage(cfg);
      const day = new Date(startMs).toLocaleDateString("en-AU", { timeZone: pricing.timezone, day: "numeric", month: "short" });
      const body = {
        locationId: cfg.locationId,
        pipelineId,
        pipelineStageId: stageId,
        contactId,
        name: `${service.label} - ${bedLabel} - ${firstName} ${lastName} (${day})`.trim(),
        status: "open",
        monetaryValue: total || 0,
        source: "Website booking",
      };

      // Fill the opportunity's custom fields (matched by name in GHL).
      let customFields = [];
      try {
        const fields = await opportunityFields(cfg);
        const values = {
          "clean type": service.label,
          "bedrooms": Number(b.bedrooms),
          "bathrooms": bathrooms,
          "frequency": freqLabel,
          "extras": extras.length ? extras.map((x) => x.label).join(", ") : "None",
          // Date fields take the clean's date in Gold Coast time (YYYY-MM-DD).
          "clean date": new Date(startMs + 10 * 3600e3).toISOString().slice(0, 10),
        };
        customFields = Object.entries(values)
          .filter(([name]) => fields[name])
          .map(([name, value]) => ({ id: fields[name].id, field_value: value }));
        const missing = Object.keys(values).filter((name) => !fields[name]);
        if (missing.length) console.error("Opportunity fields not found in GHL:", missing.join(", "));
      } catch (err) {
        console.error("Custom field lookup failed:", err.message, JSON.stringify(err.data));
      }

      try {
        await ghl(cfg, "POST", "/opportunities/", {
          version: "2021-07-28",
          body: customFields.length ? { ...body, customFields } : body,
        });
      } catch (err) {
        if (!customFields.length) throw err;
        // Don't lose the opportunity over a field problem: retry without the fields.
        console.error("Opportunity with fields failed, retrying without:", err.message, JSON.stringify(err.data));
        await ghl(cfg, "POST", "/opportunities/", { version: "2021-07-28", body });
      }
      opportunity = true;
    } catch (err) {
      console.error("Opportunity failed:", err.message, JSON.stringify(err.data));
    }

    return json(200, {
      ok: true,
      bookingId: appointmentId || contactId,
      value: total,
      opportunity,
    });
  } catch (err) {
    console.error(err.message, JSON.stringify(err.data));
    return json(502, { error: "Something went wrong booking your clean. Please try again or call us on 0494 427 135." });
  }
};
