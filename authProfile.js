import { supabase } from "./supabaseClient";

export function normalizeUserStatus(rawStatus) {
  return rawStatus === null || rawStatus === undefined
    ? ""
    : String(rawStatus).trim().toLowerCase();
}

// Auth-/Rolleninformationen niemals aus Route-Parametern oder der URL ableiten.
// Die Supabase-Session ist die Identitaet; Rolle/Status kommen frisch aus der DB.
export async function getCurrentUserProfile({ refreshIfMissing = true } = {}) {
  let { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  let session = sessionData?.session || null;

  if (!session && refreshIfMissing) {
    const { data: refreshData, error: refreshError } =
      await supabase.auth.refreshSession();
    if (refreshError) {
      // Bei einer wirklich fehlenden Session ist refreshSession nicht zwingend ein harter Fehler.
      // Wir geben unten einfach session: null zurueck.
      console.log("refreshSession:", refreshError.message);
    }
    session = refreshData?.session || null;
  }

  const authUser = session?.user || null;
  if (!authUser?.id) {
    return { session: null, profile: null };
  }

  const columns = "id, auth_id, email, name, status, is_admin, created_at";

  // Primaer immer ueber auth_id: diese ID kann nicht durch URL-/UI-Parameter gefaelscht werden.
  let { data: profile, error: profileError } = await supabase
    .from("users")
    .select(columns)
    .eq("auth_id", authUser.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (profileError) throw profileError;

  // Fallback fuer alte, noch nicht vollstaendig migrierte Datensaetze.
  if (!profile && authUser.email) {
    const result = await supabase
      .from("users")
      .select(columns)
      .eq("email", String(authUser.email).toLowerCase())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (result.error) throw result.error;
    profile = result.data || null;
  }

  return { session, profile };
}
