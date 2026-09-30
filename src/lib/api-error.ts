import "server-only";

export function apiError(error: unknown) {
  if (error instanceof Response) return error;
  console.error(error);
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const configuration = /configured|environment|OAuth/i.test(message);
  const debugDetail = error instanceof Error ? error.message : (typeof error === "object" && error !== null ? JSON.stringify(error) : String(error));
  return Response.json(
    { error: configuration ? "service_not_configured" : "server_error", message: configuration ? "外部サービスの設定が完了していません。管理者に連絡してください。" : "サーバー処理に失敗しました。", debug: debugDetail },
    { status: configuration ? 503 : 500, headers: { "Cache-Control": "no-store" } },
  );
}
