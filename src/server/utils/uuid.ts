import {
  v7 as uuidv7,
  parse as uuidParse,
  stringify as uuidStringify,
} from "uuid";

export function generateUUID() {
  return uuidv7();
}

export function parseUUID(uuid: string) {
  return uuidParse(uuid);
}

export function stringifyUUID(buffer: Uint8Array) {
  return uuidStringify(buffer);
}
