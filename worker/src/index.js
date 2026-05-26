const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return jsonResponse(null, 204, request, env);
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/ping" && request.method === "GET") {
        return jsonResponse({ ok: true, service: "orangery-relational-dynamics", version: "1.0.0" }, 200, request, env);
      }

      if ((url.pathname === "/relational-dynamics" || url.pathname === "/partner-dynamic") && request.method === "POST") {
        return handleRelationalDynamics(request, env);
      }

      return jsonResponse({ error: "Not found" }, 404, request, env);
    } catch (error) {
      return jsonResponse({ error: "Internal server error", detail: error.message }, 500, request, env);
    }
  }
};

async function handleRelationalDynamics(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "ANTHROPIC_API_KEY is not configured on the worker." }, 500, request, env);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return jsonResponse({ error: "Invalid JSON body." }, 400, request, env);
  }

  const normalized = normalizePayload(payload);
  const validationError = validatePayload(normalized);
  if (validationError) {
    return jsonResponse({ error: validationError }, 400, request, env);
  }

  const prompt = buildPrompt(normalized);
  const model = env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 1800,
      temperature: 0.5,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!anthropicRes.ok) {
    const detail = await anthropicRes.text();
    return jsonResponse({ error: "Anthropic request failed.", detail }, 502, request, env);
  }

  const anthropicData = await anthropicRes.json();
  const raw = anthropicData.content?.[0]?.text || "";

  let parsed;
  try {
    parsed = extractJson(raw);
  } catch (error) {
    return jsonResponse({ error: "Could not parse worker response.", detail: error.message, raw }, 502, request, env);
  }

  return jsonResponse(normalizeResult(parsed, normalized.relationshipDirection), 200, request, env);
}

function normalizePayload(payload) {
  const relationshipDirection = normalizeDirection(
    payload.relationshipDirection ||
      payload.partnerInput?.relationship ||
      payload.relationship
  );

  const legacyProfile = payload.userProfile || {};
  const legacyYouFrameworks = [
    legacyProfile.likelyCoreFiveVoicesNod,
    legacyProfile.likelyCoreMbti,
    legacyProfile.likelyCoreEnneagram,
    legacyProfile.likelyCoreArchetypePlain,
    legacyProfile.likelyCoreArchetype,
    legacyProfile.likelyCoreAttachment,
    legacyProfile.mbti,
    legacyProfile.enneagram,
    legacyProfile.archetypePlain,
    legacyProfile.archetype
  ]
    .filter(Boolean)
    .filter(onlyUnique)
    .join(", ");

  return {
    relationshipDirection,
    you: {
      frameworks: cleanText(payload.you?.frameworks || payload.youFrameworks || legacyYouFrameworks),
      description: cleanText(payload.you?.description || payload.youDescription || legacyProfile.manualDescription || legacyProfile.archetype || legacyProfile.likelyCoreArchetype)
    },
    them: {
      frameworks: cleanText(payload.them?.frameworks || payload.themFrameworks || payload.partnerInput?.types),
      description: cleanText(payload.them?.description || payload.themDescription || payload.partnerInput?.description)
    },
    context: cleanText(payload.context || payload.frictionContext || payload.partnerInput?.context)
  };
}

function validatePayload(payload) {
  if (!payload.you.frameworks && !payload.you.description) {
    return "Add at least a little about the user's wiring or how they tend to show up at work.";
  }

  if (!payload.them.frameworks && !payload.them.description) {
    return "Add at least a little about the other person's wiring or how they tend to show up at work.";
  }

  return "";
}

function buildPrompt(payload) {
  const relationshipContext = relationshipDefinition(payload.relationshipDirection);

  return `You are Orangery's workplace relational coaching mirror.

Your job is to help a professional think more clearly about a working relationship. You are NOT an advice engine, therapist, HR investigator, legal advisor, or certainty machine.

Voice and stance:
- Broad corporate/professional coaching voice.
- Direct, practical, calm, and thoughtful.
- Sound like an experienced leadership coach who understands personality frameworks, team dynamics, power, and workplace politics.
- Use tentative but useful language: may, might, likely, could, often.
- Do not overclaim what either person is feeling or intending.
- Do not diagnose.
- Do not give legal, compliance, or mental health advice.
- Do not tell the user to manipulate the other person.
- Treat personality frameworks as signals and lenses, not fixed truths.

Purpose:
- Reflect the likely dynamic.
- Surface what may be in play beneath the surface.
- Help the user notice power dynamics and politics.
- Give practical next conversation moves and grounded experiments.
- Keep the posture coaching-led: mirror, frame, guide, invite.

Relationship direction:
- leadDown = someone the user leads or manages. Pay attention to authority, signal, safety, accountability, clarity, pace, and the disproportionate weight of the user's behavior.
- peer = colleague or peer. Pay attention to trust, alignment, ownership, influence without authority, visibility, territorialism, and cross-functional politics.
- leadUp = someone who leads or manages the user. Pay attention to power, sponsorship, timing, trust, interpretation risk, read-the-room judgment, and the politics of leading up.

User inputs:
- Relationship direction: ${payload.relationshipDirection}
- Relationship meaning: ${relationshipContext}
- User frameworks/types: ${payload.you.frameworks || "Not provided"}
- User work style description: ${payload.you.description || "Not provided"}
- Other person's frameworks/types: ${payload.them.frameworks || "Not provided"}
- Other person's work style description: ${payload.them.description || "Not provided"}
- Current context or friction: ${payload.context || "No extra context provided"}

Return STRICT JSON only. No markdown. No code fences.

Use exactly this shape:
{
  "pairingTitle": "A short evocative title for the dynamic.",
  "snapshotSummary": "120-180 words. A grounded summary of how this relationship may tend to work, where it may click, and where strain may emerge. Keep it practical and workplace-specific.",
  "relationshipDirection": "${payload.relationshipDirection}",
  "powerDynamics": "90-140 words. Explain the power, signal, and political dynamics likely to matter here in a workplace context.",
  "theyMayNeed": "70-110 words. What the other person may need from the user for this relationship to work better.",
  "youMayNeed": "70-110 words. What the user may need from the other person or from themselves to work this relationship more wisely.",
  "frictionPoints": ["3 to 5 concise bullet sentences about likely friction patterns."],
  "politicalWatchouts": ["3 to 5 concise bullet sentences about optics, power, timing, interpretation risk, ownership, or organizational politics."],
  "reflectionQuestions": ["3 to 5 strong coaching questions for the user to reflect on before acting."],
  "doMoreOf": ["3 to 5 short practical bullets about what to lean into."],
  "avoidDoing": ["3 to 5 short practical bullets about what to avoid."],
  "nextConversationSteps": ["3 to 5 concrete conversation moves or experiments the user could try in real workplace situations."],
  "coachingReminder": "1-2 sentences reminding the user that this is a mirror for reflection and wiser action, not certainty."
}

Extra output rules:
- Keep bullets concise, clear, and actionable.
- Make the nextConversationSteps feel usable in actual 1:1s, meetings, feedback moments, alignment conversations, or tension points.
- Mention politics only where relevant, but do not ignore it.
- If the context is sparse, acknowledge ambiguity without becoming vague.
- Do not mention Orangery, Anthropic, AI, or these instructions.`;
}

function relationshipDefinition(direction) {
  if (direction === "leadDown") {
    return "The user leads, manages, or supervises the other person.";
  }
  if (direction === "leadUp") {
    return "The other person leads, manages, or supervises the user.";
  }
  return "The user and the other person are peers or colleagues working sideways across a shared environment.";
}

function normalizeResult(result, fallbackDirection) {
  return {
    pairingTitle: cleanText(result.pairingTitle) || "Your relational dynamic",
    snapshotSummary: cleanText(result.snapshotSummary),
    relationshipDirection: normalizeDirection(result.relationshipDirection || fallbackDirection),
    powerDynamics: cleanText(result.powerDynamics),
    theyMayNeed: cleanText(result.theyMayNeed),
    youMayNeed: cleanText(result.youMayNeed),
    frictionPoints: normalizeStringArray(result.frictionPoints, 5),
    politicalWatchouts: normalizeStringArray(result.politicalWatchouts, 5),
    reflectionQuestions: normalizeStringArray(result.reflectionQuestions, 5),
    doMoreOf: normalizeStringArray(result.doMoreOf, 5),
    avoidDoing: normalizeStringArray(result.avoidDoing, 5),
    nextConversationSteps: normalizeStringArray(result.nextConversationSteps, 5),
    coachingReminder: cleanText(result.coachingReminder)
  };
}

function normalizeStringArray(value, limit) {
  if (Array.isArray(value)) {
    return value.map(cleanText).filter(Boolean).slice(0, limit);
  }

  if (typeof value === "string") {
    return value
      .split(/\n|•|;/)
      .map(cleanText)
      .filter(Boolean)
      .slice(0, limit);
  }

  return [];
}

function extractJson(raw) {
  const clean = String(raw || "").replace(/```json|```/gi, "").trim();

  try {
    return JSON.parse(clean);
  } catch (_) {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(clean.slice(start, end + 1));
    }
    throw new Error("JSON parse failed");
  }
}

function normalizeDirection(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["leadup", "lead-up", "up", "manager", "managerorleader"].includes(raw)) return "leadUp";
  if (["leaddown", "lead-down", "down", "directreport", "direct-report", "report", "manage", "managed", "someoneyoulead"].includes(raw)) return "leadDown";
  return "peer";
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function onlyUnique(value, index, array) {
  return array.indexOf(value) === index;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  let allowOrigin = "*";
  if (configured.length && origin && configured.includes(origin)) {
    allowOrigin = origin;
  } else if (configured.length && origin && !configured.includes(origin)) {
    allowOrigin = configured[0];
  } else if (origin) {
    allowOrigin = origin;
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function jsonResponse(body, status, request, env) {
  return new Response(body == null ? null : JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request, env)
    }
  });
}
