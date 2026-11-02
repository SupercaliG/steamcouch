// Parsers for Valve's KeyValues formats: text VDF (libraryfolders.vdf,
// appmanifest_*.acf, localconfig.vdf, loginusers.vdf) and binary VDF
// (shortcuts.vdf, appinfo.vdf).

export type VdfValue = string | number | bigint | VdfObject;
export interface VdfObject {
  [key: string]: VdfValue;
}

/** Case-insensitive path lookup: get(obj, "Software", "Valve", "Steam"). */
export function get(obj: VdfValue | undefined, ...path: string[]): VdfValue | undefined {
  let cur: VdfValue | undefined = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    const lower = key.toLowerCase();
    const match: string | undefined = Object.keys(cur).find((k) => k.toLowerCase() === lower);
    cur = match === undefined ? undefined : (cur as VdfObject)[match];
  }
  return cur;
}

export function getObject(obj: VdfValue | undefined, ...path: string[]): VdfObject | undefined {
  const v = get(obj, ...path);
  return v && typeof v === "object" ? (v as VdfObject) : undefined;
}

export function getString(obj: VdfValue | undefined, ...path: string[]): string | undefined {
  const v = get(obj, ...path);
  return v === undefined || typeof v === "object" ? undefined : String(v);
}

export function getNumber(obj: VdfValue | undefined, ...path: string[]): number | undefined {
  const v = get(obj, ...path);
  if (v === undefined || typeof v === "object") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------- text VDF

export function parseTextVdf(text: string): VdfObject {
  let i = 0;
  const n = text.length;

  const skip = () => {
    while (i < n) {
      const c = text[i]!;
      if (c === " " || c === "\t" || c === "\r" || c === "\n") i++;
      else if (c === "/" && text[i + 1] === "/") {
        while (i < n && text[i] !== "\n") i++;
      } else break;
    }
  };

  const readString = (): string => {
    if (text[i] === '"') {
      i++;
      let out = "";
      while (i < n && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < n) {
          const e = text[i + 1]!;
          out += e === "n" ? "\n" : e === "t" ? "\t" : e;
          i += 2;
        } else out += text[i++];
      }
      i++; // closing quote
      return out;
    }
    const start = i;
    while (i < n && !/[\s{}"]/.test(text[i]!)) i++;
    return text.slice(start, i);
  };

  const readObject = (): VdfObject => {
    const obj: VdfObject = {};
    for (;;) {
      skip();
      if (i >= n || text[i] === "}") {
        i++;
        return obj;
      }
      const key = readString();
      skip();
      if (text[i] === "{") {
        i++;
        obj[key] = readObject();
      } else {
        obj[key] = readString();
      }
    }
  };

  return readObject();
}

// -------------------------------------------------------------- binary VDF

const T_MAP = 0x00;
const T_STRING = 0x01;
const T_INT32 = 0x02;
const T_FLOAT = 0x03;
const T_PTR = 0x04;
const T_WSTRING = 0x05;
const T_COLOR = 0x06;
const T_UINT64 = 0x07;
const T_END = 0x08;
const T_INT64 = 0x0a;
const T_END_ALT = 0x0b;

class Reader {
  readonly buf: Buffer;
  pos: number;
  constructor(buf: Buffer, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }
  u8() {
    return this.buf.readUInt8(this.pos++);
  }
  u32() {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  i32() {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  u64() {
    const v = this.buf.readBigUInt64LE(this.pos);
    this.pos += 8;
    return v;
  }
  i64() {
    const v = this.buf.readBigInt64LE(this.pos);
    this.pos += 8;
    return v;
  }
  f32() {
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }
  cstr() {
    const end = this.buf.indexOf(0, this.pos);
    const s = this.buf.toString("utf8", this.pos, end);
    this.pos = end + 1;
    return s;
  }
  skip(bytes: number) {
    this.pos += bytes;
  }
}

/** Reads one binary KeyValues map body (after its type+key) until T_END. */
function readBinaryMap(r: Reader, readKey: () => string): VdfObject {
  const obj: VdfObject = {};
  for (;;) {
    const type = r.u8();
    if (type === T_END || type === T_END_ALT) return obj;
    const key = readKey();
    switch (type) {
      case T_MAP:
        obj[key] = readBinaryMap(r, readKey);
        break;
      case T_STRING:
        obj[key] = r.cstr();
        break;
      case T_INT32:
      case T_PTR:
      case T_COLOR:
        obj[key] = r.i32();
        break;
      case T_FLOAT:
        obj[key] = r.f32();
        break;
      case T_UINT64:
        obj[key] = r.u64();
        break;
      case T_INT64:
        obj[key] = r.i64();
        break;
      case T_WSTRING: {
        // UTF-16LE, null-terminated.
        let end = r.pos;
        while (r.buf.readUInt16LE(end) !== 0) end += 2;
        obj[key] = r.buf.toString("utf16le", r.pos, end);
        r.pos = end + 2;
        break;
      }
      default:
        throw new Error(`Unknown binary VDF type 0x${type.toString(16)} at ${r.pos - 1}`);
    }
  }
}

/** shortcuts.vdf and other plain binary KeyValues files. */
export function parseBinaryVdf(buf: Buffer): VdfObject {
  const r = new Reader(buf);
  return readBinaryMap(r, () => r.cstr());
}

export interface AppInfoEntry {
  appId: number;
  data: VdfObject;
}

/**
 * appcache/appinfo.vdf, versions 28 (0x07564428) and 29 (0x07564429).
 * v29 stores KeyValues keys as indexes into a string table at the file end.
 */
export function parseAppInfo(buf: Buffer): AppInfoEntry[] {
  const r = new Reader(buf);
  const magic = r.u32();
  r.u32(); // universe
  const version = magic & 0xff;
  if ((magic & 0xffffff00) !== 0x07564400 || version < 0x27) {
    throw new Error(`Unsupported appinfo.vdf magic 0x${magic.toString(16)}`);
  }

  let readKey: () => string = () => r.cstr();
  if (version >= 0x29) {
    const tableOffset = Number(r.i64());
    const t = new Reader(buf, tableOffset);
    const count = t.u32();
    const strings: string[] = [];
    for (let k = 0; k < count; k++) strings.push(t.cstr());
    readKey = () => strings[r.u32()] ?? "";
  }

  const entries: AppInfoEntry[] = [];
  for (;;) {
    const appId = r.u32();
    if (appId === 0) break;
    const size = r.u32();
    const next = r.pos + size;
    // infoState u32, lastUpdated u32, picsToken u64, sha1[20], changeNumber u32
    r.skip(4 + 4 + 8 + 20 + 4);
    if (version >= 0x28) r.skip(20); // binary sha1
    try {
      const type = r.u8();
      readKey(); // root key ("appinfo")
      const data = type === T_MAP ? readBinaryMap(r, readKey) : {};
      entries.push({ appId, data });
    } catch {
      // Skip a damaged entry; `size` tells us where the next one starts.
    }
    r.pos = next;
  }
  return entries;
}
