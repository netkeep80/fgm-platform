import createEngine from "./fgmr-studio.mjs";

const engine = createEngine();
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const maxRequest = 128*1024;
const error = code => JSON.stringify({ v: 1, error: code });

// One instance owns one active run and handles messages in arrival order.
self.onmessage = ({ data }) => {
  void engine.then(module => {
    if (typeof data !== "string") return error("E_STUDIO_TRANSPORT");
    // Oversize requests still use the same engine-owned response and state.
    const bytes = data.length <= maxRequest ? encoder.encode(data) : null;
    const length = bytes && bytes.length <= maxRequest ? bytes.length : maxRequest+1;
    const input = module._malloc(length+1);
    const written = module._malloc(4);
    try {
      if (!input || !written) return error("E_STUDIO_MEMORY");
      if (length <= maxRequest) module.HEAPU8.set(bytes,input);
      const reply = module._fgmr_studio_call(input,length,written);
      const view = new DataView(module.HEAPU8.buffer);
      return reply ? decoder.decode(module.HEAPU8.subarray(reply,reply+view.getUint32(written,true)))
                   : error("E_STUDIO_TRANSPORT");
    } finally {
      module._free(input);
      module._free(written);
    }
  }).then(
    reply => self.postMessage(reply),
    () => self.postMessage(error("E_STUDIO_RUNTIME")),
  );
};
