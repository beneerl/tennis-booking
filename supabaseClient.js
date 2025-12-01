import { createClient } from "@supabase/supabase-js";

// HIER deine Daten aus dem Supabase-Dashboard eintragen:
const SUPABASE_URL = "https://ywaqcttqnzvmxecbyuwr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_nLr6Gl_UzyweWKnMgidzHw_995jmUKY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)