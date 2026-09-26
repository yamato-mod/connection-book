import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest { return { name:"つながり帳 — 1st Penguin Club CRM", short_name:"つながり帳", description:"起業部内限定の名刺管理・お礼メール支援", start_url:"/", display:"standalone", background_color:"#f4f7f4", theme_color:"#176b45", orientation:"portrait", icons:[{src:"/icon.svg",sizes:"any",type:"image/svg+xml",purpose:"any"}] }; }
