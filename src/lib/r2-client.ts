import { S3Client } from "@aws-sdk/client-s3";

let _r2Client: S3Client | null = null;

function getR2Config() {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;

  if (!accountId) throw new Error("Missing required env var: CLOUDFLARE_R2_ACCOUNT_ID");
  if (!accessKeyId) throw new Error("Missing required env var: CLOUDFLARE_R2_ACCESS_KEY_ID");
  if (!secretAccessKey) throw new Error("Missing required env var: CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  if (!bucketName) throw new Error("Missing required env var: CLOUDFLARE_R2_BUCKET_NAME");

  return { accountId, accessKeyId, secretAccessKey, bucketName };
}

export function getR2Client(): S3Client {
  if (!_r2Client) {
    const { accountId, accessKeyId, secretAccessKey } = getR2Config();
    _r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return _r2Client;
}

export function getR2Bucket(): string {
  return getR2Config().bucketName;
}

export function getR2AccountId(): string {
  return getR2Config().accountId;
}
