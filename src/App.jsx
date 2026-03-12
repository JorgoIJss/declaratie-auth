import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus,
  Send,
  Trash2,
  Pencil,
  History,
  Settings,
  Receipt,
  Upload,
  Save,
  Eye,
  Paperclip,
  Mail,
} from "lucide-react";

const RECEIPTS_BUCKET = "declaratie-bonnen";
const SUPABASE_STORAGE_ROOT = "receipts";
const SEND_DECLARATION_ENDPOINT =
  "https://aecakvgfqpcgoagzangn.supabase.co/functions/v1/send-declaration";

const defaultSettings = {
  fromEmail: "Declaraties <declaraties_amervallei@growth-dynamics.nl>",
  toEmail: "penningmeester@amervallei.nl",
  fromName: "J. IJsselsteijn",
  iban: "NL37INGB07492765333",
  accountName: "J. IJsselsteijn",
  signatureName: "Jorgo",
  sendIndividuallyByDefault: false,
};

const blankDraft = () => ({
  id: crypto.randomUUID(),
  date: new Date().toISOString().slice(0, 10),
  amount: "",
  supplier: "",
  reason: "",
  hasReceipt: true,
  noReceiptReason: "",
  note: "",
  attachment: null,
  attachmentName: "",
  attachmentType: "",
  attachmentPath: "",
  attachmentPublicUrl: "",
  submitterName: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const mailPreviewCss = `
.mail-preview-content,
.mail-preview-content * {
  box-sizing: border-box;
  max-width: 100%;
}

.mail-preview-content table {
  width: 100% !important;
  max-width: 100% !important;
  table-layout: fixed;
  border-collapse: collapse;
}

.mail-preview-content thead,
.mail-preview-content tbody,
.mail-preview-content tr {
  width: 100%;
}

.mail-preview-content th,
.mail-preview-content td {
  white-space: normal !important;
  word-break: break-word;
  overflow-wrap: anywhere;
  vertical-align: top;
}

.mail-preview-content img {
  max-width: 100% !important;
  height: auto !important;
}

.mail-preview-content p {
  overflow-wrap: anywhere;
}
`;

function euro(value) {
  const num = Number(String(value).replace(",", ".")) || 0;
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(num);
}

function fileSafe(text) {
  return (text || "Declaratie")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "") || "Declaratie";
}

function compactDate(dateValue) {
  return String(dateValue || "").replace(/-/g, "");
}

function formatDateNl(dateValue) {
  if (!dateValue) return "-";
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return dateValue;
  return d.toLocaleDateString("nl-NL");
}

function detailText(d) {
  const bits = [];
  if (d.note) bits.push(d.note);
  if (!d.hasReceipt && d.noReceiptReason) bits.push(`Geen bon: ${d.noReceiptReason}`);
  return bits.join(" | ");
}

function getFileExtension(filename) {
  const name = String(filename || "");
  if (!name.includes(".")) return "jpg";
  return name.split(".").pop().toLowerCase() || "jpg";
}

function sanitizeAttachmentFilename(name) {
  return String(name || "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildAttachmentFilename(declaration, submitterName = "Jorgo", index = null) {
  const original = declaration.attachmentName || "bon.jpg";
  const ext = getFileExtension(original);
  const parts = [
    compactDate(declaration.date),
    fileSafe(declaration.supplier),
    fileSafe(declaration.reason),
  ];

  if (index !== null && index !== undefined) {
    parts.push(String(index));
  }

  parts.push(fileSafe(submitterName));

  return sanitizeAttachmentFilename(`${parts.filter(Boolean).join("_")}.${ext}`);
}

function buildAttachmentFilenameFromFile(file, declaration, submitterName = "Jorgo") {
  const ext = getFileExtension(file?.name);
  return sanitizeAttachmentFilename(
    `${[
      compactDate(declaration.date),
      fileSafe(declaration.supplier),
      fileSafe(declaration.reason),
      fileSafe(submitterName),
    ]
      .filter(Boolean)
      .join("_")}.${ext}`
  );
}

function buildUniqueFileName(declaration, index, submitterName = "Jorgo") {
  return buildAttachmentFilename(declaration, submitterName, index);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildEmailData(batch, settings) {
  const total = batch.reduce(
    (sum, d) => sum + (Number(String(d.amount).replace(",", ".")) || 0),
    0
  );

  const firstDeclarationLabel = `${compactDate(batch[0].date)}_${fileSafe(
    batch[0].supplier
  )}_${fileSafe(batch[0].reason)}`;

  const subject =
    batch.length === 1
      ? `Declaratie BGA - ${firstDeclarationLabel}`
      : `Declaraties BGA - ${firstDeclarationLabel}`;

  const rows = batch
    .map(
      (d, idx) => `
      <tr>
        <td style="padding:10px;border:1px solid #d4d4d8;vertical-align:top;">${idx + 1}</td>
        <td style="padding:10px;border:1px solid #d4d4d8;vertical-align:top;">${escapeHtml(
          compactDate(d.date)
        )}</td>
        <td style="padding:10px;border:1px solid #d4d4d8;vertical-align:top;">${escapeHtml(
          d.supplier
        )}</td>
        <td style="padding:10px;border:1px solid #d4d4d8;vertical-align:top;">${escapeHtml(
          d.reason
        )}</td>
        <td style="padding:10px;border:1px solid #d4d4d8;vertical-align:top;white-space:nowrap;">${escapeHtml(
          euro(d.amount)
        )}</td>
        <td style="padding:10px;border:1px solid #d4d4d8;vertical-align:top;">${
          d.hasReceipt ? "Ja" : "Nee"
        }</td>
        <td style="padding:10px;border:1px solid #d4d4d8;vertical-align:top;">${escapeHtml(
          detailText(d) || "-"
        )}</td>
        <td style="padding:10px;border:1px solid #d4d4d8;vertical-align:top;">${escapeHtml(
          d.attachmentName ? buildUniqueFileName(d, idx + 1, settings.signatureName) : "-"
        )}</td>
      </tr>`
    )
    .join("\n");

  const htmlBody = `
    <html>
      <body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.5;">
        <p>Beste penningmeester,</p>
        <p>Hierbij dien ik ${batch.length === 1 ? "een declaratie" : `<strong>${batch.length}</strong> declaraties`} in.</p>
        <table style="border-collapse:collapse;width:100%;">
          <thead>
            <tr>
              <th style="padding:10px;border:1px solid #d4d4d8;background:#f8fafc;text-align:left;">Nr</th>
              <th style="padding:10px;border:1px solid #d4d4d8;background:#f8fafc;text-align:left;">Datum</th>
              <th style="padding:10px;border:1px solid #d4d4d8;background:#f8fafc;text-align:left;">Leverancier</th>
              <th style="padding:10px;border:1px solid #d4d4d8;background:#f8fafc;text-align:left;">Reden</th>
              <th style="padding:10px;border:1px solid #d4d4d8;background:#f8fafc;text-align:left;">Bedrag</th>
              <th style="padding:10px;border:1px solid #d4d4d8;background:#f8fafc;text-align:left;">Bon</th>
              <th style="padding:10px;border:1px solid #d4d4d8;background:#f8fafc;text-align:left;">Opmerking</th>
              <th style="padding:10px;border:1px solid #d4d4d8;background:#f8fafc;text-align:left;">Bestandsnaam</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr>
              <td colspan="4" style="padding:10px;border:1px solid #d4d4d8;background:#f8fafc;text-align:right;"><strong>Totaal</strong></td>
              <td style="padding:10px;border:1px solid #d4d4d8;background:#f8fafc;"><strong>${escapeHtml(
                euro(total)
              )}</strong></td>
              <td colspan="3" style="padding:10px;border:1px solid #d4d4d8;background:#f8fafc;"></td>
            </tr>
          </tbody>
        </table>
        <p style="margin-top:18px;">IBAN: ${escapeHtml(settings.iban)}<br>Ten name van: ${escapeHtml(
    settings.accountName
  )}</p>
        <p>Met vriendelijke groet,<br>${escapeHtml(settings.signatureName)}</p>
      </body>
    </html>`;

  const header =
    "Nr   Datum       Leverancier        Reden               Bedrag      Bon   Opmerking                 Bestandsnaam";
  const separator =
    "--------------------------------------------------------------------------------------------------------------------------";

  const textRows = batch
    .map((d, idx) => {
      const nr = String(idx + 1).padEnd(4);
      const datum = compactDate(d.date).padEnd(12);
      const leverancier = (d.supplier || "").substring(0, 18).padEnd(18);
      const reden = (d.reason || "").substring(0, 18).padEnd(18);
      const bedrag = euro(d.amount).padEnd(12);
      const bon = (d.hasReceipt ? "Ja" : "Nee").padEnd(5);
      const opmerking = (detailText(d) || "-").substring(0, 25).padEnd(25);
      const bestandsnaam = d.attachmentName
        ? buildUniqueFileName(d, idx + 1, settings.signatureName)
        : "-";
      return `${nr}${datum}${leverancier}${reden}${bedrag}${bon}${opmerking}${bestandsnaam}`;
    })
    .join("\n");

  const textBody = `Beste penningmeester,

Hierbij dien ik ${
    batch.length === 1 ? "een declaratie" : `${batch.length} declaraties`
  } in.

${header}
${separator}
${textRows}

Totaal batch: ${euro(total)}

IBAN: ${settings.iban}
Ten name van: ${settings.accountName}

Met vriendelijke groet,
${settings.signatureName}`;

  return {
    subject,
    textBody,
    htmlBody,
    mode: batch.length === 1 ? "single" : "batch",
  };
}

function mapSettingsFromDb(row) {
  if (!row) return { ...defaultSettings };
  return {
    ...defaultSettings,
    fromEmail: row.from_email ?? defaultSettings.fromEmail,
    toEmail: row.to_email ?? defaultSettings.toEmail,
    fromName: row.from_name ?? defaultSettings.fromName,
    iban: row.iban ?? defaultSettings.iban,
    accountName: row.account_name ?? defaultSettings.accountName,
    signatureName: row.signature_name ?? defaultSettings.signatureName,
    sendIndividuallyByDefault:
      row.send_individually_by_default ?? defaultSettings.sendIndividuallyByDefault,
  };
}

function mapSettingsToDb(settings, userId, existingId = null) {
  return {
    id: existingId || crypto.randomUUID(),
    user_id: userId,
    from_email: settings.fromEmail,
    to_email: settings.toEmail,
    from_name: settings.fromName,
    iban: settings.iban,
    account_name: settings.accountName,
    signature_name: settings.signatureName,
    send_individually_by_default: settings.sendIndividuallyByDefault,
    updated_at: new Date().toISOString(),
  };
}

function mapDeclarationFromDb(row) {
  return {
    id: row.id,
    date: row.date,
    amount: row.amount != null ? String(row.amount) : "",
    supplier: row.supplier || "",
    reason: row.reason || "",
    hasReceipt: row.has_receipt ?? true,
    noReceiptReason: row.no_receipt_reason || "",
    note: row.note || "",
    attachment: null,
    attachmentName: row.attachment_name || "",
    attachmentType: row.attachment_type || "",
    attachmentPath: row.attachment_path || "",
    attachmentPublicUrl: row.attachment_public_url || "",
    submitterName: row.submitter_name || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

function mapDeclarationToDb(draft, userId) {
  return {
    id: draft.id,
    user_id: userId,
    date: draft.date,
    amount: Number(String(draft.amount).replace(",", ".")),
    supplier: draft.supplier,
    reason: draft.reason,
    has_receipt: draft.hasReceipt,
    no_receipt_reason: draft.noReceiptReason || null,
    note: draft.note || null,
    attachment_name: draft.attachmentName || null,
    attachment_type: draft.attachmentType || null,
    attachment_path: draft.attachmentPath || null,
    attachment_public_url: draft.attachmentPublicUrl || null,
    submitter_name: draft.submitterName || null,
    created_at: draft.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}


function SignupAttemptsAdminTab({ user }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState({ checked:false, admin:false, approver:false });

  useEffect(()=>{
    async function loadRole(){
      if(!user?.id) return;
      const {data} = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      const r=(data||[]).map(x=>x.role);
      setRoles({checked:true, admin:r.includes("admin"), approver:r.includes("approver")});
    }
    loadRole();
  },[user?.id]);

  async function loadAttempts(){
    setLoading(true);
    const {data}=await supabase.rpc("get_recent_signup_attempts",{limit_count:100});
    setItems(data||[]);
    setLoading(false);
  }

  useEffect(()=>{
    if(roles.admin||roles.approver) loadAttempts();
  },[roles]);

  if(!roles.checked || (!roles.admin && !roles.approver)) return null;

  return (
    <Card className="rounded-[28px] border-white/70 bg-white/80 shadow-sm backdrop-blur">
      <CardHeader>
        <CardTitle>Signup attempts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={loadAttempts} disabled={loading}>Vernieuwen</Button>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Naam</TableHead>
              <TableHead>Pogingen</TableHead>
              <TableHead>Geheim</TableHead>
              <TableHead>Geblokkeerd tot</TableHead>
              <TableHead>Laatste poging</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(i=>(
              <TableRow key={i.id}>
                <TableCell>{i.email}</TableCell>
                <TableCell>{i.display_name}</TableCell>
                <TableCell>{i.attempt_count}</TableCell>
                <TableCell>{i.secret_ok ? "OK":"FOUT"}</TableCell>
                <TableCell>{i.blocked_until? new Date(i.blocked_until).toLocaleString("nl-NL"):"-"}</TableCell>
                <TableCell>{new Date(i.updated_at).toLocaleString("nl-NL")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}


export default function DeclaratiesWebApp() {
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [tab, setTab] = useState("declaraties");
  const [batch, setBatch] = useState([]);
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [currentUser, setCurrentUser] = useState(null);
  const [session, setSession] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [profileName, setProfileName] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [draft, setDraft] = useState(blankDraft());
  const [editingId, setEditingId] = useState(null);
  const [message, setMessage] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isBootLoading, setIsBootLoading] = useState(true);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [previewState, setPreviewState] = useState({
    open: false,
    groups: [],
    sendIndividually: false,
  });
  const [previewUi, setPreviewUi] = useState({
    zoom: 100,
    width: 1000,
    height: 620,
  });

  const settingsLoadedRef = useRef(false);
  const settingsAutoSaveTimeoutRef = useRef(null);

  const total = useMemo(
    () =>
      batch.reduce((sum, d) => sum + (Number(String(d.amount).replace(",", ".")) || 0), 0),
    [batch]
  );

  useEffect(() => {
    let mounted = true;

    async function bootstrapAuth() {
      setIsAuthLoading(true);
      const {
        data: { session: activeSession },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      setSession(activeSession || null);
      setCurrentUser(activeSession?.user ?? null);
      setIsAuthLoading(false);
    }

    bootstrapAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      setCurrentUser(nextSession?.user ?? null);
      setMessage("");
      setAuthError("");
      settingsLoadedRef.current = false;

      if (!nextSession?.user) {
        setBatch([]);
        setHistory([]);
        setSettings(defaultSettings);
        setProfileName("");
        setTab("declaraties");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      if (settingsAutoSaveTimeoutRef.current) {
        clearTimeout(settingsAutoSaveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadAppData() {
      if (!currentUser?.id) {
        setIsBootLoading(false);
        return;
      }

      setIsBootLoading(true);

      try {
        const [profileRes, settingsRes, batchRes, historyRes] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", currentUser.id).maybeSingle(),
          supabase.from("user_settings").select("*").eq("user_id", currentUser.id).maybeSingle(),
          supabase
            .from("declarations")
            .select("*")
            .eq("user_id", currentUser.id)
            .order("created_at", { ascending: true }),
          supabase
            .from("send_history")
            .select("*")
            .eq("user_id", currentUser.id)
            .order("sent_at", { ascending: false }),
        ]);

        if (profileRes.error) throw profileRes.error;
        if (settingsRes.error) throw settingsRes.error;
        if (batchRes.error) throw batchRes.error;
        if (historyRes.error) throw historyRes.error;
        if (!active) return;

        setProfileName(profileRes.data?.display_name || currentUser.email || "");
        setSettings(mapSettingsFromDb(settingsRes.data));
        setBatch((batchRes.data || []).map(mapDeclarationFromDb));
        setHistory(
          (historyRes.data || []).map((row) => ({
            id: row.id,
            sentAt: row.sent_at,
            mode: row.mode,
            subject: row.subject,
            declarations: Array.from({ length: row.declaration_count || 0 }, () => ({})),
          }))
        );

        settingsLoadedRef.current = true;
      } catch (err) {
        console.error(err);
        if (active) setMessage(`Laden uit Supabase mislukt: ${err.message}`);
      } finally {
        if (active) setIsBootLoading(false);
      }
    }

    loadAppData();

    return () => {
      active = false;
      if (settingsAutoSaveTimeoutRef.current) {
        clearTimeout(settingsAutoSaveTimeoutRef.current);
      }
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id || !settingsLoadedRef.current || isBootLoading) return;
    if (settingsAutoSaveTimeoutRef.current) clearTimeout(settingsAutoSaveTimeoutRef.current);
    settingsAutoSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await upsertSettings(settings, false);
      } catch (err) {
        console.error(err);
      }
    }, 700);
    return () => {
      if (settingsAutoSaveTimeoutRef.current) clearTimeout(settingsAutoSaveTimeoutRef.current);
    };
  }, [settings, isBootLoading, currentUser?.id]);

  async function handleAuthSubmit({ mode, email, password, displayName }) {
    setIsAuthSubmitting(true);
    setAuthError("");

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName || "",
            },
          },
        });

        if (error) throw error;

        setAuthMode("login");
        setAuthError(
          "Account aangemaakt. Controleer je e-mail als bevestiging aan staat en log daarna in."
        );
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
    } catch (err) {
      console.error(err);
      setAuthError(err.message || "Inloggen mislukt.");
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleForgotPassword(email) {
    if (!email) {
      setAuthError("Vul eerst je e-mailadres in.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError("");

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });

      if (error) throw error;

      setAuthError("Er is een resetmail verstuurd als dit account bestaat.");
    } catch (err) {
      console.error(err);
      setAuthError(err.message || "Resetten mislukt.");
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  async function upsertSettings(nextSettings, showFeedback = true) {
    if (!currentUser?.id) return;

    setIsSavingSettings(true);

    const existingId =
      (
        await supabase
          .from("user_settings")
          .select("id")
          .eq("user_id", currentUser.id)
          .maybeSingle()
      ).data?.id || null;

    const { error } = await supabase
      .from("user_settings")
      .upsert(mapSettingsToDb(nextSettings, currentUser.id, existingId), { onConflict: "user_id" });

    setIsSavingSettings(false);

    if (error) {
      if (showFeedback) setMessage(`Opslaan instellingen mislukt: ${error.message}`);
      throw error;
    }

    if (showFeedback) setMessage("Instellingen opgeslagen in Supabase.");
  }

  async function uploadAttachment(file, declaration) {
    if (!file) {
      return {
        attachmentName: declaration.attachmentName || "",
        attachmentType: declaration.attachmentType || "",
        attachmentPath: declaration.attachmentPath || "",
        attachmentPublicUrl: declaration.attachmentPublicUrl || "",
      };
    }

    const cleanFileName = buildAttachmentFilenameFromFile(
      file,
      declaration,
      settings.signatureName || declaration.submitterName || "Jorgo"
    );
    const filePath = `${SUPABASE_STORAGE_ROOT}/${currentUser.id}/${declaration.id}-${cleanFileName}`;

    const { error: uploadError } = await supabase.storage
      .from(RECEIPTS_BUCKET)
      .upload(filePath, file, {
        upsert: true,
        contentType: file.type || "application/octet-stream",
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from(RECEIPTS_BUCKET).getPublicUrl(filePath);

    return {
      attachmentName: cleanFileName,
      attachmentType: file.type || declaration.attachmentType || "application/octet-stream",
      attachmentPath: filePath,
      attachmentPublicUrl: publicUrlData?.publicUrl || "",
    };
  }

  async function removeAttachmentByPath(filePath) {
    if (!filePath) return;
    const { error } = await supabase.storage.from(RECEIPTS_BUCKET).remove([filePath]);
    if (error) console.error("Verwijderen bijlage mislukt:", error.message);
  }

  function openNewDialog() {
    setEditingId(null);
    setDialogError("");
    setDraft(blankDraft());
    setIsDialogOpen(true);
  }

  function openEditDialog(item) {
    setEditingId(item.id);
    setDialogError("");
    setDraft({ ...item, attachment: null });
    setIsDialogOpen(true);
  }

  async function saveDraft() {
    setDialogError("");

    if (!draft.date || !draft.amount || !draft.supplier || !draft.reason) {
      setDialogError("Vul datum, bedrag, leverancier en reden in.");
      return;
    }

    const normalizedAmount = Number(String(draft.amount).replace(",", "."));
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
      setDialogError("Vul een geldig bedrag in, bijvoorbeeld 12,50.");
      return;
    }

    const hasExistingAttachment = Boolean(draft.attachment || draft.attachmentName);
    if (!hasExistingAttachment && draft.hasReceipt) {
      setDialogError("Voeg een foto of bestand van de bon toe.");
      return;
    }

    if (!draft.hasReceipt && !draft.noReceiptReason) {
      setDialogError("Vul een reden in als er geen bon aanwezig is.");
      return;
    }

    setIsSavingDraft(true);

    try {
      const previousVersion = editingId ? batch.find((x) => x.id === editingId) : null;
      const attachmentMeta = await uploadAttachment(draft.attachment, draft);

      if (
        draft.attachment &&
        previousVersion?.attachmentPath &&
        previousVersion.attachmentPath !== attachmentMeta.attachmentPath
      ) {
        await removeAttachmentByPath(previousVersion.attachmentPath);
      }

      const normalized = {
        ...draft,
        ...attachmentMeta,
        attachment: null,
        submitterName: settings.signatureName || "Jorgo",
        amount: String(draft.amount).replace(",", "."),
        createdAt: draft.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const payload = mapDeclarationToDb(normalized, currentUser.id);
      const { error } = await supabase.from("declarations").upsert(payload, { onConflict: "id" });
      if (error) throw error;

      setBatch((prev) => {
        const next = editingId
          ? prev.map((x) => (x.id === editingId ? normalized : x))
          : [...prev, normalized];
        return next.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
      });

      setMessage(
        editingId
          ? "Declaratie bijgewerkt in Supabase."
          : "Declaratie toegevoegd aan de batch in Supabase."
      );
      setDialogError("");
      setIsDialogOpen(false);
      setDraft(blankDraft());
      setEditingId(null);
    } catch (err) {
      console.error(err);
      setDialogError(`Opslaan mislukt: ${err.message}`);
    } finally {
      setIsSavingDraft(false);
    }
  }

  async function deleteDraft(id) {
    const item = batch.find((x) => x.id === id);
    try {
      const { error } = await supabase.from("declarations").delete().eq("id", id);
      if (error) throw error;
      if (item?.attachmentPath) await removeAttachmentByPath(item.attachmentPath);
      setBatch((prev) => prev.filter((x) => x.id !== id));
      setMessage("Declaratie verwijderd uit Supabase.");
    } catch (err) {
      console.error(err);
      setMessage(`Verwijderen mislukt: ${err.message}`);
    }
  }

  async function clearBatch() {
    if (!batch.length) return;
    try {
      const ids = batch.map((item) => item.id).filter(Boolean);
      const filePaths = batch.map((item) => item.attachmentPath).filter(Boolean);
      const { error } = await supabase.from("declarations").delete().in("id", ids);
      if (error) throw error;
      if (filePaths.length) await supabase.storage.from(RECEIPTS_BUCKET).remove(filePaths);
      setBatch([]);
      setMessage("Batch geleegd in Supabase.");
    } catch (err) {
      console.error(err);
      setMessage(`Batch leegmaken mislukt: ${err.message}`);
    }
  }

  function openPreview(sendIndividually = settings.sendIndividuallyByDefault) {
    if (!batch.length) {
      setMessage("Voeg eerst minimaal één declaratie toe.");
      return;
    }

    const groups = sendIndividually ? batch.map((d) => [d]) : [batch];
    setPreviewState({ open: true, groups, sendIndividually });
    setMessage("");
  }

  async function insertHistoryGroup(group, emailData) {
    const historyId = crypto.randomUUID();
    const historyRow = {
      id: historyId,
      user_id: currentUser.id,
      sent_at: new Date().toISOString(),
      mode: emailData.mode,
      subject: emailData.subject,
      declaration_count: group.length,
    };

    const { error: historyError } = await supabase.from("send_history").insert(historyRow);
    if (historyError) throw historyError;

    const itemRows = group.map((g, index) => ({
      history_id: historyId,
      user_id: currentUser.id,
      declaration_id: g.id,
      date: g.date,
      supplier: g.supplier,
      reason: g.reason,
      amount: Number(String(g.amount).replace(",", ".")),
      has_receipt: g.hasReceipt,
      no_receipt_reason: g.noReceiptReason || null,
      note: g.note || null,
      attachment_name: g.attachmentName || null,
      position: index + 1,
    }));

    const { error: itemsError } = await supabase.from("send_history_items").insert(itemRows);
    if (itemsError) throw itemsError;

    return {
      id: historyId,
      sentAt: historyRow.sent_at,
      mode: historyRow.mode,
      subject: historyRow.subject,
      declarations: group,
    };
  }

  async function sendGroupToEdgeFunction(group) {
    const emailData = buildEmailData(group, settings);
    const accessToken = session?.access_token;

    if (!accessToken) {
      throw new Error("Je sessie is verlopen. Log opnieuw in.");
    }

    const attachments = group
      .filter((item) => item.attachmentName && (item.attachmentPublicUrl || item.attachmentPath))
      .map((item, index) => ({
        filename: buildUniqueFileName(item, index + 1, settings.signatureName),
        url: item.attachmentPublicUrl || null,
        path: item.attachmentPath || null,
        attachmentPublicUrl: item.attachmentPublicUrl || null,
        attachmentPath: item.attachmentPath || null,
        contentType: item.attachmentType || "application/octet-stream",
      }));

    const response = await fetch(SEND_DECLARATION_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        subject: emailData.subject,
        html: emailData.htmlBody,
        text: emailData.textBody,
        toEmail: settings.toEmail,
        fromEmail: settings.fromEmail,
        attachments,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || data?.message || "Mail verzenden mislukt.");
    }

    return { responseData: data, emailData };
  }

  async function sendBatch(sendIndividually = settings.sendIndividuallyByDefault) {
    if (!settings.fromEmail || !settings.toEmail) {
      setTab("settings");
      setMessage("Vul eerst het van- en naaradres in op de instellingenpagina.");
      return;
    }

    if (!batch.length) {
      setMessage("Voeg eerst minimaal één declaratie toe.");
      return;
    }

    setIsSending(true);
    setMessage("");

    try {
      const groups = sendIndividually ? batch.map((d) => [d]) : [batch];
      const historyEntries = [];
      const sentIds = [];
      const sentPaths = [];

      for (const group of groups) {
        const { emailData } = await sendGroupToEdgeFunction(group);
        const historyEntry = await insertHistoryGroup(group, emailData);
        historyEntries.push(historyEntry);
        sentIds.push(...group.map((item) => item.id).filter(Boolean));
        sentPaths.push(...group.map((item) => item.attachmentPath).filter(Boolean));
      }

      if (sentIds.length) {
        const { error: deleteError } = await supabase
          .from("declarations")
          .delete()
          .in("id", sentIds);
        if (deleteError) throw deleteError;
      }

      if (sentPaths.length) {
        await supabase.storage.from(RECEIPTS_BUCKET).remove(sentPaths);
      }

      setHistory((prev) => [...historyEntries, ...prev]);
      setBatch((prev) => prev.filter((item) => !sentIds.includes(item.id)));
      setTab("declaraties");
      setMessage(
        `Mail${groups.length > 1 ? "s" : ""} verzonden, historie opgeslagen en batch bijgewerkt.`
      );
    } catch (err) {
      console.error(err);
      setMessage(`Verzenden mislukt: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  }

  async function saveSettingsToSupabase() {
    try {
      await upsertSettings(settings, true);
    } catch (err) {
      console.error(err);
    }
  }

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-transparent px-3 pb-6 pt-[max(12px,env(safe-area-inset-top))] md:px-6 md:pb-8">
        <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
          <Card className="w-full rounded-[28px] border-white/70 bg-white/85 shadow-sm backdrop-blur">
            <CardHeader>
              <CardTitle>Authenticatie laden...</CardTitle>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        authMode={authMode}
        setAuthMode={setAuthMode}
        onSubmit={handleAuthSubmit}
        onForgotPassword={handleForgotPassword}
        authError={authError}
        isSubmitting={isAuthSubmitting}
      />
    );
  }

  return (
    <div className="min-h-screen bg-transparent px-3 pb-6 pt-[max(12px,env(safe-area-inset-top))] md:px-6 md:pb-8">
      <div className="mx-auto w-full max-w-6xl space-y-4 md:space-y-6">
        <div className="rounded-[28px] border border-white/60 bg-white/75 p-4 shadow-sm backdrop-blur md:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="mb-2 inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                Declaraties
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                Declaraties webapp
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Alle batch-, historie-, settings- en bondata worden uit Supabase geladen en daarin opgeslagen.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <Badge variant="secondary">{profileName || currentUser.email}</Badge>
                <Badge variant="outline">{currentUser.email}</Badge>
              </div>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto">
              <Button
              onClick={openNewDialog}
              className="h-11 w-full rounded-2xl px-4 text-[15px] font-semibold shadow-sm sm:w-auto"
              disabled={isBootLoading}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nieuwe declaratie
            </Button>

            <Button
              variant="outline"
              onClick={handleSignOut}
              className="h-11 w-full rounded-2xl px-4 text-[15px] font-semibold shadow-sm sm:w-auto"
            >
              Uitloggen
            </Button>
            </div>
          </div>
        </div>

        {message && (
          <Alert className="rounded-[24px] border-white/70 bg-white/80 shadow-sm">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}

        {isBootLoading && (
          <Alert className="rounded-[24px] border-blue-200 bg-blue-50 text-blue-900 shadow-sm">
            <AlertDescription>Gegevens worden geladen uit Supabase...</AlertDescription>
          </Alert>
        )}

        <Tabs value={tab} onValueChange={setTab} className="space-y-5 md:space-y-6">
          <TabsList className="grid h-auto w-full grid-cols-3 rounded-[22px] border border-slate-200 bg-white/80 p-1 shadow-sm backdrop-blur">
            <TabsTrigger
              value="declaraties"
              className="rounded-2xl px-2 py-3 text-[11px] font-semibold sm:text-sm"
            >
              <Receipt className="mr-1.5 h-4 w-4" />
              Declaraties
            </TabsTrigger>
            <TabsTrigger
              value="historie"
              className="rounded-2xl px-2 py-3 text-[11px] font-semibold sm:text-sm"
            >
              <History className="mr-1.5 h-4 w-4" />
              Historie
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="rounded-2xl px-2 py-3 text-[11px] font-semibold sm:text-sm"
            >
              <Settings className="mr-1.5 h-4 w-4" />
              Settings
            </TabsTrigger>
            <TabsTrigger value="signup-attempts">Signup attempts</TabsTrigger>
</TabsList>

          <TabsContent value="declaraties" className="space-y-4 md:space-y-6">
            <div className="grid gap-4 md:gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <Card className="order-1 rounded-[28px] border-white/70 bg-white/80 shadow-sm backdrop-blur lg:order-1">
                <CardHeader className="pb-3">
                  <CardTitle>Acties</CardTitle>
                </CardHeader>

                <CardContent className="space-y-4 min-w-0">
                  <div className="rounded-3xl bg-slate-100/90 p-4">
                    <div className="text-sm text-slate-500">Aantal declaraties</div>
                    <div className="mt-1 text-3xl font-semibold">{batch.length}</div>
                  </div>

                  <div className="rounded-3xl bg-slate-100/90 p-4">
                    <div className="text-sm text-slate-500">Totaalbedrag</div>
                    <div className="mt-1 text-3xl font-semibold">{euro(total)}</div>
                  </div>

                  <Separator />

                  <div className="sticky bottom-0 z-10 -mx-1 rounded-3xl bg-white/95 p-1 backdrop-blur supports-[backdrop-filter]:bg-white/80">
                    <div className="space-y-2">
                      <Button
                        className="h-11 w-full rounded-2xl"
                        onClick={() => openPreview(false)}
                        disabled={isSending || batch.length === 0 || isBootLoading}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        Bekijk batchmail
                      </Button>

                      <Button
                        className="h-11 w-full rounded-2xl"
                        variant="secondary"
                        onClick={() => openPreview(true)}
                        disabled={isSending || batch.length === 0 || isBootLoading}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        Bekijk losse mails
                      </Button>

                      <Button
                        className="h-11 w-full rounded-2xl"
                        variant="outline"
                        onClick={clearBatch}
                        disabled={isSending || batch.length === 0 || isBootLoading}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Batch leegmaken
                      </Button>
                    </div>
                  </div>

                  <p className="text-xs leading-5 text-slate-500">
                    Verzenden loopt via Supabase Edge Function + Resend. Bonnen gaan als bijlage mee.
                  </p>
                </CardContent>
              </Card>

              <Card className="order-2 rounded-[28px] border-white/70 bg-white/80 shadow-sm backdrop-blur lg:order-2">
                <CardHeader className="pb-3">
                  <CardTitle>Huidige batch</CardTitle>
                </CardHeader>

                <CardContent className="space-y-4">
                  {batch.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center text-sm text-slate-500">
                      Nog geen declaraties toegevoegd.
                    </div>
                  ) : (
                    <>
                      <div className="space-y-3 md:hidden">
                        {batch.map((item, idx) => (
                          <div
                            key={item.id}
                            className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
                          >
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-900">
                                  {idx + 1}. {item.supplier}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {formatDateNl(item.date)}
                                </div>
                              </div>
                              <Badge variant={item.hasReceipt ? "default" : "secondary"}>
                                {item.hasReceipt ? "Bon" : "Geen bon"}
                              </Badge>
                            </div>

                            <div className="space-y-2 text-sm">
                              <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                <span className="font-medium text-slate-500">Reden:</span>{" "}
                                <span className="text-slate-900">{item.reason}</span>
                              </div>
                              <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                <span className="font-medium text-slate-500">Bedrag:</span>{" "}
                                <span className="text-slate-900">{euro(item.amount)}</span>
                              </div>
                              {detailText(item) ? (
                                <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                  <span className="font-medium text-slate-500">Opmerking:</span>{" "}
                                  <span className="text-slate-900">{detailText(item)}</span>
                                </div>
                              ) : null}
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-10 rounded-2xl"
                                onClick={() => openEditDialog(item)}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                Bewerk
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-10 rounded-2xl"
                                onClick={() => deleteDraft(item.id)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Verwijder
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="hidden overflow-hidden rounded-3xl border bg-white md:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Nr</TableHead>
                              <TableHead>Datum</TableHead>
                              <TableHead>Leverancier</TableHead>
                              <TableHead>Reden</TableHead>
                              <TableHead>Bedrag</TableHead>
                              <TableHead>Bon</TableHead>
                              <TableHead>Acties</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {batch.map((item, idx) => (
                              <TableRow key={item.id}>
                                <TableCell>{idx + 1}</TableCell>
                                <TableCell>{compactDate(item.date)}</TableCell>
                                <TableCell>{item.supplier}</TableCell>
                                <TableCell>{item.reason}</TableCell>
                                <TableCell>{euro(item.amount)}</TableCell>
                                <TableCell>
                                  <Badge variant={item.hasReceipt ? "default" : "secondary"}>
                                    {item.hasReceipt ? "Ja" : "Nee"}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => openEditDialog(item)}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => deleteDraft(item.id)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="historie">
            <Card className="rounded-[28px] border-white/70 bg-white/80 shadow-sm backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle>Historie</CardTitle>
              </CardHeader>

              <CardContent className="space-y-4">
                {history.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center text-sm text-slate-500">
                    Nog geen verzonden batches.
                  </div>
                ) : (
                  history.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900">{entry.subject}</div>
                          <div className="mt-1 text-sm text-slate-500">
                            {new Date(entry.sentAt).toLocaleString("nl-NL")} • {entry.mode}
                          </div>
                        </div>
                        <Badge>{entry.declarations.length} declaratie(s)</Badge>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings">
            <Card className="rounded-[28px] border-white/70 bg-white/80 shadow-sm backdrop-blur">
              <CardHeader className="pb-3">
                <CardTitle>Settings</CardTitle>
              </CardHeader>

              <CardContent className="space-y-6">
                <Alert className="rounded-3xl border-blue-200 bg-blue-50 text-blue-900">
                  <AlertDescription>
                    Deze versie gebruikt je Supabase Edge Function voor verzending. SMTP-velden zijn niet meer nodig; alleen afzender, ontvanger en declaratiegegevens.
                  </AlertDescription>
                </Alert>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Van e-mailadres">
                    <Input
                      className="h-11 rounded-2xl"
                      value={settings.fromEmail}
                      onChange={(e) => setSettings({ ...settings, fromEmail: e.target.value })}
                    />
                  </Field>

                  <Field label="Van naam">
                    <Input
                      className="h-11 rounded-2xl"
                      value={settings.fromName}
                      onChange={(e) => setSettings({ ...settings, fromName: e.target.value })}
                    />
                  </Field>

                  <Field label="Naar e-mailadres">
                    <Input
                      className="h-11 rounded-2xl"
                      value={settings.toEmail}
                      onChange={(e) => setSettings({ ...settings, toEmail: e.target.value })}
                    />
                  </Field>

                  <Field label="IBAN">
                    <Input
                      className="h-11 rounded-2xl"
                      value={settings.iban}
                      onChange={(e) => setSettings({ ...settings, iban: e.target.value })}
                    />
                  </Field>

                  <Field label="Rekeninghouder">
                    <Input
                      className="h-11 rounded-2xl"
                      value={settings.accountName}
                      onChange={(e) => setSettings({ ...settings, accountName: e.target.value })}
                    />
                  </Field>

                  <Field label="Naam ondertekening">
                    <Input
                      className="h-11 rounded-2xl"
                      value={settings.signatureName}
                      onChange={(e) => setSettings({ ...settings, signatureName: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium text-slate-900">Standaard los versturen</div>
                    <div className="text-sm text-slate-500">
                      Als dit aan staat, wordt elke declaratie in een aparte mail voorbereid.
                    </div>
                  </div>
                  <Switch
                    checked={settings.sendIndividuallyByDefault}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, sendIndividuallyByDefault: checked })
                    }
                  />
                </div>

                <div className="rounded-3xl border bg-slate-50 p-4 text-sm text-slate-600">
                  <div className="font-medium text-slate-900">Endpoint</div>
                  <div className="mt-1 break-all">{SEND_DECLARATION_ENDPOINT}</div>
                </div>

                <Button
                  type="button"
                  className="h-11 rounded-2xl px-5"
                  onClick={saveSettingsToSupabase}
                  disabled={isSavingSettings || isBootLoading}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {isSavingSettings ? "Opslaan..." : "Opslaan"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="signup-attempts"><SignupAttemptsAdminTab user={user} /></TabsContent>
</Tabs>

        <Dialog
          open={previewState.open}
          onOpenChange={(open) => setPreviewState((prev) => ({ ...prev, open }))}
        >
          <DialogContent className="fixed inset-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0 p-0 sm:inset-1/2 sm:h-[92dvh] sm:w-[min(72rem,calc(100vw-24px))] sm:max-w-[95vw] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] sm:border">
            <div className="flex h-full min-h-0 flex-col bg-white">
              <div className="shrink-0 border-b bg-white px-4 py-4 pt-[calc(16px+env(safe-area-inset-top))] sm:px-6 sm:pt-4">
                <DialogHeader className="text-left">
                  <DialogTitle>Conceptmail bekijken</DialogTitle>
                </DialogHeader>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-40 sm:px-6 sm:py-6 sm:pb-32">
                <div className="space-y-6">
                  <div className="hidden gap-4 rounded-3xl border bg-slate-50 p-4 md:grid-cols-3 sm:grid">
                    <Field label={`Zoom (${previewUi.zoom}%)`}>
                      <Input
                        className="h-11 rounded-2xl"
                        type="range"
                        min="60"
                        max="150"
                        step="5"
                        value={previewUi.zoom}
                        onChange={(e) =>
                          setPreviewUi((prev) => ({ ...prev, zoom: Number(e.target.value) }))
                        }
                      />
                    </Field>

                    <Field label={`Breedte (${previewUi.width}px)`}>
                      <Input
                        className="h-11 rounded-2xl"
                        type="range"
                        min="700"
                        max="1400"
                        step="20"
                        value={previewUi.width}
                        onChange={(e) =>
                          setPreviewUi((prev) => ({ ...prev, width: Number(e.target.value) }))
                        }
                      />
                    </Field>

                    <Field label={`Hoogte (${previewUi.height}px)`}>
                      <Input
                        className="h-11 rounded-2xl"
                        type="range"
                        min="400"
                        max="1000"
                        step="20"
                        value={previewUi.height}
                        onChange={(e) =>
                          setPreviewUi((prev) => ({ ...prev, height: Number(e.target.value) }))
                        }
                      />
                    </Field>
                  </div>

                  <div className="space-y-6">
                    {previewState.groups.map((group, groupIndex) => {
                      const emailData = buildEmailData(group, settings);
                      const totalAttachments = group.filter((d) => d.attachmentName).length;

                      return (
                        <Card
                          key={groupIndex}
                          className="overflow-hidden rounded-[28px] border border-slate-200 shadow-none"
                        >
                          <CardHeader>
                            <CardTitle className="text-lg">
                              {previewState.sendIndividually ? `Mail ${groupIndex + 1}` : "Batchmail"}
                            </CardTitle>
                          </CardHeader>

                          <CardContent className="space-y-4">
                            <div className="grid min-w-0 gap-3 md:grid-cols-3">
                              <div className="rounded-3xl bg-slate-50 p-3">
                                <div className="text-xs uppercase tracking-wide text-slate-500">Aan</div>
                                <div className="mt-1 break-all font-medium">{settings.toEmail || "-"}</div>
                              </div>
                              <div className="rounded-3xl bg-slate-50 p-3">
                                <div className="text-xs uppercase tracking-wide text-slate-500">Van</div>
                                <div className="mt-1 break-all font-medium">{settings.fromEmail || "-"}</div>
                              </div>
                              <div className="rounded-3xl bg-slate-50 p-3">
                                <div className="text-xs uppercase tracking-wide text-slate-500">
                                  Onderwerp
                                </div>
                                <div className="mt-1 break-words font-medium">{emailData.subject}</div>
                              </div>
                            </div>

                            <div className="overflow-hidden rounded-3xl border bg-white p-4">
                              <div className="mb-3 flex min-w-0 items-center gap-2 text-sm font-medium text-slate-600">
                                <Mail className="h-4 w-4 shrink-0" />
                                <span className="min-w-0 truncate">Voorbeeld van de mail</span>
                              </div>

                              <div className="-mx-4 overflow-x-hidden rounded-none border-y bg-slate-100 px-0 py-3 sm:mx-0 sm:rounded-2xl sm:border sm:px-4 sm:py-4">
                                <div
                                  className="w-full overflow-x-hidden"
                                  style={{
                                    width: "100%",
                                    minHeight: `${previewUi.height}px`,
                                  }}
                                >
                                  <div
                                    className="w-full overflow-hidden bg-white px-4 py-6 shadow-sm sm:p-6"
                                    style={{
                                      width: "100%",
                                      minHeight: `${previewUi.height}px`,
                                      maxWidth: "100%",
                                    }}
                                  >
                                    <style>{mailPreviewCss}</style>
                                    <div
                                      className="mail-preview-content prose prose-sm max-w-none break-words [overflow-wrap:anywhere]"
                                      dangerouslySetInnerHTML={{ __html: emailData.htmlBody }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="rounded-3xl border bg-slate-50 p-4">
                              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
                                <Paperclip className="h-4 w-4" />
                                Bijlagen ({totalAttachments})
                              </div>

                              {totalAttachments === 0 ? (
                                <div className="text-sm text-slate-500">Geen bijlagen toegevoegd.</div>
                              ) : (
                                <div className="space-y-2">
                                  {group.map((item, idx) =>
                                    item.attachmentName ? (
                                      <div
                                        key={item.id}
                                        className="flex items-center justify-between gap-4 rounded-2xl bg-white px-3 py-2 text-sm"
                                      >
                                        <div className="min-w-0 flex-1 truncate">
                                          {buildUniqueFileName(item, idx + 1, settings.signatureName)}
                                        </div>
                                        <Badge variant="secondary">
                                          {item.attachmentType || "bestand"}
                                        </Badge>
                                      </div>
                                    ) : null
                                  )}
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="shrink-0 overflow-hidden border-t bg-white px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:px-6 sm:py-4 sm:pb-4">
                <DialogFooter className="grid w-full grid-cols-1 gap-2 sm:flex sm:justify-end">
                  <Button
                    variant="outline"
                    className="h-11 w-full justify-center rounded-2xl px-4 text-center sm:w-auto sm:min-w-[140px]"
                    onClick={() => setPreviewState((prev) => ({ ...prev, open: false }))}
                  >
                    <span className="block w-full truncate text-center">Sluiten</span>
                  </Button>

                  <Button
                    className="h-11 w-full justify-center rounded-2xl px-4 text-center sm:w-auto sm:min-w-[180px]"
                    onClick={async () => {
                      setPreviewState((prev) => ({ ...prev, open: false }));
                      await sendBatch(previewState.sendIndividually);
                    }}
                    disabled={isSending}
                  >
                    <span className="inline-flex max-w-full items-center justify-center gap-2">
                      <Send className="h-4 w-4 shrink-0" />
                      <span className="truncate">Nu echt versturen</span>
                    </span>
                  </Button>
                </DialogFooter>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) setDialogError("");
          }}
        >
          <DialogContent className="fixed inset-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0 p-0 sm:inset-1/2 sm:h-[92dvh] sm:w-[min(42rem,calc(100vw-24px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] sm:border">
            <div className="flex h-full min-h-0 flex-col bg-white">
              <div className="shrink-0 border-b bg-white px-4 py-4 pt-[calc(16px+env(safe-area-inset-top))] sm:px-6 sm:pt-4">
                <DialogHeader className="text-left">
                  <DialogTitle>{editingId ? "Declaratie bewerken" : "Nieuwe declaratie"}</DialogTitle>
                </DialogHeader>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-40 sm:px-6 sm:py-6 sm:pb-32">
                <div className="space-y-4">
                  {dialogError && (
                    <Alert className="rounded-3xl border-red-200 bg-red-50 text-red-900">
                      <AlertDescription>{dialogError}</AlertDescription>
                    </Alert>
                  )}

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Datum">
                      <Input
                        className="h-11 rounded-2xl"
                        type="date"
                        value={draft.date}
                        onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                      />
                    </Field>

                    <Field label="Bedrag (€)">
                      <Input
                        className="h-11 rounded-2xl"
                        value={draft.amount}
                        onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                        placeholder="12,50"
                      />
                    </Field>

                    <Field label="Leverancier">
                      <Input
                        className="h-11 rounded-2xl"
                        value={draft.supplier}
                        onChange={(e) => setDraft({ ...draft, supplier: e.target.value })}
                      />
                    </Field>

                    <Field label="Reden">
                      <Input
                        className="h-11 rounded-2xl"
                        value={draft.reason}
                        onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                      />
                    </Field>

                    <div className="md:col-span-2 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="font-medium text-slate-900">Bon aanwezig</div>
                        <div className="text-sm text-slate-500">Zet uit als er geen bon is.</div>
                      </div>
                      <Switch
                        checked={draft.hasReceipt}
                        onCheckedChange={(checked) => setDraft({ ...draft, hasReceipt: checked })}
                      />
                    </div>

                    {!draft.hasReceipt && (
                      <div className="md:col-span-2">
                        <Field label="Reden geen bon">
                          <Input
                            className="h-11 rounded-2xl"
                            value={draft.noReceiptReason}
                            onChange={(e) => setDraft({ ...draft, noReceiptReason: e.target.value })}
                          />
                        </Field>
                      </div>
                    )}

                    <div className="md:col-span-2">
                      <Field label="Opmerking">
                        <Textarea
                          className="rounded-2xl"
                          value={draft.note}
                          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                          rows={3}
                        />
                      </Field>
                    </div>

                    <div className="md:col-span-2 space-y-2">
                      <Label>Foto of bestand van bon</Label>
                      <input
                        type="file"
                        accept="image/*,.pdf,.heic,.heif"
                        className="flex h-11 w-full rounded-2xl border border-input bg-background px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium"
                        key={draft.id}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;

                          setDialogError("");
                          setDraft((prev) => {
                            const nextAttachmentName = buildAttachmentFilenameFromFile(
                              file,
                              prev,
                              settings.signatureName || prev.submitterName || "Jorgo"
                            );

                            return {
                              ...prev,
                              attachment: file,
                              attachmentName: nextAttachmentName,
                              attachmentType: file.type,
                            };
                          });
                        }}
                      />

                      {draft.attachmentName && (
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <Upload className="h-4 w-4" />
                          <span className="break-all">{draft.attachmentName}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="shrink-0 border-t bg-white px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:px-6 sm:py-4 sm:pb-4">
                <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="outline"
                    className="h-11 rounded-2xl sm:min-w-[140px]"
                    onClick={() => {
                      setDialogError("");
                      setIsDialogOpen(false);
                    }}
                  >
                    Annuleren
                  </Button>

                  <Button
                    className="h-11 rounded-2xl sm:min-w-[140px]"
                    onClick={saveDraft}
                    disabled={isSavingDraft}
                  >
                    {isSavingDraft ? "Opslaan..." : "Opslaan"}
                  </Button>
                </DialogFooter>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}


function AuthScreen({
  authMode,
  setAuthMode,
  onSubmit,
  onForgotPassword,
  authError,
  isSubmitting,
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  return (
    <div className="min-h-screen bg-transparent px-3 pb-6 pt-[max(12px,env(safe-area-inset-top))] md:px-6 md:pb-8">
      <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
        <Card className="w-full rounded-[28px] border-white/70 bg-white/85 shadow-sm backdrop-blur">
          <CardHeader className="space-y-2">
            <div className="inline-flex w-fit items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              Declaraties
            </div>
            <CardTitle>{authMode === "login" ? "Inloggen" : "Account aanmaken"}</CardTitle>
          </CardHeader>

          <CardContent className="space-y-5">
            {authError ? (
              <Alert className="rounded-3xl border-slate-200 bg-slate-50 text-slate-800">
                <AlertDescription>{authError}</AlertDescription>
              </Alert>
            ) : null}

            {authMode === "signup" ? (
              <Field label="Naam">
                <Input
                  className="h-11 rounded-2xl"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Jouw naam"
                />
              </Field>
            ) : null}

            <Field label="E-mailadres">
              <Input
                className="h-11 rounded-2xl"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="naam@voorbeeld.nl"
              />
            </Field>

            <Field label="Wachtwoord">
              <Input
                className="h-11 rounded-2xl"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Wachtwoord"
              />
            </Field>

            <div className="grid gap-2">
              <Button
                className="h-11 rounded-2xl"
                disabled={isSubmitting}
                onClick={() => onSubmit({ mode: authMode, email, password, displayName })}
              >
                {isSubmitting
                  ? authMode === "login"
                    ? "Inloggen..."
                    : "Account aanmaken..."
                  : authMode === "login"
                  ? "Inloggen"
                  : "Account aanmaken"}
              </Button>

              {authMode === "login" ? (
                <Button
                  variant="outline"
                  className="h-11 rounded-2xl"
                  disabled={isSubmitting}
                  onClick={() => onForgotPassword(email)}
                >
                  Wachtwoord vergeten
                </Button>
              ) : null}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              {authMode === "login" ? (
                <div className="flex items-center justify-between gap-3">
                  <span>Nog geen account?</span>
                  <Button variant="ghost" className="h-auto rounded-xl px-2 py-1" onClick={() => setAuthMode("signup")}>
                    Account aanmaken
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span>Heb je al een account?</span>
                  <Button variant="ghost" className="h-auto rounded-xl px-2 py-1" onClick={() => setAuthMode("login")}>
                    Naar inloggen
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


function Field({ label, children }) {
  return (
    <div className="space-y-2.5">
      <Label className="text-sm font-medium text-slate-700">{label}</Label>
      {children}
    </div>
  );
}