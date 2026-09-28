// SYSTEM Personal Beta PWA icon source. Dependency-free and deterministic.
//
//   node scripts/generate-pwa-icons.mjs
//
// Every committed PWA icon is reproduced from the geometry and palette below, so the
// repository holds both the artwork and the process that produces it. The mark is an
// original abstract "progression" emblem (three ascending bars over the dark SYSTEM
// surface). No third-party or anime artwork is used or referenced.
//
// Output: public/icons/{icon-192.png, icon-512.png, maskable-512.png,
// apple-touch-icon-180.png, icon.svg} and public/favicon.ico
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const outputDirectory = fileURLToPath(new URL("../public/icons/", import.meta.url));
// Supersampling factor per axis; coverage is averaged for antialiasing.
const samples = 4;

const palette = {
  background: [9, 9, 11],      // #09090b, the application background
  edge: [39, 39, 42],          // #27272a, the border-zinc-800 surface edge
  low: [161, 98, 7],           // #a16207, amber-700
  middle: [245, 158, 11],      // #f59e0b, amber-500
  high: [252, 211, 77],        // #fcd34d, amber-300
};

// Unit-square geometry shared by every raster and by the SVG source.
const mark = {
  cornerRadius: 0.22,
  edgeInset: 0.055,
  edgeWidth: 0.012,
  edgeRadius: 0.19,
  baseline: 0.72,
  barWidth: 0.11,
  bars: [
    { left: 0.28, top: 0.5, color: "low" },
    { left: 0.435, top: 0.36, color: "middle" },
    { left: 0.59, top: 0.22, color: "high" },
  ],
};

function bounds(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height };
}

function withRadius(rect, radius) {
  const limit = Math.min((rect.right - rect.left) / 2, (rect.bottom - rect.top) / 2);
  return { ...rect, radius: Math.max(0, Math.min(radius, limit)) };
}

function insideRect(x, y, rect) {
  const dx = Math.max(rect.left + rect.radius - x, 0, x - (rect.right - rect.radius));
  const dy = Math.max(rect.top + rect.radius - y, 0, y - (rect.bottom - rect.radius));
  return dx * dx + dy * dy <= rect.radius * rect.radius;
}

// Layers, bottom to top: rounded plate, inset edge ring, ascending bars.
function layers({ bleed, emblemScale }) {
  const plate = withRadius(bleed ? bounds(0, 0, 1, 1) : bounds(0, 0, 1, 1), bleed ? 0 : mark.cornerRadius);
  const outer = withRadius(bounds(mark.edgeInset, mark.edgeInset, 1 - 2 * mark.edgeInset, 1 - 2 * mark.edgeInset), mark.edgeRadius);
  const inner = withRadius(bounds(mark.edgeInset + mark.edgeWidth, mark.edgeInset + mark.edgeWidth, 1 - 2 * (mark.edgeInset + mark.edgeWidth), 1 - 2 * (mark.edgeInset + mark.edgeWidth)), mark.edgeRadius - mark.edgeWidth);
  const scale = (value) => 0.5 + (value - 0.5) * emblemScale;
  const bars = mark.bars.map((bar) => ({
    rect: withRadius(bounds(scale(bar.left), scale(bar.top), mark.barWidth * emblemScale, (mark.baseline - bar.top) * emblemScale), mark.barWidth * emblemScale / 2),
    color: palette[bar.color],
  }));
  return { plate, outer, inner, bars };
}

function pixel(x, y, geometry) {
  let out = [0, 0, 0, 0];
  const over = (color, alpha) => {
    if (alpha <= 0) return;
    const outAlpha = alpha + (out[3] / 255) * (1 - alpha);
    for (let channel = 0; channel < 3; channel++) {
      out[channel] = (color[channel] * alpha + out[channel] * (out[3] / 255) * (1 - alpha)) / outAlpha;
    }
    out[3] = outAlpha * 255;
  };
  if (insideRect(x, y, geometry.plate)) over(palette.background, 1);
  if (out[3] > 0) {
    if (insideRect(x, y, geometry.outer) && !insideRect(x, y, geometry.inner)) over(palette.edge, 1);
    for (const bar of geometry.bars) if (insideRect(x, y, bar.rect)) over(bar.color, 1);
  }
  return out;
}

function raster(size, options) {
  const geometry = layers(options);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const step = 1 / (size * samples);
  for (let row = 0; row < size; row++) {
    const offset = row * (size * 4 + 1);
    raw[offset] = 0; // filter type: none
    for (let column = 0; column < size; column++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const value = pixel((column * samples + sx + 0.5) * step, (row * samples + sy + 0.5) * step, geometry);
          r += value[0] * (value[3] / 255);
          g += value[1] * (value[3] / 255);
          b += value[2] * (value[3] / 255);
          a += value[3] / 255;
        }
      }
      const total = samples * samples;
      const index = offset + 1 + column * 4;
      raw[index] = a === 0 ? 0 : Math.round(r / a);
      raw[index + 1] = a === 0 ? 0 : Math.round(g / a);
      raw[index + 2] = a === 0 ? 0 : Math.round(b / a);
      raw[index + 3] = Math.round((a / total) * 255);
    }
  }
  return raw;
}


const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, raw) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;  // bit depth
  header[9] = 6;  // truecolour with alpha
  header[10] = 0; // deflate compression
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function svg() {
  const size = 512;
  const scale = (value) => Math.round(value * size * 100) / 100;
  const hex = (color) => `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  const geometry = layers({ bleed: false, emblemScale: 1 });
  const rect = (shape, attributes) =>
    `<rect x="${scale(shape.left)}" y="${scale(shape.top)}" width="${scale(shape.right - shape.left)}" height="${scale(shape.bottom - shape.top)}" rx="${scale(shape.radius)}" ${attributes}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="SYSTEM">
  ${[
    rect(geometry.plate, `fill="${hex(palette.background)}"`),
    rect(geometry.outer, `fill="none" stroke="${hex(palette.edge)}" stroke-width="${scale(mark.edgeWidth)}"`),
    ...geometry.bars.map((bar) => rect(bar.rect, `fill="${hex(bar.color)}"`)),
  ].join("\n  ")}
</svg>
`;
}

const targets = [
  { file: "icon-192.png", size: 192, bleed: false, emblemScale: 1 },
  { file: "icon-512.png", size: 512, bleed: false, emblemScale: 1 },
  // Maskable icons must be full-bleed with the mark inside the safe zone.
  { file: "maskable-512.png", size: 512, bleed: true, emblemScale: 0.72 },
  // iOS masks its own corners, so the touch icon is full-bleed too.
  { file: "apple-touch-icon-180.png", size: 180, bleed: true, emblemScale: 0.86 },
];

// A browser fallback request for /favicon.ico must not 404; the ICO container below
// embeds a PNG (supported by every current browser), so no extra encoder is needed.
function encodeIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  const entry = Buffer.alloc(16);
  entry[0] = size === 256 ? 0 : size;
  entry[1] = size === 256 ? 0 : size;
  entry[2] = 0; // palette colours
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4);  // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);
  return Buffer.concat([header, entry, png]);
}

mkdirSync(outputDirectory, { recursive: true });
for (const target of targets) {
  const png = encodePng(target.size, raster(target.size, target));
  writeFileSync(join(outputDirectory, target.file), png);
  console.log(`${target.file}: ${target.size}x${target.size}, ${png.length} bytes`);
}
writeFileSync(join(outputDirectory, "icon.svg"), svg());
console.log("icon.svg: vector source of the same mark");

const favicon = { size: 32, bleed: true, emblemScale: 0.9 };
const faviconPng = encodePng(favicon.size, raster(favicon.size, favicon));
writeFileSync(fileURLToPath(new URL("../public/favicon.ico", import.meta.url)), encodeIco(faviconPng, favicon.size));
console.log(`favicon.ico: ${favicon.size}x${favicon.size} PNG-in-ICO, ${encodeIco(faviconPng, favicon.size).length} bytes`);
