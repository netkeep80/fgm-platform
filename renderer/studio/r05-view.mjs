const limit = 128 * 1024;
const width = 32, height = 40;
const encoder = new TextEncoder();
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const pair = (value, minimum = -32768, maximum = 32767) =>
  Array.isArray(value) && value.length === 2 && value.every(v => integer(v, minimum, maximum));
const flags = {predicted: 1, observed: 2, common: 3};
const colors = ["", "#66daff", "#ffbc6b", "#9fdfa3"];

export async function sha256(text) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function requireVisual(condition) {
  if (!condition) throw Error("E_STUDIO_VISUAL");
}

function validateMask(mask, max, inBounds) {
  requireVisual(Array.isArray(mask) && mask.length <= max);
  let previous = null;
  for (const pixel of mask) {
    requireVisual(pair(pixel) && inBounds(...pixel) &&
      (!previous || previous[0] < pixel[0] || previous[0] === pixel[0] && previous[1] < pixel[1]));
    previous = pixel;
  }
}

function comparisonPixels(predicted, observed) {
  const pixels = new Map();
  for (const [x,y] of predicted) pixels.set(x + "," + y, [x,y,flags.predicted]);
  let common = 0;
  for (const [x,y] of observed) {
    const key = x + "," + y;
    const hit = pixels.get(key);
    if (hit) {
      hit[2] = flags.common;
      common++;
    } else {
      pixels.set(key, [x,y,flags.observed]);
    }
  }
  return {
    pixels: [...pixels.values()],
    counts: {common, predicted_only: predicted.length - common, observed_only: observed.length - common}
  };
}

export async function verifyR05Observation(raw, digest, tile, reportCounts) {
  requireVisual(typeof raw === "string" && raw.length > 0 && raw.length <= limit &&
    encoder.encode(raw).length <= limit);
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest) || await sha256(raw) !== digest)
    throw Error("E_STUDIO_VISUAL_DIGEST");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw Error("E_STUDIO_VISUAL");
  }
  requireVisual(data?.schema === "fgmr-studio-r05-observation/1" &&
    data.coordinate_frame === "r05-ufo-dimetric/1" &&
    Array.isArray(data.tile) && data.tile.length === 3 && data.tile.every((v,i) => v === tile[i]) &&
    pair(data.tile_anchor));
  const {sprite} = data;
  requireVisual(sprite?.width === width && sprite.height === height &&
    sprite.transparent_index === 0 && typeof sprite.right_half === "boolean" &&
    pair(sprite.anchor) && integer(sprite.p_level, 0, 255) &&
    sprite.anchor[0] === data.tile_anchor[0] && sprite.anchor[1] === data.tile_anchor[1] - sprite.p_level &&
    typeof sprite.indices_hex === "string" && /^[0-9a-f]{2560}$/.test(sprite.indices_hex) &&
    Array.isArray(sprite.palette_rgb8) && sprite.palette_rgb8.length === 256 &&
    sprite.palette_rgb8.every(rgb => Array.isArray(rgb) && rgb.length === 3 &&
      rgb.every(channel => integer(channel, 0, 255))));
  const [tx,ty] = data.tile_anchor;
  const [sx,sy] = sprite.anchor;
  const left = sprite.right_half ? width / 2 : 0;
  // Bounds checks only. Coordinates and geometry come from the native R05.
  validateMask(data.predicted, 6144, (x,y) => Math.abs(x - tx) <= 64 && Math.abs(y - ty) <= 64);
  validateMask(data.observed, width * height,
    (x,y) => x >= sx + left && x < sx + width && y >= sy && y < sy + height);
  const {pixels, counts} = comparisonPixels(data.predicted, data.observed);
  requireVisual(Object.entries(counts).every(([key,count]) =>
    data.silhouette?.[key] === count && reportCounts?.[key] === count));
  return {sprite, pixels, indices: Uint8Array.from(sprite.indices_hex.match(/../g), byte => parseInt(byte, 16))};
}

export function paintR05(context, image, mode) {
  const [sx,sy] = image.sprite.anchor;
  let minX = sx, minY = sy, maxX = sx + width, maxY = sy + height;
  for (const [x,y] of image.pixels) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1);
  }
  const {width: w, height: h} = context.canvas;
  const scale = Math.max(1, Math.floor(Math.min((w - 48) / (maxX - minX), (h - 48) / (maxY - minY))));
  const offsetX = Math.floor((w - (maxX - minX) * scale) / 2) - minX * scale;
  const offsetY = Math.floor((h - (maxY - minY) * scale) / 2) - minY * scale;
  const cell = (x,y) => context.fillRect(offsetX + x * scale, offsetY + y * scale, scale, scale);
  if (mode === "original") {
    const palette = image.sprite.palette_rgb8.map(rgb => "rgb(" + rgb.join(",") + ")");
    for (const [i,index] of image.indices.entries()) {
      if (index === 0) continue;
      context.fillStyle = palette[index];
      cell(sx + i % width, sy + Math.floor(i / width));
    }
    return;
  }
  for (const [x,y,flag] of image.pixels) {
    if ((mode === "reconstructed" || mode === "collision") && !(flag & flags.predicted)) continue;
    if (mode === "difference" && flag === flags.common) continue;
    context.fillStyle = mode === "collision" ? "#e3afff" :
      mode === "reconstructed" ? colors[flags.predicted] : colors[flag];
    cell(x,y);
  }
}
