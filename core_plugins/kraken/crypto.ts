// @ts-nocheck
import { atob, btoa } from "@metidos/plugin-api";

const MASK_64 = (1n << 64n) - 1n;

function rotr64(value: bigint, shift: bigint): bigint {
  return ((value >> shift) | (value << (64n - shift))) & MASK_64;
}

function shr64(value: bigint, shift: bigint): bigint {
  return value >> shift;
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++) {
    let codePoint = value.charCodeAt(index);
    if (
      codePoint >= 0xd800 &&
      codePoint <= 0xdbff &&
      index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index++;
      }
    }
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

function bytesToBinary(bytes: number[]): string {
  return bytes.map((byte) => String.fromCharCode(byte & 0xff)).join("");
}

function binaryToBytes(value: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++)
    bytes.push(value.charCodeAt(index) & 0xff);
  return bytes;
}

export function base64ToBytes(value: string): number[] {
  return binaryToBytes(atob(value));
}

export function bytesToBase64(bytes: number[]): string {
  return btoa(bytesToBinary(bytes));
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr32(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

export function sha256(input: string | number[]): number[] {
  const bytes = typeof input === "string" ? utf8Bytes(input) : input.slice();
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56; shift >= 0; shift -= 8)
    bytes.push((bitLength / 2 ** shift) & 0xff);

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = new Array<number>(64);
    for (let index = 0; index < 16; index++) {
      const cursor = offset + index * 4;
      w[index] =
        ((bytes[cursor] << 24) |
          (bytes[cursor + 1] << 16) |
          (bytes[cursor + 2] << 8) |
          bytes[cursor + 3]) >>>
        0;
    }
    for (let index = 16; index < 64; index++) {
      const s0 =
        rotr32(w[index - 15], 7) ^
        rotr32(w[index - 15], 18) ^
        (w[index - 15] >>> 3);
      const s1 =
        rotr32(w[index - 2], 17) ^
        rotr32(w[index - 2], 19) ^
        (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let index = 0; index < 64; index++) {
      const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + SHA256_K[index] + w[index]) >>> 0;
      const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const out: number[] = [];
  for (const word of h)
    out.push(
      (word >>> 24) & 0xff,
      (word >>> 16) & 0xff,
      (word >>> 8) & 0xff,
      word & 0xff,
    );
  return out;
}

const SHA512_K = [
  0x428a2f98d728ae22n,
  0x7137449123ef65cdn,
  0xb5c0fbcfec4d3b2fn,
  0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n,
  0x59f111f1b605d019n,
  0x923f82a4af194f9bn,
  0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n,
  0x12835b0145706fben,
  0x243185be4ee4b28cn,
  0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn,
  0x80deb1fe3b1696b1n,
  0x9bdc06a725c71235n,
  0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n,
  0xefbe4786384f25e3n,
  0x0fc19dc68b8cd5b5n,
  0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n,
  0x4a7484aa6ea6e483n,
  0x5cb0a9dcbd41fbd4n,
  0x76f988da831153b5n,
  0x983e5152ee66dfabn,
  0xa831c66d2db43210n,
  0xb00327c898fb213fn,
  0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n,
  0xd5a79147930aa725n,
  0x06ca6351e003826fn,
  0x142929670a0e6e70n,
  0x27b70a8546d22ffcn,
  0x2e1b21385c26c926n,
  0x4d2c6dfc5ac42aedn,
  0x53380d139d95b3dfn,
  0x650a73548baf63den,
  0x766a0abb3c77b2a8n,
  0x81c2c92e47edaee6n,
  0x92722c851482353bn,
  0xa2bfe8a14cf10364n,
  0xa81a664bbc423001n,
  0xc24b8b70d0f89791n,
  0xc76c51a30654be30n,
  0xd192e819d6ef5218n,
  0xd69906245565a910n,
  0xf40e35855771202an,
  0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n,
  0x1e376c085141ab53n,
  0x2748774cdf8eeb99n,
  0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n,
  0x4ed8aa4ae3418acbn,
  0x5b9cca4f7763e373n,
  0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn,
  0x78a5636f43172f60n,
  0x84c87814a1f0ab72n,
  0x8cc702081a6439ecn,
  0x90befffa23631e28n,
  0xa4506cebde82bde9n,
  0xbef9a3f7b2c67915n,
  0xc67178f2e372532bn,
  0xca273eceea26619cn,
  0xd186b8c721c0c207n,
  0xeada7dd6cde0eb1en,
  0xf57d4f7fee6ed178n,
  0x06f067aa72176fban,
  0x0a637dc5a2c898a6n,
  0x113f9804bef90daen,
  0x1b710b35131c471bn,
  0x28db77f523047d84n,
  0x32caab7b40c72493n,
  0x3c9ebe0a15c9bebcn,
  0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n,
  0x597f299cfc657e2an,
  0x5fcb6fab3ad6faecn,
  0x6c44198c4a475817n,
];

function sha512(input: number[]): number[] {
  const bytes = input.slice();
  const bitLength = BigInt(bytes.length) * 8n;
  bytes.push(0x80);
  while (bytes.length % 128 !== 112) bytes.push(0);
  for (let shift = 120n; shift >= 0n; shift -= 8n)
    bytes.push(Number((bitLength >> shift) & 0xffn));

  const h = [
    0x6a09e667f3bcc908n,
    0xbb67ae8584caa73bn,
    0x3c6ef372fe94f82bn,
    0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n,
    0x9b05688c2b3e6c1fn,
    0x1f83d9abfb41bd6bn,
    0x5be0cd19137e2179n,
  ];

  for (let offset = 0; offset < bytes.length; offset += 128) {
    const w = new Array<bigint>(80);
    for (let index = 0; index < 16; index++) {
      let word = 0n;
      for (let byte = 0; byte < 8; byte++)
        word = (word << 8n) | BigInt(bytes[offset + index * 8 + byte]);
      w[index] = word;
    }
    for (let index = 16; index < 80; index++) {
      const s0 =
        rotr64(w[index - 15], 1n) ^
        rotr64(w[index - 15], 8n) ^
        shr64(w[index - 15], 7n);
      const s1 =
        rotr64(w[index - 2], 19n) ^
        rotr64(w[index - 2], 61n) ^
        shr64(w[index - 2], 6n);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) & MASK_64;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let index = 0; index < 80; index++) {
      const s1 = rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + SHA512_K[index] + w[index]) & MASK_64;
      const s0 = rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) & MASK_64;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) & MASK_64;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & MASK_64;
    }

    h[0] = (h[0] + a) & MASK_64;
    h[1] = (h[1] + b) & MASK_64;
    h[2] = (h[2] + c) & MASK_64;
    h[3] = (h[3] + d) & MASK_64;
    h[4] = (h[4] + e) & MASK_64;
    h[5] = (h[5] + f) & MASK_64;
    h[6] = (h[6] + g) & MASK_64;
    h[7] = (h[7] + hh) & MASK_64;
  }

  const out: number[] = [];
  for (const word of h) {
    for (let shift = 56n; shift >= 0n; shift -= 8n)
      out.push(Number((word >> shift) & 0xffn));
  }
  return out;
}

export function hmacSha512(key: number[], message: number[]): number[] {
  let normalizedKey = key.slice();
  if (normalizedKey.length > 128) normalizedKey = sha512(normalizedKey);
  while (normalizedKey.length < 128) normalizedKey.push(0);
  const outer = normalizedKey.map((byte) => byte ^ 0x5c);
  const inner = normalizedKey.map((byte) => byte ^ 0x36);
  return sha512(outer.concat(sha512(inner.concat(message))));
}
