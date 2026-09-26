import { isConfiguredValue, isSupabaseServerConfigured } from "@/lib/env-config";

export const dynamic="force-dynamic";
export function GET(){return Response.json({ok:true,googleConfigured:isConfiguredValue(process.env.GOOGLE_REFRESH_TOKEN),supabaseConfigured:isSupabaseServerConfigured(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY)},{headers:{"Cache-Control":"no-store"}})}
