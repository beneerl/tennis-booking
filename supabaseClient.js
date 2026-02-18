// supabaseClient.js
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const SUPABASE_URL = "https://ywaqcttqnzvmxecbyuwr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_nLr6Gl_UzyweWKnMgidzHw_995jmUKY";

// Storage-Adapter für Supabase
const webStorage = {
  getItem: (key) => {
    try {
      return window?.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      window?.localStorage?.setItem(key, value);
    } catch {}
  },
  removeItem: (key) => {
    try {
      window?.localStorage?.removeItem(key);
    } catch {}
  },
};

const storage = Platform.OS === "web" ? webStorage : AsyncStorage;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage,
    storageKey: "sb-ywaqcttqnzvmxecbyuwr-auth-token",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

