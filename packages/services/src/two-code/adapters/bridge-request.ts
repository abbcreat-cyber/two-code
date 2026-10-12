/** 自有本地桥接可能等待模型数分钟；不用fetch的隐式响应头超时，也不自动重试派工。 */
export async function requestBridge(
  url: string | undefined,
  token: string | undefined,
  payload: unknown,
  signal?: AbortSignal,
): Promise<{ ok: boolean; result: any }> {
  if (!url || !token) throw Error("Two Code工具通道未配置");
  const { request } = await import("node:http");
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          try {
            resolve({
              ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300,
              result: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(payload));
  });
}
