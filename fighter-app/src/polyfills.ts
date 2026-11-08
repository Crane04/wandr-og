// Gaps between React Native's JavaScript engine and a browser that three.js relies on.

// GLTFLoader reads a .glb's JSON header with TextDecoder (UTF-8 only is needed).
if (typeof globalThis.TextDecoder === 'undefined') {
  class Utf8Decoder {
    decode(input?: ArrayBuffer | ArrayBufferView) {
      if (!input) return '';
      const b = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      let out = '';
      for (let i = 0; i < b.length; ) {
        const c = b[i++];
        let cp = c;
        if (c >= 0xf0) cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
        else if (c >= 0xe0) cp = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
        else if (c >= 0xc0) cp = ((c & 31) << 6) | (b[i++] & 63);
        out += String.fromCodePoint(cp);
      }
      return out;
    }
  }
  (globalThis as unknown as { TextDecoder: unknown }).TextDecoder = Utf8Decoder;
}
