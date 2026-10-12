import fs from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { Icns, IcnsImage } from "@fiahfy/icns";

const root = path.resolve(import.meta.dirname, "..");
const source = await fs.readFile(path.join(root, "public/logo/two-code-master.png"));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024"><image width="1024" height="1024" xlink:href="data:image/png;base64,${source.toString("base64")}"/></svg>`;
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const images = new Map();
async function save(relative, data) {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
}
for (const size of sizes) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  images.set(size, png);
  await save(`packages/desktop/build/icons/${size}x${size}.png`, png);
}
const iconSizes = sizes.filter((size) => size <= 256);
const header = Buffer.alloc(6 + 16 * iconSizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(iconSizes.length, 4);
let offset = header.length;
iconSizes.forEach((size, index) => {
  const pos = 6 + index * 16;
  const png = images.get(size);
  header[pos] = header[pos + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, pos + 4);
  header.writeUInt16LE(32, pos + 6);
  header.writeUInt32LE(png.length, pos + 8);
  header.writeUInt32LE(offset, pos + 12);
  offset += png.length;
});
const ico = Buffer.concat([header, ...iconSizes.map((size) => images.get(size))]);
for (const file of [
  "packages/desktop/build/icon.ico",
  "packages/desktop/build/icon_installer.ico",
  "public/logo/icons/icon.ico",
  "packages/web/public/favicon.ico",
]) {
  await save(file, ico);
}
const icns = new Icns();
for (const [size, type] of [
  [128, "ic07"],
  [256, "ic08"],
  [512, "ic09"],
  [1024, "ic10"],
]) {
  icns.append(IcnsImage.fromPNG(images.get(size), type));
}
for (const file of [
  "packages/desktop/build/icon.icns",
  "packages/desktop/build/icon_installer.icns",
  "public/logo/icons/icon.icns",
]) {
  await save(file, icns.data);
}
for (const file of [
  "packages/desktop/build/icon.png",
  "packages/desktop/build/icon_installer.png",
  "packages/ui/src/assets/two-code-mark.png",
]) {
  await save(file, images.get(512));
}
await save("packages/desktop/build/icon_windows.png", images.get(256));
await save("public/icon_512@2x.png", images.get(1024));
console.log("Two Code icons generated from the approved starship master (PNG, ICO, ICNS).");
