import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = await fs.readFile(path.join(root, "packages/ui/src/assets/two-code-mark.svg"), "utf8");
const context = await chromium.launchPersistentContext("D:/Apps/TwoCode/build-cache/icon-browser", {
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  viewport: { width: 256, height: 256 },
  args: ["--disable-gpu"],
});
try {
  const page = await context.newPage(),
    sizes = [16, 32, 48, 64, 128, 256],
    pngs = [];
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    pngs.push(await page.screenshot({ omitBackground: true }));
  }
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const pos = 6 + i * 16;
    header[pos] = header[pos + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, pos + 4);
    header.writeUInt16LE(32, pos + 6);
    header.writeUInt32LE(pngs[i].length, pos + 8);
    header.writeUInt32LE(offset, pos + 12);
    offset += pngs[i].length;
  });
  await fs.writeFile(
    path.join(root, "packages/desktop/build/icon.ico"),
    Buffer.concat([header, ...pngs]),
  );
  await fs.writeFile(path.join(root, "packages/desktop/build/icon_windows.png"), pngs.at(-1));
  console.log("Two Code PNG/ICO generated in independent headless browser");
} finally {
  await context.close();
}
