import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconDirectory = path.join(root, "extension", "icons");
const sizes = [16, 32, 48, 128];
const supersampling = 4;

await mkdir(iconDirectory, { recursive: true });

for (const size of sizes) {
  const canvas = drawIcon(size * supersampling);
  const pixels = downsample(canvas, size, supersampling);
  await writeFile(path.join(iconDirectory, `icon${size}.png`), encodePng(size, size, pixels));
}

function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const scale = size / 128;
  const fill = (x, y, width, height, radius, color) => {
    fillRoundedRect(pixels, size, x * scale, y * scale, width * scale, height * scale, radius * scale, color);
  };

  fill(6, 6, 116, 116, 28, [7, 17, 31, 255]);
  fill(9, 9, 110, 110, 25, [11, 32, 52, 255]);
  fill(13, 13, 102, 102, 22, [12, 47, 72, 255]);

  fill(29, 30, 70, 82, 15, [224, 242, 254, 255]);
  fill(34, 35, 60, 72, 11, [186, 230, 253, 255]);
  fill(45, 22, 38, 20, 9, [224, 242, 254, 255]);
  fill(52, 27, 24, 9, 4, [56, 189, 248, 255]);

  fill(44, 58, 39, 5, 2.5, [8, 47, 73, 255]);
  fill(44, 72, 39, 5, 2.5, [8, 47, 73, 255]);
  fill(44, 86, 29, 5, 2.5, [8, 47, 73, 255]);

  const star = starPoints(96 * scale, 36 * scale, 23 * scale, 10 * scale, 5);
  fillPolygon(pixels, size, star, [250, 204, 21, 255]);
  const innerStar = starPoints(96 * scale, 36 * scale, 15 * scale, 6.5 * scale, 5);
  fillPolygon(pixels, size, innerStar, [254, 240, 138, 255]);
  return pixels;
}

function fillRoundedRect(pixels, size, x, y, width, height, radius, color) {
  const left = Math.max(0, Math.floor(x));
  const right = Math.min(size, Math.ceil(x + width));
  const top = Math.max(0, Math.floor(y));
  const bottom = Math.min(size, Math.ceil(y + height));

  for (let py = top; py < bottom; py += 1) {
    for (let px = left; px < right; px += 1) {
      if (insideRoundedRect(px + 0.5, py + 0.5, x, y, width, height, radius)) {
        setPixel(pixels, size, px, py, color);
      }
    }
  }
}

function insideRoundedRect(px, py, x, y, width, height, radius) {
  const nearestX = Math.max(x + radius, Math.min(px, x + width - radius));
  const nearestY = Math.max(y + radius, Math.min(py, y + height - radius));
  const dx = px - nearestX;
  const dy = py - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function starPoints(centerX, centerY, outerRadius, innerRadius, points) {
  const vertices = [];
  for (let index = 0; index < points * 2; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    const radius = index % 2 ? innerRadius : outerRadius;
    vertices.push([
      centerX + Math.cos(angle) * radius,
      centerY + Math.sin(angle) * radius
    ]);
  }
  return vertices;
}

function fillPolygon(pixels, size, vertices, color) {
  const minX = Math.max(0, Math.floor(Math.min(...vertices.map(([x]) => x))));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(...vertices.map(([x]) => x))));
  const minY = Math.max(0, Math.floor(Math.min(...vertices.map(([, y]) => y))));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(...vertices.map(([, y]) => y))));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointInPolygon(x + 0.5, y + 0.5, vertices)) setPixel(pixels, size, x, y, color);
    }
  }
}

function pointInPolygon(x, y, vertices) {
  let inside = false;
  for (let current = 0, previous = vertices.length - 1; current < vertices.length; previous = current++) {
    const [currentX, currentY] = vertices[current];
    const [previousX, previousY] = vertices[previous];
    const intersects = currentY > y !== previousY > y &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
    if (intersects) inside = !inside;
  }
  return inside;
}

function setPixel(pixels, size, x, y, color) {
  const offset = (y * size + x) * 4;
  pixels.set(color, offset);
}

function downsample(source, outputSize, factor) {
  const sourceSize = outputSize * factor;
  const output = new Uint8Array(outputSize * outputSize * 4);

  for (let y = 0; y < outputSize; y += 1) {
    for (let x = 0; x < outputSize; x += 1) {
      const totals = [0, 0, 0, 0];
      for (let sampleY = 0; sampleY < factor; sampleY += 1) {
        for (let sampleX = 0; sampleX < factor; sampleX += 1) {
          const sourceOffset = (((y * factor + sampleY) * sourceSize) + x * factor + sampleX) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            totals[channel] += source[sourceOffset + channel];
          }
        }
      }

      const outputOffset = (y * outputSize + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output[outputOffset + channel] = Math.round(totals[channel] / (factor * factor));
      }
    }
  }
  return output;
}

function encodePng(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    rows[rowOffset] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(rows, rowOffset + 1);
  }

  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
