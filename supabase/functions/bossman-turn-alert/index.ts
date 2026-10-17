import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function getVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const { data, error } = await supabase
    .from("app_config")
    .select("key,value")
    .in("key", ["vapid_public_key", "vapid_private_key"]);
  if (error) throw error;

  const values = new Map((data ?? []).map((row) => [row.key, row.value]));
  let publicKey = values.get("vapid_public_key") ?? "";
  let privateKey = values.get("vapid_private_key") ?? "";

  if (!publicKey || !privateKey) {
    const generated = webpush.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    const { error: upsertError } = await supabase.from("app_config").upsert(
      [
        { key: "vapid_public_key", value: publicKey },
        { key: "vapid_private_key", value: privateKey },
      ],
      { onConflict: "key" },
    );
    if (upsertError) throw upsertError;
  }

  return { publicKey, privateKey };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const vapid = await getVapidKeys();

    if (req.method === "GET") return response({ ok: true, publicKey: vapid.publicKey });
    if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

    const payload = await req.json().catch(() => ({}));
    const entryId = typeof payload.entryId === "string" ? payload.entryId : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entryId)) {
      return response({ error: "Invalid entry ID" }, 400);
    }

    const { data: subscription, error: subscriptionError } = await supabase
      .from("queue_push_subscriptions")
      .select("entry_id,endpoint,p256dh,auth,notified_at")
      .eq("entry_id", entryId)
      .maybeSingle();
    if (subscriptionError) throw subscriptionError;
    if (!subscription) return response({ ok: true, skipped: "no_subscription" });
    if (subscription.notified_at) return response({ ok: true, skipped: "already_notified" });

    const { data: entry, error: entryError } = await supabase
      .from("queue_entries")
      .select("id,status,customer_name,barber_name")
      .eq("id", entryId)
      .maybeSingle();
    if (entryError) throw entryError;
    if (!entry || entry.status !== "called") return response({ ok: true, skipped: "not_called" });

    webpush.setVapidDetails(
      "mailto:bossmanofficialhq@gmail.com",
      vapid.publicKey,
      vapid.privateKey,
    );

    const notificationPayload = JSON.stringify({
      title: "It's your turn at Bossman",
      body: `Please return now. ${entry.barber_name || "Your barber"} is ready for you.`,
      url: "./index.html",
      tag: `bossman-turn-${entryId}`,
    });

    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        notificationPayload,
        { TTL: 300, urgency: "high" },
      );
    } catch (pushError) {
      const statusCode = Number((pushError as { statusCode?: number }).statusCode ?? 0);
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from("queue_push_subscriptions").delete().eq("entry_id", entryId);
        return response({ ok: true, skipped: "expired_subscription" });
      }
      throw pushError;
    }

    const { error: updateError } = await supabase
      .from("queue_push_subscriptions")
      .update({ notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("entry_id", entryId)
      .is("notified_at", null);
    if (updateError) throw updateError;

    return response({ ok: true, sent: true });
  } catch (error) {
    console.error("Bossman turn alert error", error);
    return response({ error: "Could not send notification" }, 500);
  }
});
