// Private storage for original uploads. S3-compatible bucket in production; a local folder for dev and tests.
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface BlobStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class S3Blobs implements BlobStore {
  private s3: S3Client;
  constructor(private bucket: string, endpoint: string, region: string, accessKeyId: string, secretAccessKey: string) {
    this.s3 = new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: false });
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }));
  }
  async remove(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export class DirBlobs implements BlobStore {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  private file(key: string) {
    if (!/^[a-z0-9/-]+$/.test(key)) throw new Error("bad key");
    return path.join(this.dir, key);
  }
  async put(key: string, data: Buffer) {
    const f = this.file(key);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, data, { mode: 0o600 });
  }
  async remove(key: string) {
    rmSync(this.file(key), { force: true });
  }
}

export function blobsFromEnv(): BlobStore {
  const e = process.env;
  if (e.BUCKET && e.BUCKET_ENDPOINT && e.BUCKET_ACCESS_KEY_ID && e.BUCKET_SECRET_ACCESS_KEY) {
    return new S3Blobs(e.BUCKET, e.BUCKET_ENDPOINT, e.BUCKET_REGION ?? "auto", e.BUCKET_ACCESS_KEY_ID, e.BUCKET_SECRET_ACCESS_KEY);
  }
  if (e.NODE_ENV === "production") throw new Error("Object storage is not configured");
  return new DirBlobs(e.BLOB_DIR ?? path.join(process.cwd(), ".blobs"));
}
