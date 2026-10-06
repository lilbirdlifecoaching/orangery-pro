const DEFAULT_MODEL = "claude-haiku-4-5";

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

      if (url.pathname === "/newsletter" && request.method === "POST") {
        return handleNewsletterSubscribe(request, env);
      }

      if (url.pathname === "/proposals/checkout" && request.method === "POST") {
        return handleProposalCheckout(request, env);
      }

      if (url.pathname === "/proposals/message" && request.method === "POST") {
        return handleProposalMessage(request, env);
      }

      if (url.pathname === "/proposals" && request.method === "POST") {
        return handleCreateProposal(request, env);
      }

      const proposalMatch = url.pathname.match(/^\/proposals\/([A-Za-z0-9_-]{6,20})$/);
      if (proposalMatch && request.method === "GET") {
        return handleGetProposal(proposalMatch[1], request, env);
      }

      if (url.pathname === "/stripe/webhook" && request.method === "POST") {
        return handleStripeWebhook(request, env);
      }

      if (url.pathname === "/writing/latest" && request.method === "GET") {
        return handleLatestWriting(request, env);
      }

      return jsonResponse({ error: "Not found" }, 404, request, env);
    } catch (error) {
      return jsonResponse({ error: "Internal server error", detail: error.message }, 500, request, env);
    }
  }
};

async function handleLatestWriting(request, env) {
  const limitParam = Number(new URL(request.url).searchParams.get("limit") || 4);
  const limit = Math.max(1, Math.min(8, Number.isFinite(limitParam) ? limitParam : 4));
  const feedUrl = cleanText(env.BEEHIIV_SITEMAP_URL || "https://orangery-leadership.beehiiv.com/sitemap.xml");

  try {
    const feedRes = await fetch(feedUrl, {
      headers: { Accept: "application/xml,text/xml,*/*" }
    });
    const xml = await feedRes.text();
    if (!feedRes.ok) {
      return jsonResponse({
        error: "Could not load Beehiiv sitemap.",
        detail: "HTTP " + feedRes.status
      }, 502, request, env);
    }

    const posts = parseBeehiivSitemap(xml).slice(0, limit);
    return jsonResponse({
      ok: true,
      source: feedUrl,
      posts: posts
    }, 200, request, env);
  } catch (error) {
    return jsonResponse({
      error: "Could not load latest writing.",
      detail: error && error.message ? error.message : String(error)
    }, 502, request, env);
  }
}

function parseBeehiivSitemap(xml) {
  const text = String(xml || "");
  const blocks = text.split(/<url>/i).slice(1);
  const posts = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const locMatch = block.match(/<loc>\s*(https?:\/\/[^<]*beehiiv\.com\/p\/[^<\s]+)\s*<\/loc>/i);
    if (!locMatch) continue;

    const url = locMatch[1].trim();
    const titleMatch = block.match(/<news:title>\s*([\s\S]*?)\s*<\/news:title>/i);
    const dateMatch =
      block.match(/<news:publication_date>\s*([^<\s]+)\s*<\/news:publication_date>/i) ||
      block.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i);

    const title = titleMatch
      ? decodeXmlEntities(titleMatch[1]).trim()
      : titleFromBeehiivSlug(url);

    posts.push({
      title: title,
      url: url,
      publishedAt: dateMatch ? dateMatch[1].trim() : "",
      summary: ""
    });
  }

  posts.sort(function (a, b) {
    return String(b.publishedAt).localeCompare(String(a.publishedAt));
  });

  return posts;
}

function titleFromBeehiivSlug(url) {
  try {
    const path = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    const cleaned = path.replace(/-[0-9a-f]{3,}$/i, "").replace(/-/g, " ").trim();
    return cleaned.replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
  } catch (err) {
    return "Latest article";
  }
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

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
      max_tokens: 2200,
      temperature: 0.4,
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
  const blocks = Array.isArray(anthropicData.content) ? anthropicData.content : [];
  const textBlock = blocks.find(function (block) {
    return block && block.type === "text" && block.text;
  });
  const raw = textBlock ? textBlock.text : "";

  let parsed;
  try {
    parsed = extractJson(raw);
  } catch (error) {
    return jsonResponse({ error: "Could not parse worker response.", detail: error.message, raw }, 502, request, env);
  }

  return jsonResponse(normalizeResult(parsed, normalized.relationshipDirection), 200, request, env);
}

async function handleNewsletterSubscribe(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return jsonResponse({ error: "Invalid JSON body." }, 400, request, env);
  }

  const email = cleanText(payload.email).slice(0, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: "Please use a valid email address." }, 400, request, env);
  }

  const publicationId = cleanText(env.BEEHIIV_PUBLICATION_ID || "pub_4b113d69-194d-46cc-ae0e-53efb3cdebce");
  let delivered = "";

  if (env.BEEHIIV_API_KEY) {
    const beeRes = await fetch(
      "https://api.beehiiv.com/v2/publications/" + encodeURIComponent(publicationId) + "/subscriptions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.BEEHIIV_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: email,
          reactivate_existing: false,
          send_welcome_email: true,
          double_opt_override: "off",
          utm_source: "orangery.pro",
          utm_medium: "relational-dynamics",
          referring_site: "https://orangery.pro/relationship-dynamic-orangery.html"
        })
      }
    );
    const beeData = await beeRes.json().catch(function () { return {}; });
    if (beeRes.ok || subscriptionAlreadyExists(beeRes.status, beeData)) {
      delivered = "beehiiv";
    } else {
      return jsonResponse({
        error: "Could not add that email to the notes list. Try it again in a moment."
      }, 502, request, env);
    }
  }

  let notifyError = "";
  if (env.RESEND_API_KEY) {
    const notifyTo = cleanText(env.NOTIFY_EMAIL || "lukehaythorpe@orangery.solutions");
    const note = [
      "Someone asked for the rest of a relational dynamics read.",
      "Email: " + email,
      "Newsletter: " + (delivered === "beehiiv" ? "added on Beehiiv" : "Beehiiv API key is not set, so this address was not added to the list"),
      "Page: relationship-dynamic-orangery.html"
    ].join("\n");
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: env.NOTIFY_FROM || "Orangery Proposals <onboarding@resend.dev>",
        to: [notifyTo],
        reply_to: email,
        subject: "Relational dynamics note signup",
        text: note
      })
    });
    const emailData = await emailRes.json().catch(function () { return {}; });
    if (emailRes.ok && !delivered) delivered = "notify";
    if (!emailRes.ok) notifyError = emailData.message || "Notification email failed.";
  }

  if (!delivered) {
    return jsonResponse({
      error: notifyError || "The notes list is not connected yet."
    }, 500, request, env);
  }

  return jsonResponse({ ok: true, delivered: delivered }, 200, request, env);
}

function subscriptionAlreadyExists(status, data) {
  if (status !== 400 && status !== 409 && status !== 422) return false;
  const text = JSON.stringify(data || {}).toLowerCase();
  return text.indexOf("already") !== -1 || text.indexOf("exist") !== -1 || text.indexOf("subscribed") !== -1;
}

async function handleProposalCheckout(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({
      error: "STRIPE_SECRET_KEY is not configured on the worker yet. Add it as a Cloudflare Worker secret to enable proposal payments."
    }, 500, request, env);
  }

  const stripeKey = String(env.STRIPE_SECRET_KEY || "").trim();
  if (!/^sk_(test|live)_/.test(stripeKey)) {
    return jsonResponse({
      error: "STRIPE_SECRET_KEY looks wrong. Use a Stripe Secret key that starts with sk_test_ or sk_live_ (not a publishable key, restricted key, or other Stripe ID)."
    }, 500, request, env);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return jsonResponse({ error: "Invalid JSON body." }, 400, request, env);
  }

  const proposal = payload.proposal;
  const signature = payload.signature || {};
  if (!proposal || typeof proposal !== "object") {
    return jsonResponse({ error: "Missing proposal payload." }, 400, request, env);
  }

  const total = Number(proposal.total);
  if (!Number.isFinite(total) || total <= 0) {
    return jsonResponse({ error: "Proposal total must be a positive amount." }, 400, request, env);
  }

  if (!signature.name || !signature.signedAt) {
    return jsonResponse({ error: "A signed acceptance is required before checkout." }, 400, request, env);
  }

  // Stripe rejects file:// return URLs. Local proposal previews may send those —
  // rewrite them to the public proposal page so checkout still works from a local file.
  const successUrl = sanitizeCheckoutReturnUrl(payload.successUrl, "?paid=1");
  const cancelUrl = sanitizeCheckoutReturnUrl(payload.cancelUrl, "?cancelled=1");
  if (!successUrl || !cancelUrl) {
    return jsonResponse({ error: "Valid successUrl and cancelUrl are required." }, 400, request, env);
  }

  const currency = normalizeCurrency(proposal.currency);
  const clientName = proposal.client?.name || signature.name || "Client";
  const clientEmail = proposal.client?.email || "";
  const proposalTitle = proposal.title || "Orangery proposal";
  const discountAmount = Math.max(0, Number(proposal.discount?.amount || 0));
  const discountLabel = String(proposal.discount?.label || "Discount").slice(0, 40);

  const checkoutLines = buildStripeLineItems(proposal, currency, total);
  if (!checkoutLines.length) {
    return jsonResponse({ error: "Proposal has no payable line items." }, 400, request, env);
  }

  let couponId = "";
  if (discountAmount > 0) {
    const couponParams = new URLSearchParams();
    couponParams.set("amount_off", String(Math.round(discountAmount * 100)));
    couponParams.set("currency", currency);
    couponParams.set("duration", "once");
    couponParams.set("name", discountLabel);
    const couponRes = await fetch("https://api.stripe.com/v1/coupons", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + stripeKey,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: couponParams.toString()
    });
    const couponData = await couponRes.json().catch(() => ({}));
    if (!couponRes.ok || !couponData.id) {
      return jsonResponse({
        error: couponData.error?.message || "Could not create Stripe discount for this proposal.",
        detail: couponData
      }, 502, request, env);
    }
    couponId = couponData.id;
  }

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", appendCheckoutSessionId(successUrl));
  params.set("cancel_url", cancelUrl);
  params.set("client_reference_id", "proposal-" + Date.now());
  params.set("payment_intent_data[description]", proposalTitle);
  // Creates a Stripe Invoice so the client can get a proper invoice/receipt record.
  params.set("invoice_creation[enabled]", "true");
  params.set("invoice_creation[invoice_data][description]", String(proposalTitle).slice(0, 500));
  params.set(
    "invoice_creation[invoice_data][footer]",
    "Thank you for partnering with Orangery. Book your implementation call from your confirmation email."
  );

  checkoutLines.forEach(function (line, index) {
    params.set("line_items[" + index + "][quantity]", "1");
    params.set("line_items[" + index + "][price_data][currency]", currency);
    params.set("line_items[" + index + "][price_data][unit_amount]", String(line.amountCents));
    params.set("line_items[" + index + "][price_data][product_data][name]", line.name);
    if (line.description) {
      params.set("line_items[" + index + "][price_data][product_data][description]", line.description);
    }
  });

  if (couponId) params.set("discounts[0][coupon]", couponId);

  params.set("metadata[proposal_title]", String(proposalTitle).slice(0, 450));
  params.set("metadata[client_name]", String(clientName).slice(0, 450));
  params.set("metadata[signer_name]", String(signature.name).slice(0, 450));
  params.set("metadata[signer_title]", String(signature.title || "").slice(0, 450));
  params.set("metadata[signed_at]", String(signature.signedAt).slice(0, 450));
  params.set("metadata[proposal_total]", String(total));
  params.set("metadata[currency]", currency);
  const proposalId = cleanText(payload.proposalId || "").slice(0, 40);
  if (proposalId) params.set("metadata[proposal_id]", proposalId);
  if (clientEmail) params.set("customer_email", clientEmail);

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + stripeKey,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  const stripeData = await stripeRes.json().catch(() => ({}));
  if (!stripeRes.ok) {
    return jsonResponse({
      error: stripeData.error?.message || "Stripe checkout session could not be created.",
      detail: stripeData
    }, 502, request, env);
  }

  return jsonResponse({
    ok: true,
    id: stripeData.id,
    url: stripeData.url
  }, 200, request, env);
}

async function handleCreateProposal(request, env) {
  if (!env.PROPOSALS) {
    return jsonResponse({
      error: "Short links need Cloudflare KV. In the worker settings, create a KV namespace and bind it as PROPOSALS, then try again."
    }, 503, request, env);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return jsonResponse({ error: "Invalid JSON body." }, 400, request, env);
  }

  const proposal = payload.proposal;
  if (!proposal || typeof proposal !== "object") {
    return jsonResponse({ error: "Missing proposal payload." }, 400, request, env);
  }

  const total = Number(proposal.total);
  if (!Number.isFinite(total) || total < 0) {
    return jsonResponse({ error: "Proposal total looks invalid." }, 400, request, env);
  }

  const id = generateProposalId();
  const record = {
    proposal: proposal,
    createdAt: new Date().toISOString()
  };

  await env.PROPOSALS.put(id, JSON.stringify(record), {
    expirationTtl: 60 * 60 * 24 * 180
  });

  const shareUrl = publicProposalUrl(env, id);
  const sendEmail = Boolean(payload.sendEmail);
  const toEmail = cleanText((payload.toEmail || proposal.client && proposal.client.email) || "");

  if (!sendEmail) {
    return jsonResponse({ ok: true, id: id, url: shareUrl }, 200, request, env);
  }

  if (!toEmail || toEmail.indexOf("@") === -1) {
    return jsonResponse({
      error: "Add a client email before sending the proposal.",
      id: id,
      url: shareUrl
    }, 400, request, env);
  }

  const clientName = cleanText((proposal.client && proposal.client.name) || "there");
  const proposalTitle = cleanText(proposal.title || "your Orangery proposal");
  const currency = normalizeCurrency(proposal.currency || "usd").toUpperCase();
  const fromName = cleanText((proposal.provider && proposal.provider.name) || "Luke Haythorpe");
  const subject = proposalTitle;
  const textBody = [
    "Hi " + clientName + ",",
    "",
    "Here is your proposal from " + fromName + ".",
    "",
    shareUrl,
    "",
    "Total: " + currency + " " + Math.round(total).toLocaleString("en-US"),
    "",
    "You can review, ask questions, suggest changes, sign, and pay from that link.",
    "",
    "Luke"
  ].join("\n");

  if (env.RESEND_API_KEY) {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: env.NOTIFY_FROM || "Orangery Proposals <onboarding@resend.dev>",
        to: [toEmail],
        reply_to: cleanText(env.NOTIFY_EMAIL || "lukehaythorpe@orangery.solutions") || undefined,
        subject: subject.slice(0, 200),
        text: textBody
      })
    });
    const emailData = await emailRes.json().catch(() => ({}));
    if (!emailRes.ok) {
      return jsonResponse({
        error: emailData.message || "Proposal was saved, but email could not be sent.",
        id: id,
        url: shareUrl,
        detail: emailData
      }, 502, request, env);
    }
    return jsonResponse({ ok: true, id: id, url: shareUrl, delivered: "email" }, 200, request, env);
  }

  const mailto =
    "mailto:" +
    encodeURIComponent(toEmail) +
    "?subject=" +
    encodeURIComponent(subject) +
    "&body=" +
    encodeURIComponent(textBody);

  return jsonResponse({
    ok: true,
    id: id,
    url: shareUrl,
    delivered: "mailto",
    mailto: mailto
  }, 200, request, env);
}

async function handleGetProposal(id, request, env) {
  if (!env.PROPOSALS) {
    return jsonResponse({
      error: "Proposal storage is not configured (KV binding PROPOSALS missing)."
    }, 503, request, env);
  }

  const raw = await env.PROPOSALS.get(id);
  if (!raw) {
    return jsonResponse({ error: "Proposal not found or expired." }, 404, request, env);
  }

  let record;
  try {
    record = JSON.parse(raw);
  } catch (err) {
    return jsonResponse({ error: "Stored proposal could not be read." }, 500, request, env);
  }

  if (!record || !record.proposal) {
    return jsonResponse({ error: "Stored proposal is incomplete." }, 500, request, env);
  }

  return jsonResponse({
    ok: true,
    id: id,
    proposal: record.proposal,
    createdAt: record.createdAt || null
  }, 200, request, env);
}

function publicProposalUrl(env, id) {
  const base = cleanText(env.PROPOSAL_PUBLIC_URL || "https://orangery.pro/proposal.html") ||
    "https://orangery.pro/proposal.html";
  const cleaned = base.replace(/[?#].*$/, "").replace(/\/$/, "");
  return cleaned + "?id=" + encodeURIComponent(id);
}

function generateProposalId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(36).padStart(2, "0");
  }
  return out.slice(0, 10);
}

function appendCheckoutSessionId(url) {
  const value = String(url || "");
  if (!value) return value;
  if (value.indexOf("{CHECKOUT_SESSION_ID}") !== -1) return value;
  return value + (value.indexOf("?") === -1 ? "?" : "&") + "session_id={CHECKOUT_SESSION_ID}";
}

function implementationCalUrl(env) {
  return cleanText(env.IMPLEMENTATION_CAL_URL || "https://cal.com/lukehaythorpe/30min") ||
    "https://cal.com/lukehaythorpe/30min";
}

async function handleStripeWebhook(request, env) {
  const stripeKey = String(env.STRIPE_SECRET_KEY || "").trim();
  const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!stripeKey || !webhookSecret) {
    return new Response(JSON.stringify({
      error: "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required for webhooks."
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") || "";
  const valid = await verifyStripeSignature(rawBody, signature, webhookSecret);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid Stripe signature." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid JSON." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data && event.data.object ? event.data.object : null;
    if (session) {
      await fulfillPaidCheckout(session, env, stripeKey);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

async function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = {};
  String(header).split(",").forEach(function (item) {
    const pair = item.split("=");
    if (pair.length < 2) return;
    const key = pair[0].trim();
    const value = pair.slice(1).join("=").trim();
    if (!parts[key]) parts[key] = [];
    parts[key].push(value);
  });

  const timestamp = parts.t && parts.t[0];
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) return false;

  // Reject stale signatures (5 minutes).
  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || age > 300 || age < -30) return false;

  const signedPayload = timestamp + "." + rawBody;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = bufferToHex(sigBuf);

  for (let i = 0; i < signatures.length; i++) {
    if (timingSafeEqual(expected, signatures[i])) return true;
  }
  return false;
}

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(function (b) { return b.toString(16).padStart(2, "0"); })
    .join("");
}

function timingSafeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;
  let out = 0;
  for (let i = 0; i < left.length; i++) {
    out |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return out === 0;
}

async function fulfillPaidCheckout(session, env, stripeKey) {
  const sessionId = String(session.id || "");
  if (!sessionId) return;
  // The Stripe account is shared with lil' bird; only handle sessions created by the proposal checkout.
  if (!String(session.client_reference_id || "").startsWith("proposal-")) return;

  if (env.PROPOSALS) {
    const seenKey = "paid:" + sessionId;
    const already = await env.PROPOSALS.get(seenKey);
    if (already) return;
    await env.PROPOSALS.put(seenKey, new Date().toISOString(), {
      expirationTtl: 60 * 60 * 24 * 90
    });
  }

  const metadata = session.metadata || {};
  const clientEmail = cleanText(session.customer_details?.email || session.customer_email || "");
  const clientName = cleanText(metadata.client_name || session.customer_details?.name || "there");
  const proposalTitle = cleanText(metadata.proposal_title || "Orangery proposal");
  const currency = String(metadata.currency || session.currency || "usd").toUpperCase();
  const amountTotal = Number(session.amount_total || 0) / 100;
  const proposalId = cleanText(metadata.proposal_id || "");
  const calUrl = implementationCalUrl(env);
  const proposalUrl = proposalId
    ? publicProposalUrl(env, proposalId)
    : cleanText(env.PROPOSAL_PUBLIC_URL || "https://orangery.pro/proposal.html");
  const notifyTo = cleanText(env.NOTIFY_EMAIL || "lukehaythorpe@orangery.solutions");

  let invoiceUrl = "";
  let receiptUrl = "";
  if (session.invoice) {
    try {
      const invRes = await fetch("https://api.stripe.com/v1/invoices/" + session.invoice, {
        headers: { Authorization: "Bearer " + stripeKey }
      });
      const inv = await invRes.json().catch(() => ({}));
      invoiceUrl = cleanText(inv.hosted_invoice_url || inv.invoice_pdf || "");
    } catch (err) {
      // continue without invoice link
    }
  }
  if (session.payment_intent) {
    try {
      const piRes = await fetch(
        "https://api.stripe.com/v1/payment_intents/" + session.payment_intent + "?expand[]=latest_charge",
        { headers: { Authorization: "Bearer " + stripeKey } }
      );
      const pi = await piRes.json().catch(() => ({}));
      receiptUrl = cleanText(pi.latest_charge && pi.latest_charge.receipt_url || "");
    } catch (err) {
      // continue without receipt link
    }
  }

  const amountLabel = currency + " " + Math.round(amountTotal).toLocaleString("en-US");

  if (clientEmail && env.RESEND_API_KEY) {
    const clientBody = [
      "Hi " + clientName + ",",
      "",
      "Payment received — thank you. Your Orangery engagement is confirmed.",
      "",
      "Proposal: " + proposalTitle,
      "Amount paid: " + amountLabel,
      "",
      "What happens next",
      "1. Book your implementation call so we can lock calendars, participants, and first dates:",
      "   " + calUrl,
      "2. Keep this email handy. Bring any scheduling constraints and the people who should be involved.",
      "3. Before the call, skim your proposal again so we can fine-tune delivery details:",
      "   " + proposalUrl,
      "",
      invoiceUrl ? ("Your invoice: " + invoiceUrl) : "",
      receiptUrl ? ("Your Stripe receipt: " + receiptUrl) : "",
      "",
      "Worth knowing",
      "- Coaching and workshops are scheduled mutually; unused leadership sessions do not automatically roll over beyond the agreed month unless we arrange that in writing.",
      "- If plans change, reply to this email early so we can adjust cleanly.",
      "- Luke will use the implementation call to set rhythm, owners, and the first delivery window.",
      "",
      "Looking forward to the work ahead.",
      "",
      "Luke Haythorpe",
      "orangery.team / orangery.pro",
      notifyTo
    ].filter(Boolean).join("\n");

    await sendResendEmail(env, {
      to: clientEmail,
      replyTo: notifyTo,
      subject: "You're confirmed — next step: book your implementation call",
      text: clientBody
    });
  }

  const lukeBody = [
    "Payment received for a proposal.",
    "",
    "Client: " + clientName + (clientEmail ? " <" + clientEmail + ">" : ""),
    "Proposal: " + proposalTitle,
    "Amount: " + amountLabel,
    "Proposal id: " + (proposalId || "(none)"),
    "Stripe session: " + sessionId,
    invoiceUrl ? ("Invoice: " + invoiceUrl) : "",
    receiptUrl ? ("Receipt: " + receiptUrl) : "",
    "",
    "Implementation call link sent to client: " + calUrl,
    "Proposal link: " + proposalUrl
  ].filter(Boolean).join("\n");

  if (env.RESEND_API_KEY) {
    await sendResendEmail(env, {
      to: notifyTo,
      replyTo: clientEmail || undefined,
      subject: "Proposal paid: " + clientName + " — " + amountLabel,
      text: lukeBody
    });
  } else if (env.NOTIFY_WEBHOOK_URL) {
    await fetch(String(env.NOTIFY_WEBHOOK_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "proposal_paid",
        text: lukeBody,
        sessionId: sessionId,
        clientName: clientName,
        clientEmail: clientEmail,
        amount: amountTotal,
        currency: currency,
        proposalTitle: proposalTitle,
        proposalId: proposalId,
        invoiceUrl: invoiceUrl,
        receiptUrl: receiptUrl,
        calUrl: calUrl
      })
    }).catch(function () { return null; });
  }
}

async function sendResendEmail(env, opts) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.NOTIFY_FROM || "Orangery Proposals <onboarding@resend.dev>",
      to: [opts.to],
      reply_to: opts.replyTo || undefined,
      subject: String(opts.subject || "").slice(0, 200),
      text: opts.text
    })
  });
  return res.json().catch(function () { return {}; });
}

async function handleProposalMessage(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return jsonResponse({ error: "Invalid JSON body." }, 400, request, env);
  }

  const type = String(payload.type || "question").toLowerCase() === "change" ? "change" : "question";
  const name = cleanText(payload.name).slice(0, 120);
  const email = cleanText(payload.email).slice(0, 160);
  const message = cleanText(payload.message).slice(0, 4000);
  const proposalTitle = cleanText(payload.proposalTitle || "Proposal").slice(0, 200);
  const clientName = cleanText(payload.clientName || "").slice(0, 120);
  const proposalTotal = payload.proposalTotal;
  const currency = normalizeCurrency(payload.currency || "usd").toUpperCase();

  if (!name || !message) {
    return jsonResponse({ error: "Name and message are required." }, 400, request, env);
  }
  if (email && email.indexOf("@") === -1) {
    return jsonResponse({ error: "Please provide a valid email address." }, 400, request, env);
  }

  const notifyTo = cleanText(env.NOTIFY_EMAIL || "lukehaythorpe@orangery.solutions");
  const subject =
    (type === "change" ? "Proposal change request" : "Proposal question") +
    ": " +
    (clientName || name) +
    " - " +
    proposalTitle;

  // Full context for email/webhook delivery to Luke.
  const notifyBody = [
    "Type: " + (type === "change" ? "Suggested change" : "Question"),
    "From: " + name + (email ? " <" + email + ">" : ""),
    "Client on proposal: " + (clientName || "(not set)"),
    "Proposal: " + proposalTitle,
    "Total: " + currency + " " + (proposalTotal != null ? proposalTotal : "(unknown)"),
    "Page: " + cleanText(payload.pageUrl || "").slice(0, 500),
    "",
    message
  ].join("\n");

  if (env.RESEND_API_KEY) {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: env.NOTIFY_FROM || "Orangery Proposals <onboarding@resend.dev>",
        to: [notifyTo],
        reply_to: email || undefined,
        subject: subject.slice(0, 200),
        text: notifyBody
      })
    });
    const emailData = await emailRes.json().catch(() => ({}));
    if (!emailRes.ok) {
      return jsonResponse({
        error: emailData.message || "Could not send notification email.",
        detail: emailData
      }, 502, request, env);
    }
    return jsonResponse({ ok: true, delivered: "email" }, 200, request, env);
  }

  if (env.NOTIFY_WEBHOOK_URL) {
    const hookRes = await fetch(String(env.NOTIFY_WEBHOOK_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: type,
        subject: subject,
        text: notifyBody,
        name: name,
        email: email,
        proposalTitle: proposalTitle,
        clientName: clientName,
        proposalTotal: proposalTotal,
        currency: currency
      })
    });
    if (!hookRes.ok) {
      return jsonResponse({ error: "Notification webhook failed." }, 502, request, env);
    }
    return jsonResponse({ ok: true, delivered: "webhook" }, 200, request, env);
  }

  // Mailto fallback: keep the draft simple — just their question/change.
  const mailto =
    "mailto:" +
    encodeURIComponent(notifyTo) +
    "?subject=" +
    encodeURIComponent(subject) +
    "&body=" +
    encodeURIComponent(message);
  return jsonResponse({ ok: true, delivered: "mailto", mailto: mailto }, 200, request, env);
}

function normalizeCurrency(value) {
  const code = String(value || "usd").trim().toLowerCase();
  if (code === "aud") return "aud";
  return "usd";
}

function buildStripeLineItems(proposal, currency, total) {
  const lines = Array.isArray(proposal.lines) ? proposal.lines : [];
  const items = [];

  lines.forEach(function (line) {
    const amount = Number(line && line.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    items.push({
      name: String(line.label || "Proposal item").slice(0, 120),
      description: "",
      amountCents: Math.round(amount * 100)
    });
  });

  if (!items.length) {
    const amountCents = Math.round(Number(total) * 100);
    if (amountCents > 0) {
      items.push({
        name: String(proposal.title || "Orangery proposal").slice(0, 120),
        description: "Proposal total",
        amountCents: amountCents
      });
    }
  }

  return items;
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
  "snapshotSummary": "80-110 words. A grounded summary of how this relationship may tend to work, where it may click, and where strain may emerge. Keep it practical and workplace-specific.",
  "relationshipDirection": "${payload.relationshipDirection}",
  "powerDynamics": "60-90 words. Explain the power, signal, and political dynamics likely to matter here in a workplace context.",
  "theyMayNeed": "45-70 words. What the other person may need from the user for this relationship to work better.",
  "youMayNeed": "45-70 words. What the user may need from the other person or from themselves to work this relationship more wisely.",
  "frictionPoints": ["3 concise bullet sentences about likely friction patterns."],
  "politicalWatchouts": ["3 concise bullet sentences about optics, power, timing, interpretation risk, ownership, or organizational politics."],
  "reflectionQuestions": ["3 strong coaching questions for the user to reflect on before acting."],
  "doMoreOf": ["3 short practical bullets about what to lean into."],
  "avoidDoing": ["3 short practical bullets about what to avoid."],
  "nextConversationSteps": ["3 concrete conversation moves or experiments the user could try in real workplace situations."],
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
      try {
        return JSON.parse(clean.slice(start, end + 1));
      } catch (inner) {
        // Common failure mode: model output cut off before closing braces.
        if (!/}\s*$/.test(clean)) {
          throw new Error("Model response looked truncated before valid JSON completed.");
        }
        throw new Error("JSON parse failed");
      }
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

function sanitizeCheckoutReturnUrl(raw, query) {
  const fallback = "https://orangery.pro/proposal.html" + (query || "");
  const value = String(raw || "").trim();
  if (!value) return fallback;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return value;
  } catch (err) {
    // fall through for file:// and other non-http URLs
  }
  const hashIndex = value.indexOf("#");
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
  return fallback + hash;
}

function originHost(origin) {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch (err) {
    return "";
  }
}

function isAllowedOrigin(origin, configured) {
  if (!origin) return false;
  if (!configured.length || configured.indexOf("*") !== -1 || configured.indexOf(origin) !== -1) {
    return true;
  }
  // Local HTML files send Origin: "null"
  if (origin === "null") return true;

  const host = originHost(origin);
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host === "orangery.pro" || host.endsWith(".orangery.pro")) return true;
  if (host === "orangery.team" || host.endsWith(".orangery.team")) return true;
  if (host === "orangery.solutions" || host.endsWith(".orangery.solutions")) return true;
  if (host.endsWith(".github.io")) return true;
  return false;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(function (item) { return item.trim(); })
    .filter(Boolean);

  var allowOrigin = "https://orangery.pro";
  if (origin && isAllowedOrigin(origin, configured)) {
    allowOrigin = origin;
  } else if (configured.length) {
    allowOrigin = configured[0];
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
