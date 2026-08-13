const ALLOWED_ORIGINS = new Set([
  "https://fatcatfablab.github.io",
  "http://localhost:4321",
  "http://127.0.0.1:4321",
]);

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function corsHeaders(request) {
  const origin = request.headers.get("origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request) },
  });
}

function cleanText(value, maxLength) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

function normalizeTitle(value) {
  return cleanText(value, 120).toLocaleLowerCase("en-US");
}

function validId(value) {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

function validEmail(value) {
  if (!value) return true;
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function parseBody(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new Error("JSON_REQUIRED");
  return request.json();
}

async function listWorkshops(request, env) {
  const participantId = new URL(request.url).searchParams.get("participantId");
  const { results } = await env.DB.prepare(`
    SELECT
      w.id,
      w.title,
      w.created_at AS createdAt,
      COUNT(r.participant_id) AS attendeeCount,
      COALESCE(
        json_group_array(
          CASE WHEN r.participant_id IS NOT NULL THEN
            json_object('id', p.id, 'firstName', p.first_name)
          END
        ) FILTER (WHERE r.participant_id IS NOT NULL),
        '[]'
      ) AS attendees,
      MAX(CASE WHEN r.participant_id = ?1 THEN 1 ELSE 0 END) AS isAttending
    FROM workshops w
    LEFT JOIN rsvps r ON r.workshop_id = w.id
    LEFT JOIN participants p ON p.id = r.participant_id
    GROUP BY w.id
    ORDER BY attendeeCount DESC, w.created_at DESC
  `).bind(participantId || "").all();

  return json(request, {
    workshops: results.map((row) => ({
      ...row,
      attendeeCount: Number(row.attendeeCount),
      attendees: JSON.parse(row.attendees || "[]"),
      isAttending: Boolean(row.isAttending),
    })),
    refreshedAt: new Date().toISOString(),
  });
}

async function createParticipant(request, env) {
  const body = await parseBody(request);
  const firstName = cleanText(body.firstName, 60);
  const email = cleanText(body.email, 254).toLowerCase() || null;
  if (!firstName) return json(request, { error: "First name is required." }, 400);
  if (!validEmail(email)) return json(request, { error: "Enter a valid email address or leave it blank." }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO participants (id, first_name, email) VALUES (?1, ?2, ?3)",
  ).bind(id, firstName, email).run();

  return json(request, { participant: { id, firstName, email } }, 201);
}

async function createWorkshop(request, env) {
  const body = await parseBody(request);
  const participantId = body.participantId;
  const title = cleanText(body.title, 120);
  const normalized = normalizeTitle(title);
  if (!validId(participantId)) return json(request, { error: "Your session has expired. Start again." }, 400);
  if (title.length < 2) return json(request, { error: "Enter a workshop idea or choose N/A." }, 400);

  const participant = await env.DB.prepare("SELECT id FROM participants WHERE id = ?1")
    .bind(participantId).first();
  if (!participant) return json(request, { error: "Your session has expired. Start again." }, 404);

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO workshops (id, title, normalized_title, suggested_by) VALUES (?1, ?2, ?3, ?4)",
    ).bind(id, title, normalized, participantId).run();
    return json(request, { workshop: { id, title } }, 201);
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) {
      const existing = await env.DB.prepare(
        "SELECT id, title FROM workshops WHERE normalized_title = ?1",
      ).bind(normalized).first();
      return json(request, { workshop: existing, existing: true }, 200);
    }
    throw error;
  }
}

async function saveRsvps(request, env) {
  const body = await parseBody(request);
  const participantId = body.participantId;
  const workshopIds = Array.isArray(body.workshopIds)
    ? [...new Set(body.workshopIds.filter(validId))].slice(0, 100)
    : [];
  if (!validId(participantId)) return json(request, { error: "Your session has expired. Start again." }, 400);

  const participant = await env.DB.prepare("SELECT id FROM participants WHERE id = ?1")
    .bind(participantId).first();
  if (!participant) return json(request, { error: "Your session has expired. Start again." }, 404);

  const statements = [
    env.DB.prepare("DELETE FROM rsvps WHERE participant_id = ?1").bind(participantId),
    ...workshopIds.map((workshopId) => env.DB.prepare(
      "INSERT INTO rsvps (workshop_id, participant_id) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM workshops WHERE id = ?1)",
    ).bind(workshopId, participantId)),
  ];
  await env.DB.batch(statements);
  return json(request, { saved: true, count: workshopIds.length });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      const headers = corsHeaders(request);
      return Object.keys(headers).length
        ? new Response(null, { status: 204, headers })
        : new Response(null, { status: 403 });
    }

    try {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET") {
        const row = await env.DB.prepare("SELECT 1 AS ok").first();
        return json(request, { ok: row?.ok === 1 });
      }
      if (url.pathname === "/api/workshops" && request.method === "GET") return listWorkshops(request, env);
      if (url.pathname === "/api/participants" && request.method === "POST") return createParticipant(request, env);
      if (url.pathname === "/api/workshops" && request.method === "POST") return createWorkshop(request, env);
      if (url.pathname === "/api/rsvps" && request.method === "POST") return saveRsvps(request, env);
      return json(request, { error: "Not found." }, 404);
    } catch (error) {
      if (String(error).includes("JSON_REQUIRED")) return json(request, { error: "Send JSON." }, 415);
      console.error(error);
      return json(request, { error: "Something went wrong. Please try again." }, 500);
    }
  },
};
