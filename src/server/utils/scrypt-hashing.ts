import { randomBytes, scrypt } from "node:crypto";

const scryptOptions = {
  N: Math.pow(2, 16),
  r: 8,
  p: 2,
  maxmem: 128 * Math.pow(2, 16) * 9,
};
export function hashPassword(password: string): Promise<string> {
  return new Promise((res, rej) => {
    const salt = randomBytes(16).toString("base64url");
    scrypt(password, salt, 64, scryptOptions, (err, derivedKey) => {
      if (err) rej(err);
      res(`${salt}:${derivedKey.toString("base64url")}`);
    });
  });
}

export function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return new Promise((res, rej) => {
    const [salt, key] = hash.split(":");
    scrypt(password, salt, 64, scryptOptions, (err, derivedKey) => {
      if (err) rej(err);
      res(key === derivedKey.toString("base64url"));
    });
  });
}
