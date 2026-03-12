import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = "https://aecakvgfqpcgoagzangn.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const STORAGE_BUCKET = "declaratie-bonnen";
const DEFAULT_TO_EMAIL = "jorgo@growth-dynamics.nl";
const DEFAULT_FROM_EMAIL = "onboarding@resend.dev";

type AttachmentInput = {
  filename?: string;
  url?: string | null;
  path?: string | null;
  attachmentPublicUrl?: string | null;
  attachmentPath?: string | null;
  contentType?: string | null;
};

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function requireAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    throw new Error("Niet ingelogd. Authorization token ontbreekt.");
  }

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser(token);

  if (error || !user) {
    throw new Error("Niet ingelogd of sessie verlopen.");
  }

  return user;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatAmount(value: string | number | undefined): string {
  if (value === undefined || value === null || value === "") return "";

  const normalized =
    typeof value === "number"
      ? value
      : Number(String(value).replace(",", ".").replace(/[^\d.-]/g, ""));

  if (Number.isNaN(normalized)) return String(value);

  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(normalized);
}

function buildFallbackHtml(data: Record<string, unknown>): string {
  return `
    <div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;">
      <h2 style="margin:0 0 16px 0;">Nieuwe declaratie</h2>
      <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
        <tr><td style="border:1px solid #d6d6d6;padding:10px;background:#f7f7f7;width:220px;"><strong>Datum</strong></td><td style="border:1px solid #d6d6d6;padding:10px;">${escapeHtml(data.date)}</td></tr>
        <tr><td style="border:1px solid #d6d6d6;padding:10px;background:#f7f7f7;"><strong>Leverancier</strong></td><td style="border:1px solid #d6d6d6;padding:10px;">${escapeHtml(data.supplier)}</td></tr>
        <tr><td style="border:1px solid #d6d6d6;padding:10px;background:#f7f7f7;"><strong>Reden</strong></td><td style="border:1px solid #d6d6d6;padding:10px;">${escapeHtml(data.reason)}</td></tr>
        <tr><td style="border:1px solid #d6d6d6;padding:10px;background:#f7f7f7;"><strong>Bedrag</strong></td><td style="border:1px solid #d6d6d6;padding:10px;">${escapeHtml(formatAmount(data.amount as string | number | undefined))}</td></tr>
        <tr><td style="border:1px solid #d6d6d6;padding:10px;background:#f7f7f7;"><strong>IBAN</strong></td><td style="border:1px solid #d6d6d6;padding:10px;">${escapeHtml(data.iban)}</td></tr>
        <tr><td style="border:1px solid #d6d6d6;padding:10px;background:#f7f7f7;"><strong>Naam</strong></td><td style="border:1px solid #d6d6d6;padding:10px;">${escapeHtml(data.name ?? data.accountName ?? data.submitterName)}</td></tr>
        <tr><td style="border:1px solid #d6d6d6;padding:10px;background:#f7f7f7;"><strong>Reden geen bon</strong></td><td style="border:1px solid #d6d6d6;padding:10px;">${escapeHtml(data.noReceiptReason ?? "-")}</td></tr>
      </table>
    </div>`;
}

function buildFallbackText(data: Record<string, unknown>): string {
  return `Beste penningmeester,

Hierbij dien ik een declaratie in.

Datum: ${data.date ?? ""}
Leverancier: ${data.supplier ?? ""}
Reden: ${data.reason ?? ""}
Bedrag: ${formatAmount(data.amount as string | number | undefined)}
IBAN: ${data.iban ?? ""}
Naam: ${data.name ?? data.accountName ?? data.submitterName ?? ""}
Reden geen bon: ${data.noReceiptReason ?? "-"}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function buildResendAttachments(inputs: AttachmentInput[]) {
  const files: Array<{ filename: string; content: string }> = [];

  for (const att of inputs) {
    const storagePath =
      att.attachmentPath?.replace(/^\/+/, "") ||
      att.path?.replace(/^\/+/, "") ||
      "";

    if (!storagePath) {
      throw new Error(`Bijlage mist attachmentPath: ${att.filename || "onbekend bestand"}`);
    }

    const { data, error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);

    if (error || !data) {
      throw new Error(`Bijlage ophalen mislukt: ${att.filename || storagePath}`);
    }

    const buffer = await data.arrayBuffer();

    files.push({
      filename: att.filename || "bijlage",
      content: arrayBufferToBase64(buffer),
    });
  }

  return files;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Method not allowed",
      }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }

  try {
    if (!SUPABASE_ANON_KEY) {
      throw new Error("SUPABASE_ANON_KEY ontbreekt in Edge Function secrets.");
    }

    await requireAuthenticatedUser(req);

    const data = await req.json();

    const toEmail = data.toEmail || DEFAULT_TO_EMAIL;
    const fromEmail = data.fromEmail || DEFAULT_FROM_EMAIL;
    const subject = data.subject || "Nieuwe declaratie";
    const html = data.html || buildFallbackHtml(data);
    const text = data.text || buildFallbackText(data);

    const attachmentsInput: AttachmentInput[] = Array.isArray(data.attachments)
      ? data.attachments
      : [];

    const attachments = attachmentsInput.length
      ? await buildResendAttachments(attachmentsInput)
      : [];

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY ontbreekt in Edge Function secrets.");
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject,
        html,
        text,
        attachments,
      }),
    });

    const resendData = await resendResponse.json().catch(() => ({}));

    return new Response(
      JSON.stringify({
        success: resendResponse.ok,
        error: resendResponse.ok
          ? null
          : resendData?.message || resendData?.error || "Mail verzenden mislukt.",
        resend: resendData,
      }),
      {
        status: resendResponse.ok ? 200 : resendResponse.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Onbekende fout",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});