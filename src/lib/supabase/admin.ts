import "server-only";
import { createClient } from "@supabase/supabase-js";
import { isSupabaseServerConfigured } from "@/lib/env-config";
export function createAdminClient(){ const url=process.env.NEXT_PUBLIC_SUPABASE_URL; const key=process.env.SUPABASE_SECRET_KEY; if(!isSupabaseServerConfigured(url,key)) throw new Error("Supabase server environment is not configured"); return createClient(url!,key!,{auth:{autoRefreshToken:false,persistSession:false}}); }
