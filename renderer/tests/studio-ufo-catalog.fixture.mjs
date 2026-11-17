import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function studioCellFixture() {
  const blanks = Buffer.alloc(2 * 62);
  blanks[42] = blanks[104] = 1;
  const terrain = Buffer.alloc(62);
  terrain[42] = 1;
  terrain.fill(1, 8, 20);
  terrain[8] = 0;
  const loft = Buffer.alloc(64);
  for (let y = 3; y < 6; y++) loft.writeUInt16LE(0x3800, y * 2);
  return {
    map: Buffer.from([1, 1, 1, 0, 1, 2, 2]), blanks, terrain, loft,
    pck: Buffer.from([0, 42, 255]), tab: Buffer.alloc(2), palette: Buffer.alloc(768),
  };
}

export async function writeStudioUfoCatalogFixture(root) {
  const { map, blanks, terrain, loft, pck, tab } = studioCellFixture();
  const door = Buffer.from(terrain);
  door[35] = 1;
  const corpus = new Map([
    ["MAPS/CULTA00.MAP", Buffer.from([1, 1, 1, 0, 0, 3, 0])],
    ["MAPS/CULTA01.MAP", Buffer.from([1, 1, 1, 0, 0, 2, 0])],
    ["MAPS/CULTA02.MAP", Buffer.from([1, 1, 1])],
    ["MAPS/FOREST00.MAP", map],
    ["MAPS/MAP3.MAP", map],
    ["GEOGRAPH/INTICON.MAP", map],
    ["GEODATA/LOFTEMPS.DAT", loft],
    ["GEODATA/PALETTES.DAT", Buffer.alloc(3864)],
  ]);
  for (const [id, mcd] of [["BLANKS", blanks], ["CULTIVAT", terrain], ["BARN", door]]) {
    corpus.set(`TERRAIN/${id}.MCD`, mcd);
    corpus.set(`TERRAIN/${id}.PCK`, pck);
    corpus.set(`TERRAIN/${id}.TAB`, tab);
  }
  for (const [name, bytes] of corpus) {
    const file = join(root, name);
    await mkdir(dirname(file), {recursive: true});
    await writeFile(file, bytes);
  }
}
