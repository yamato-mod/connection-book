import "server-only";

export function apiError(error: unknown) {
  if (error instanceof Response) return error;
  // Supabaseのエラーはmessageが空のことがあるので、原因が追えるように中身も出す。
  const detail = error && typeof error === "object" ? Object.fromEntries(Object.entries(error as Record<string, unknown>).filter(([key]) => ["code", "details", "hint", "status", "name", "message"].includes(key))) : undefined;
  console.error(error, detail);
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const configuration = /configured|environment|OAuth/i.test(message);
  return Response.json(
    { error: configuration ? "service_not_configured" : "server_error", message: configuration ? "外部サービスの設定が完了していません。管理者に連絡してください。" : "サーバー処理に失敗しました。" },
    { status: configuration ? 503 : 500, headers: { "Cache-Control": "no-store" } },
  );
}
