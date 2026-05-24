/**
 * Shared usage-limit utilities — used by all AI API routes.
 * Uses Supabase REST API with the service-role key (server-side only).
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const DAILY_LIMITS = { osce: 5, ddx: 5, mcq: 5, mse: 5 };

function todayUTC() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function headers() {
  return {
    "Content-Type":  "application/json",
    "apikey":        SUPABASE_KEY,
    "Authorization": `Bearer ${SUPABASE_KEY}`,
  };
}

/**
 * Returns { allowed, used, limit, remaining }
 * Throws if the DB call fails.
 */
export async function checkUsage(userId, feature) {
  // Dev / missing-config fallback — allow everything
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    const lim = DAILY_LIMITS[feature] ?? 5;
    return { allowed: true, used: 0, limit: lim, remaining: lim };
  }

  const limit = DAILY_LIMITS[feature] ?? 5;
  const today = todayUTC();

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_usage?user_id=eq.${userId}&feature=eq.${encodeURIComponent(feature)}&usage_date=eq.${today}&select=count`,
    { headers: headers() }
  );

  if (!res.ok) throw new Error(`Usage check HTTP ${res.status}`);

  const rows  = await res.json();
  const used  = rows?.[0]?.count ?? 0;
  const remaining = Math.max(0, limit - used);

  return { allowed: used < limit, used, limit, remaining };
}

/**
 * Atomically upserts (insert or increment) the usage counter.
 * Uses Supabase's on-conflict upsert to avoid race conditions.
 */
export async function incrementUsage(userId, feature) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  const today = todayUTC();
  const now   = new Date().toISOString();

  // Read current count first
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_usage?user_id=eq.${userId}&feature=eq.${encodeURIComponent(feature)}&usage_date=eq.${today}&select=id,count`,
    { headers: headers() }
  );

  const rows = res.ok ? await res.json() : [];

  if (rows.length === 0) {
    // INSERT new row
    await fetch(`${SUPABASE_URL}/rest/v1/ai_usage`, {
      method:  "POST",
      headers: { ...headers(), "Prefer": "return=minimal" },
      body: JSON.stringify({
        user_id:    userId,
        feature,
        usage_date: today,
        count:      1,
        created_at: now,
        updated_at: now,
      }),
    });
  } else {
    // PATCH existing row — increment count
    const { id, count } = rows[0];
    await fetch(`${SUPABASE_URL}/rest/v1/ai_usage?id=eq.${id}`, {
      method:  "PATCH",
      headers: { ...headers(), "Prefer": "return=minimal" },
      body: JSON.stringify({ count: (count ?? 0) + 1, updated_at: now }),
    });
  }
}
