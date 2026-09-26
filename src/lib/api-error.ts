import "server-only";

export function apiError(error: unknown) {
  if (error instanceof Response) return error;
  console.error(error);
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const configuration = /configured|environment|OAuth/i.test(message);
  return Response.json(
    { error: configuration ? "service_not_configured" : "server_error", message: configuration ? "外部サービスの設定が完了していません。管理者に連絡してください。" : "サーバー処理に失敗しました。" },
    { status: configuration ? 503 : 500, headers: { "Cache-Control": "no-store" } },
  );
}
