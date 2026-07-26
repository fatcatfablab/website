import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const fail = (message) => {
  process.stderr.write(`secret generation failed: ${message}\n`);
  process.exitCode = 1;
};

const readStandardInput = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const value = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  if (!value || Buffer.byteLength(value, "utf8") > 1_024) throw new Error("password input must be 1-1024 bytes");
  return value;
};

const replaceSetting = (source, name, value) => {
  const expression = new RegExp(`^${name}=.*$`, "m");
  if (!expression.test(source)) throw new Error(`${name} placeholder is missing from the env file`);
  return source.replace(expression, `${name}=${value}`);
};

const writeAtomicPrivateFile = async (path, content) => {
  const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

try {
  const envFlag = process.argv.indexOf("--env-file");
  if (envFlag < 0 || !process.argv[envFlag + 1] || process.argv.length !== 4) {
    throw new Error("usage: node scripts/generate-deployment-secrets.mjs --env-file PATH");
  }

  const envPath = resolve(process.argv[envFlag + 1]);
  const metadata = await lstat(envPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("env file must be an existing regular file");

  const password = await readStandardInput();
  const salt = randomBytes(16);
  const digest = await scrypt(password, salt, 32, SCRYPT_OPTIONS);
  const passwordHash = [
    "scrypt",
    String(SCRYPT_OPTIONS.N),
    String(SCRYPT_OPTIONS.r),
    String(SCRYPT_OPTIONS.p),
    salt.toString("base64url"),
    Buffer.from(digest).toString("base64url"),
  ].join("$");
  const sessionSecret = randomBytes(48).toString("base64url");

  let content = await readFile(envPath, "utf8");
  content = replaceSetting(content, "FCFL_PROTECTED_PASSWORD_HASH", passwordHash);
  content = replaceSetting(content, "FCFL_SESSION_SECRET", sessionSecret);
  await writeAtomicPrivateFile(envPath, content);
} catch (error) {
  fail(error instanceof Error ? error.message : "unknown error");
}
