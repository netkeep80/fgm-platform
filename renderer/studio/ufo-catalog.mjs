const requestLimit = 128 * 1024;
const pathLimit = 4096;
const encoder = new TextEncoder();
// Filter transport paths only; the worker owns profiles, ordering and classification.
const candidatePath = /(?:^|\/)(?:MAPS|TERRAIN|GEODATA)\/[^/]+$/i;

export function indexGameFolder(files) {
  const index = new Map();
  for (const file of files) {
    const path = file.webkitRelativePath;
    if (!path || !candidatePath.test(path)) continue;
    if (index.has(path)) throw Error("E_STUDIO_DUPLICATE_FILE");
    if (index.size === pathLimit) throw Error("E_STUDIO_CATALOG_INDEX_LIMIT");
    index.set(path,file);
  }
  if (!index.size) throw Error("E_STUDIO_CATALOG_ROOT");
  const request = {action:"catalog-directory",paths:[...index.keys()]};
  if (encoder.encode(JSON.stringify({v:1,...request})).length > requestLimit)
    throw Error("E_STUDIO_CATALOG_INDEX_LIMIT");
  return {index,request};
}

export function resolveFile(index,path) {
  const file = index.get(path);
  if (!file) throw Error("E_STUDIO_CATALOG_BINDING");
  return file;
}

export function catalogElementKey(mapId,entry) {
  return JSON.stringify([mapId,entry.part,entry.dataset,entry.record,entry.rightHalf,entry.tile]);
}
