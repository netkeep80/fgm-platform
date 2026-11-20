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

export async function writeStudioUfoCatalogFixture(root,corrupt="") {
  const { map, blanks, terrain, loft } = studioCellFixture();
  const frames=[
    Buffer.from([0,254,20,10,255]),  // frame 0: red, right-half pixels
    Buffer.from([0,254,10,20,255]),  // frame 1: green, left-half pixels
    Buffer.from([0,254,5,30,255])    // frame 2: blue, left-half pixels
  ];
  const pck=Buffer.concat(frames);
  const tab=Buffer.alloc(6);tab.writeUInt16LE(0,0);tab.writeUInt16LE(5,2);tab.writeUInt16LE(10,4);
  const palette=Buffer.alloc(3864);
  for(const [index,rgb] of [[10,[63,0,0]],[20,[0,63,0]],[30,[0,0,63]]])
    palette.set(rgb,4*774+3*index);
  if(corrupt==="tab")tab.writeUInt16LE(1,0);
  if(corrupt==="pck")pck[4]=0; // frame 0 has no 255 terminator
  if(corrupt==="palette")palette[4*774+3*10]=64; // invalid RGB6
  const door = Buffer.from(terrain);
  door[35] = 1;
  const corpus = new Map([
    ["MAPS/CULTA00.MAP", Buffer.from([4,1,1,0,0,3,0,2,0,0,0,0,0,0,1,0,2,3,0])],
    ["MAPS/CULTA01.MAP", Buffer.from([1, 1, 1, 0, 0, 2, 0])],
    ["MAPS/CULTA02.MAP", Buffer.from([1, 1, 1])],
    ["MAPS/FOREST00.MAP", map],
    ["MAPS/MAP3.MAP", map],
    ["GEOGRAPH/INTICON.MAP", map],
    ["GEODATA/LOFTEMPS.DAT", loft],
    ["GEODATA/PALETTES.DAT", palette],
  ]);
  for (const [id, mcd] of [["BLANKS", blanks], ["CULTIVAT", terrain], ["BARN", door]]) {
    const local=Buffer.from(mcd);
    if(id==="BLANKS")local[62]=2;
    if(id==="CULTIVAT")local[0]=1;
    corpus.set(`TERRAIN/${id}.MCD`, local);
    corpus.set(`TERRAIN/${id}.PCK`, pck);
    corpus.set(`TERRAIN/${id}.TAB`, tab);
  }
  for (const [name, bytes] of corpus) {
    const file = join(root, name);
    await mkdir(dirname(file), {recursive: true});
    await writeFile(file, bytes);
  }
}
