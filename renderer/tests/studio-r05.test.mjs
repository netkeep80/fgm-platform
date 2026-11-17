import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyR05Observation } from "../studio/r05-view.mjs";

const tile = [2, 3, 1];
const counts = {common: 1, predicted_only: 1, observed_only: 1};
const makeObservation = () => ({
  schema: "fgmr-studio-r05-observation/1",
  coordinate_frame: "r05-ufo-dimetric/1",
  tile, tile_anchor: [-16, 8],
  sprite: {width: 32, height: 40, anchor: [-16, 3], p_level: 5,
    right_half: true, transparent_index: 0, indices_hex: "2a" + "00".repeat(79) + "2b2c" + "00".repeat(1198),
    palette_rgb8: Array.from({length: 256}, () => [0, 0, 0])},
  predicted: [[-1, 5], [0, 5]], observed: [[0, 5], [1, 5]],
  silhouette: counts
});
const digest = raw => createHash("sha256").update(raw).digest("hex");
const verify = (value, expected = counts) => {
  const raw = JSON.stringify(value);
  return verifyR05Observation(raw, digest(raw), tile, expected);
};

test("сохраняет абсолютные координаты R05 и классификацию пикселей", async () => {
  const image = await verify(makeObservation());
  assert.deepEqual(image.pixels, [[-1, 5, 1], [0, 5, 3], [1, 5, 2]]);
  assert.equal(image.indices[0], 42);
  assert.equal(image.sprite.right_half, true);
  const empty = makeObservation();
  empty.predicted = [];
  empty.observed = [];
  empty.silhouette = {common: 0, predicted_only: 0, observed_only: 0};
  assert.deepEqual((await verify(empty, empty.silhouette)).pixels, []);
});

test("отклоняет отсутствие наблюдения, неверный хеш и превышение бюджета", async () => {
  const raw = JSON.stringify(makeObservation());
  await assert.rejects(verifyR05Observation(undefined, digest(raw), tile, counts), /E_STUDIO_VISUAL/);
  await assert.rejects(verifyR05Observation(raw + " ", digest(raw), tile, counts), /E_STUDIO_VISUAL_DIGEST/);
  const oversized = " ".repeat(131073);
  await assert.rejects(verifyR05Observation(oversized, digest(oversized), tile, counts), /E_STUDIO_VISUAL/);
});

test("отклоняет формат, координаты и статистику даже при правильном хеше", async () => {
  for (const corrupt of [
    image => {image.schema = "unknown";},
    image => {image.tile = [0, 0, 0];},
    image => {image.predicted.reverse();},
    image => {image.predicted.push([0, 5]);},
    image => {image.predicted.push([500, 5]);},
    image => {image.observed[0][0] = -1;},
    image => {image.sprite.indices_hex = "xx".repeat(1280);},
    image => {image.sprite.palette_rgb8[255][0] = 256;},
    image => {image.silhouette = {...counts, common: 0};},
  ]) {
    const image = makeObservation();
    corrupt(image);
    await assert.rejects(verify(image), /E_STUDIO_VISUAL/);
  }
});
