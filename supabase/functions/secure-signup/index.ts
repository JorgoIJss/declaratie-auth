import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const signupSecretAnswer = Deno.env.get("SIGNUP_SECRET_ANSWER") || "";

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function normalize(value: string) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function genericResponse() {
  return new Response(
    JSON.stringify({
      ok: true,
      message: "Als je gegevens correct zijn, ontvang je een bevestigingsmail of verdere instructies.",
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

type SignupAttemptPayload = {
  email: string;
  display_name: string;
  normalized_secret_answer: string;
  secret_ok: boolean;
  attempt_count: number;
  blocked_until: string | null;
  ip: string | null;
  user_agent: string | null;
};

async function logSignupAttempt(payload: SignupAttemptPayload) {
  const { error } = await admin.from("signup_attempts").insert(payload);

  if (error) {
    console.log("secure-signup signup_attempts insert failed", {
      email: payload.email,
      secretOk: payload.secret_ok,
      attemptCount: payload.attempt_count,
      blockedUntil: payload.blocked_until,
      error: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
      at: new Date().toISOString(),
    });
    throw new Error(`signup_attempts insert failed: ${error.message}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return genericResponse();
  }

  try {
    const body = await req.json().catch(() => ({}));
    const displayName = String(body.displayName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const secretAnswer = String(body.secretAnswer || "");
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;

    if (!displayName || !email || !password) {
      return genericResponse();
    }

    const normalizedSecret = normalize(secretAnswer);
    const normalizedExpected = normalize(signupSecretAnswer);

    const { data: recentAttempts, error: recentAttemptsError } = await admin
      .from("signup_attempts")
      .select("id, attempt_count, blocked_until")
      .ilike("email", email)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (recentAttemptsError) {
      console.log("secure-signup signup_attempts lookup failed", {
        email,
        error: recentAttemptsError.message,
        details: recentAttemptsError.details,
        hint: recentAttemptsError.hint,
        code: recentAttemptsError.code,
        at: new Date().toISOString(),
      });
      throw new Error(`signup_attempts lookup failed: ${recentAttemptsError.message}`);
    }

    const latest = recentAttempts?.[0] || null;
    const now = new Date();
    const blockedUntil = latest?.blocked_until ? new Date(latest.blocked_until) : null;
    const currentlyBlocked = Boolean(blockedUntil && blockedUntil > now);

    if (currentlyBlocked) {
      await logSignupAttempt({
        email,
        display_name: displayName,
        normalized_secret_answer: normalizedSecret,
        secret_ok: false,
        attempt_count: latest?.attempt_count || 0,
        blocked_until: blockedUntil!.toISOString(),
        ip,
        user_agent: userAgent,
      });

      console.log("secure-signup denied", {
        email,
        reason: "still_blocked",
        attemptCount: latest?.attempt_count || 0,
        blockedUntil: blockedUntil!.toISOString(),
        at: now.toISOString(),
      });

      return genericResponse();
    }

    const secretOk = normalizedSecret === normalizedExpected;

    if (!secretOk) {
      const nextCount = Math.min((latest?.attempt_count || 0) + 1, 9999);
      const shouldBlock = nextCount >= 3;
      const nextBlockedUntil = shouldBlock
        ? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
        : null;

      await logSignupAttempt({
        email,
        display_name: displayName,
        normalized_secret_answer: normalizedSecret,
        secret_ok: false,
        attempt_count: nextCount,
        blocked_until: nextBlockedUntil,
        ip,
        user_agent: userAgent,
      });

      console.log("secure-signup denied", {
        email,
        reason: shouldBlock ? "wrong_secret_blocked" : "wrong_secret",
        attemptCount: nextCount,
        blockedUntil: nextBlockedUntil,
        at: now.toISOString(),
      });

      return genericResponse();
    }

    await logSignupAttempt({
      email,
      display_name: displayName,
      normalized_secret_answer: normalizedSecret,
      secret_ok: true,
      attempt_count: 0,
      blocked_until: null,
      ip,
      user_agent: userAgent,
    });

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: {
        display_name: displayName,
      },
    });

    if (error) {
      console.log("secure-signup createUser error", {
        email,
        error: error.message,
        at: now.toISOString(),
      });
      return genericResponse();
    }

    console.log("secure-signup success", {
      email,
      userId: data.user?.id,
      at: now.toISOString(),
    });

    return genericResponse();
  } catch (err) {
    console.log("secure-signup fatal", {
      error: err instanceof Error ? err.message : "unknown",
      at: new Date().toISOString(),
    });
    return genericResponse();
  }
});
