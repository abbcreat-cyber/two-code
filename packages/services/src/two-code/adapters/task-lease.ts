import { createServer, createConnection, type Server } from "node:net";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

/** OS持有的执行租约：进程崩溃自动释放，不留下需要猜测过期时间的锁文件。 */
export class TaskLease {
  constructor(private readonly root: string) {}
  private async address(id: string) {
    const root = await realpath(this.root).catch(() => resolve(this.root));
    const identity = process.platform === "win32" ? root.replaceAll("\\", "/").toLowerCase() : root;
    const digest = createHash("sha256").update(`${identity}/${id}`).digest();
    return process.platform === "win32"
      ? { path: `\\\\.\\pipe\\two-code-${digest.toString("hex").slice(0, 40)}` }
      : { host: "127.0.0.1", port: 40000 + (digest.readUInt32BE(0) % 20000), exclusive: true };
  }
  async isActive(id: string): Promise<boolean> {
    const address = await this.address(id);
    return new Promise((resolve) => {
      const socket = createConnection(address);
      const finish = (active: boolean) => {
        socket.destroy();
        resolve(active);
      };
      socket.setTimeout(500, () => finish(true));
      socket.once("connect", () => finish(true));
      socket.once("error", (error: NodeJS.ErrnoException) =>
        finish(!["ENOENT", "ECONNREFUSED"].includes(error.code ?? "")),
      );
    });
  }
  async acquire(id: string): Promise<() => Promise<void>> {
    const address = await this.address(id);
    let server: Server | undefined = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server!.once("error", () =>
        reject(new Error("任务已由另一窗口执行，或执行租约被占用；请回到原窗口处理")),
      );
      server!.listen(address, resolve);
    });
    return async () => {
      const owned = server;
      server = undefined;
      if (owned) await new Promise<void>((resolve) => owned.close(() => resolve()));
    };
  }
}
