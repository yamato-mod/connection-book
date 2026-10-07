/** 今動いているバージョン（デプロイしたコミット）。画面側が古いかどうかの判定に使う。 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" }, { headers: { "Cache-Control": "no-store" } });
}
