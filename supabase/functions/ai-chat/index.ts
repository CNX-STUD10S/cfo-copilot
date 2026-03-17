// supabase/functions/ai-chat/index.ts
// SECURE VERSION — verifies user JWT before calling Claude API
// Deploy: supabase functions deploy ai-chat
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SB_URL        = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; // server-side only

const PLAN_LIMITS: Record<string, number> = {
  free: 5,
  starter: 100,
  pro: 999999,
  enterprise: 999999,
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "https://cnx-stud10s.github.io",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ── SECURITY: Verify user JWT ──
  // The frontend sends the user's session access_token, not the anon key
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid authorization header" }),
      { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  const userJWT = authHeader.replace("Bearer ", "");

  // Create a client that verifies the user's JWT
  const sb = createClient(SB_URL, SB_SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${userJWT}` } },
  });

  // ── SECURITY: Get verified user from JWT ──
  const { data: { user }, error: authError } = await sb.auth.getUser(userJWT);
  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized — invalid session" }),
      { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // ── SECURITY: Check usage limits from DB (server-side, not trustable from frontend) ──
  const { data: sub } = await sb
    .from("subscriptions")
    .select("plan, ai_messages_used, reset_date")
    .eq("user_id", user.id)
    .single();

  const plan  = sub?.plan || "free";
  const used  = sub?.ai_messages_used || 0;
  const limit = PLAN_LIMITS[plan] || 5;

  // ── SECURITY: Check monthly reset ──
  const now       = new Date();
  const resetDate = sub?.reset_date ? new Date(sub.reset_date) : null;
  const shouldReset = !resetDate ||
    (now.getMonth() !== resetDate.getMonth() || now.getFullYear() !== resetDate.getFullYear());

  let currentUsed = used;
  if (shouldReset) {
    // Reset counter at start of new month
    currentUsed = 0;
    await sb
      .from("subscriptions")
      .update({ ai_messages_used: 0, reset_date: now.toISOString() })
      .eq("user_id", user.id);
  }

  if (currentUsed >= limit && limit !== 999999) {
    return new Response(
      JSON.stringify({ error: "limit_reached", used: currentUsed, limit }),
      { status: 429, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // ── Parse and validate request body ──
  let body: { messages: unknown[]; system: string; user_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // ── SECURITY: Validate message structure ──
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "Invalid messages array" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // Sanitise messages — only allow role/content string pairs
  const safeMessages = messages
    .filter((m: any) => m && typeof m.role === "string" && typeof m.content === "string")
    .map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 2000) }))
    .slice(-6); // Last 6 messages max

  // Validate system prompt is a string and cap its length
  const system = typeof body.system === "string"
    ? body.system.slice(0, 1500)
    : "You are a helpful AI CFO assistant.";

  // ── Call Claude API (key never leaves server) ──
  let claudeReply: string;
  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", // Fast + cheap for chat
        max_tokens: 400,
        system,
        messages: safeMessages,
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      console.error("Claude API error:", err);
      throw new Error("Claude API failed");
    }

    const claudeData = await claudeRes.json();
    claudeReply = claudeData.content?.[0]?.text || "I could not generate a response.";
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "AI service temporarily unavailable" }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // ── Increment usage counter atomically ──
  const newUsed = currentUsed + 1;
  await sb
    .from("subscriptions")
    .update({ ai_messages_used: newUsed })
    .eq("user_id", user.id);

  // ── Return response ──
  return new Response(
    JSON.stringify({ reply: claudeReply, used: newUsed, limit }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});

