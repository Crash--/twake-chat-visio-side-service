export function matrixError(status: number, errcode: string, error: string): Response {
  return Response.json(
    {
      errcode,
      error,
    },
    {
      status,
    },
  );
}

export function handle(request: Request): Response {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && (pathname === "/health/live" || pathname === "/health/ready")) {
    return Response.json({
      status: "ok",
    });
  }

  return matrixError(404, "M_UNRECOGNIZED", "Unrecognized request");
}
