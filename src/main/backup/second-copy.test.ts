import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { secondCopyReason, streamFile, writeSecondCopy, type CopyFile } from "./second-copy";

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

const failAfterPartialWrite: CopyFile = ({ tempFile }) => {
  writeFileSync(tempFile, "part");
  return Promise.reject(errno("ENOSPC"));
};

describe("writeSecondCopy", () => {
  let dir: string;
  let source: string;
  let folder: string;
  const signal = new AbortController().signal;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vendora-second-copy-"));
    source = join(dir, "source.db");
    folder = join(dir, "usb");
    writeFileSync(source, "backup bytes");
    mkdirSync(folder);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lands under the final name with identical bytes and no temp file", async () => {
    await writeSecondCopy(
      { sourceFile: source, folder, fileName: "vendora-a.db", signal },
      streamFile,
    );

    expect(readdirSync(folder)).toEqual(["vendora-a.db"]);
    expect(readFileSync(join(folder, "vendora-a.db"), "utf8")).toBe("backup bytes");
  });

  it("streamFile rejects on an aborted signal", async () => {
    const aborted = AbortSignal.abort();

    await expect(
      streamFile({ sourceFile: source, tempFile: join(folder, "x.tmp"), signal: aborted }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects for a missing folder without creating it", async () => {
    const missing = join(dir, "unplugged");

    await expect(
      writeSecondCopy(
        { sourceFile: source, folder: missing, fileName: "a.db", signal },
        streamFile,
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });

    expect(existsSync(missing)).toBe(false);
  });

  it("leaves no temp or final file when the copy stops part way with ENOSPC", async () => {
    await expect(
      writeSecondCopy(
        { sourceFile: source, folder, fileName: "a.db", signal },
        failAfterPartialWrite,
      ),
    ).rejects.toMatchObject({ code: "ENOSPC" });

    expect(readdirSync(folder)).toEqual([]);
  });
});

describe("secondCopyReason", () => {
  it("maps known codes to plain words", () => {
    expect(secondCopyReason(errno("ENOENT"))).toBe(
      "Folder not found. If it's on a USB drive, plug it in.",
    );
    expect(secondCopyReason(errno("ENOTDIR"))).toContain("Folder not found");
    expect(secondCopyReason(errno("ENODEV"))).toContain("Folder not found");
    expect(secondCopyReason(errno("ENOSPC"))).toBe("Not enough free space in the folder.");
    expect(secondCopyReason(errno("EDQUOT"))).toBe("Not enough free space in the folder.");
    expect(secondCopyReason(errno("EACCES"))).toBe("Vendora can't write to this folder.");
    expect(secondCopyReason(errno("EPERM"))).toBe("Vendora can't write to this folder.");
    expect(secondCopyReason(errno("EROFS"))).toBe("Vendora can't write to this folder.");
    expect(secondCopyReason(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(
      "Vendora closed before the copy finished.",
    );
  });

  it("falls back to the message and caps length", () => {
    expect(secondCopyReason(new Error("odd"))).toBe("odd");
    expect(secondCopyReason(new Error(""))).toBe("Copy failed.");
    expect(secondCopyReason(new Error("x".repeat(900)))).toHaveLength(500);
  });
});
