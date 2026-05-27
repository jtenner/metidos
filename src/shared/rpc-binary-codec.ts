/**
 * Compact binary codec for mainview RPC structs.
 *
 * This intentionally does not wrap JSON in a binary frame. It serializes the
 * JavaScript RPC envelope as typed binary values and compresses only large
 * payloads.
 */

const MAGIC = 0x4d52; // MR
const VERSION = 1;
const FLAG_COMPRESSED = 1;
const COMPRESS_THRESHOLD_BYTES = 16 * 1024;

const TAG_NULL = 0x00;
const TAG_FALSE = 0x01;
const TAG_TRUE = 0x02;
const TAG_NUMBER = 0x03;
const TAG_STRING = 0x04;
const TAG_ARRAY = 0x05;
const TAG_OBJECT = 0x06;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type RpcBinaryEncodeOptions = {
  compress?: boolean;
};

type RpcBinaryDecodeOptions = {
  allowCompressed?: boolean;
  maxDecodedBodyBytes?: number;
};

type BinaryRpcValue =
  | null
  | boolean
  | number
  | string
  | BinaryRpcValue[]
  | { [key: string]: BinaryRpcValue | undefined };

class BinaryWriter {
  private chunks: Uint8Array[] = [];
  private byteLength = 0;

  writeByte(value: number): void {
    this.writeBytes(Uint8Array.of(value & 0xff));
  }

  writeUint16(value: number): void {
    this.writeByte(value >>> 8);
    this.writeByte(value);
  }

  writeUint32(value: number): void {
    this.writeByte(value >>> 24);
    this.writeByte(value >>> 16);
    this.writeByte(value >>> 8);
    this.writeByte(value);
  }

  writeVarUint(value: number): void {
    let remaining = value >>> 0;
    while (remaining >= 0x80) {
      this.writeByte((remaining & 0x7f) | 0x80);
      remaining >>>= 7;
    }
    this.writeByte(remaining);
  }

  writeBytes(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) {
      return;
    }
    this.chunks.push(bytes);
    this.byteLength += bytes.byteLength;
  }

  toUint8Array(): Uint8Array {
    if (this.chunks.length === 1) {
      return this.chunks[0] ?? new Uint8Array();
    }
    const output = new Uint8Array(this.byteLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
}

class BinaryReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readByte(): number {
    if (this.offset >= this.bytes.length) {
      throw new Error("Unexpected end of RPC binary frame.");
    }
    return this.bytes[this.offset++] ?? 0;
  }

  readUint16(): number {
    return (this.readByte() << 8) | this.readByte();
  }

  readUint32(): number {
    return (
      (this.readByte() * 0x1000000 +
        (this.readByte() << 16) +
        (this.readByte() << 8) +
        this.readByte()) >>>
      0
    );
  }

  readVarUint(): number {
    let result = 0;
    let shift = 0;
    while (shift <= 28) {
      const byte = this.readByte();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return result >>> 0;
      }
      shift += 7;
    }
    throw new Error("RPC binary varint is too large.");
  }

  readBytes(length: number): Uint8Array {
    const end = this.offset + length;
    if (end > this.bytes.length) {
      throw new Error("Unexpected end of RPC binary byte range.");
    }
    const slice = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return slice;
  }

  assertDone(): void {
    if (this.offset !== this.bytes.length) {
      throw new Error("RPC binary frame has trailing bytes.");
    }
  }
}

function writeValue(
  writer: BinaryWriter,
  value: BinaryRpcValue | undefined,
): void {
  if (value === undefined || value === null) {
    writer.writeByte(TAG_NULL);
    return;
  }
  if (value === false) {
    writer.writeByte(TAG_FALSE);
    return;
  }
  if (value === true) {
    writer.writeByte(TAG_TRUE);
    return;
  }
  if (typeof value === "number") {
    writer.writeByte(TAG_NUMBER);
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, false);
    writer.writeBytes(new Uint8Array(buffer));
    return;
  }
  if (typeof value === "string") {
    writer.writeByte(TAG_STRING);
    const bytes = textEncoder.encode(value);
    writer.writeVarUint(bytes.length);
    writer.writeBytes(bytes);
    return;
  }
  if (Array.isArray(value)) {
    writer.writeByte(TAG_ARRAY);
    writer.writeVarUint(value.length);
    for (const item of value) {
      writeValue(writer, item);
    }
    return;
  }
  writer.writeByte(TAG_OBJECT);
  const entries = Object.entries(value).filter(
    (entry) => entry[1] !== undefined,
  );
  writer.writeVarUint(entries.length);
  for (const [key, entryValue] of entries) {
    const keyBytes = textEncoder.encode(key);
    writer.writeVarUint(keyBytes.length);
    writer.writeBytes(keyBytes);
    writeValue(writer, entryValue);
  }
}

function readValue(reader: BinaryReader): BinaryRpcValue {
  const tag = reader.readByte();
  switch (tag) {
    case TAG_NULL:
      return null;
    case TAG_FALSE:
      return false;
    case TAG_TRUE:
      return true;
    case TAG_NUMBER: {
      const bytes = reader.readBytes(8);
      return new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      ).getFloat64(0, false);
    }
    case TAG_STRING:
      return textDecoder.decode(reader.readBytes(reader.readVarUint()));
    case TAG_ARRAY: {
      const length = reader.readVarUint();
      const values: BinaryRpcValue[] = [];
      for (let index = 0; index < length; index += 1) {
        values.push(readValue(reader));
      }
      return values;
    }
    case TAG_OBJECT: {
      const length = reader.readVarUint();
      const value: Record<string, BinaryRpcValue> = {};
      for (let index = 0; index < length; index += 1) {
        const key = textDecoder.decode(reader.readBytes(reader.readVarUint()));
        value[key] = readValue(reader);
      }
      return value;
    }
    default:
      throw new Error(`Unsupported RPC binary value tag: ${tag}`);
  }
}

function toUint8Array(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

async function transformBytes(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  await writer.write(bytes as unknown as BufferSource);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

function getBunCompression(): {
  gzipSync(bytes: Uint8Array): Uint8Array;
  gunzipSync(bytes: Uint8Array): Uint8Array;
} | null {
  const maybeBun = (globalThis as { Bun?: unknown }).Bun;
  return maybeBun && typeof maybeBun === "object" && "gzipSync" in maybeBun
    ? (maybeBun as {
        gzipSync(bytes: Uint8Array): Uint8Array;
        gunzipSync(bytes: Uint8Array): Uint8Array;
      })
    : null;
}

async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const bunCompression = getBunCompression();
  if (bunCompression) {
    return bunCompression.gzipSync(bytes);
  }
  if (typeof CompressionStream === "undefined") {
    return bytes;
  }
  return transformBytes(bytes, new CompressionStream("gzip"));
}

async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const bunCompression = getBunCompression();
  if (bunCompression) {
    return bunCompression.gunzipSync(bytes);
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("RPC binary compressed frame cannot be decoded here.");
  }
  return transformBytes(bytes, new DecompressionStream("gzip"));
}

export function isRpcBinaryFrame(
  value: unknown,
): value is Uint8Array | ArrayBuffer {
  if (!(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) {
    return false;
  }
  const bytes = toUint8Array(value);
  return (
    bytes.length >= 4 && (((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0)) === MAGIC
  );
}

export async function encodeRpcBinaryFrame(
  value: unknown,
  options: RpcBinaryEncodeOptions = {},
): Promise<Uint8Array> {
  const bodyWriter = new BinaryWriter();
  writeValue(bodyWriter, value as BinaryRpcValue);
  let body = bodyWriter.toUint8Array();
  let flags = 0;
  if (
    options.compress !== false &&
    body.byteLength >= COMPRESS_THRESHOLD_BYTES
  ) {
    const compressedBody = await gzipBytes(body);
    if (compressedBody.byteLength < body.byteLength) {
      body = compressedBody;
      flags |= FLAG_COMPRESSED;
    }
  }
  const writer = new BinaryWriter();
  writer.writeUint16(MAGIC);
  writer.writeByte(VERSION);
  writer.writeByte(flags);
  writer.writeUint32(body.byteLength);
  writer.writeBytes(body);
  return writer.toUint8Array();
}

export async function decodeRpcBinaryFrame(
  value: Uint8Array | ArrayBuffer,
  options: RpcBinaryDecodeOptions = {},
): Promise<unknown> {
  const reader = new BinaryReader(toUint8Array(value));
  if (reader.readUint16() !== MAGIC) {
    throw new Error("Invalid RPC binary frame magic.");
  }
  if (reader.readByte() !== VERSION) {
    throw new Error("Unsupported RPC binary frame version.");
  }
  const flags = reader.readByte();
  if ((flags & ~FLAG_COMPRESSED) !== 0) {
    throw new Error("Unsupported RPC binary frame flags.");
  }
  let body = reader.readBytes(reader.readUint32());
  reader.assertDone();
  const maxDecodedBodyBytes = options.maxDecodedBodyBytes;
  if (
    maxDecodedBodyBytes !== undefined &&
    body.byteLength > maxDecodedBodyBytes
  ) {
    throw new Error("RPC binary frame exceeds decoded byte limit.");
  }
  if ((flags & FLAG_COMPRESSED) !== 0) {
    if (options.allowCompressed === false) {
      throw new Error("Compressed RPC binary frames are not accepted.");
    }
    body = await gunzipBytes(body);
    if (
      maxDecodedBodyBytes !== undefined &&
      body.byteLength > maxDecodedBodyBytes
    ) {
      throw new Error("RPC binary frame exceeds decoded byte limit.");
    }
  }
  const bodyReader = new BinaryReader(body);
  const decoded = readValue(bodyReader);
  bodyReader.assertDone();
  return decoded;
}
