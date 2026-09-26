import { createBrowserClient } from "@supabase/ssr";
import { isSupabaseBrowserConfigured } from "@/lib/env-config";

export function createClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!isSupabaseBrowserConfigured(url,key)) throw new Error("Supabase未設定です。管理者が実際のProject URLとPublishable keyを設定してください。");
  return createBrowserClient(url!,key!);
}
