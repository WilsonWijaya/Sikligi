import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";

const MAX_IMAGE_BYTES = 1_500_000;
const dataUrlPattern = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;
const TICKET_FOLDER = "sikligi/tickets";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const MIN_IMAGE_SIDE = 100;
const MAX_IMAGE_SIDE = 1600;

function imageKind(bytes: Buffer) {
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "png";
  if (bytes.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return "jpeg";
  return null;
}

function signParams(params: Record<string, string>, apiSecret: string) {
  const sorted = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("&");
  return createHash("sha1").update(sorted + apiSecret).digest("hex");
}

type StoredImage = { type: "authenticated" | "upload"; version: string | null; publicId: string; format: string };

export function parseTicketImage(url: string): StoredImage | null {
  const match = new RegExp(`^https://res\\.cloudinary\\.com/[^/]+/image/(authenticated|upload)/(?:s--[A-Za-z0-9_-]+--/)?(?:v(\\d+)/)?(${TICKET_FOLDER}/[A-Za-z0-9_-]+)\\.(png|jpe?g)$`).exec(url);
  return match ? { type: match[1] as StoredImage["type"], version: match[2] ?? null, publicId: match[3], format: match[4] } : null;
}

function storedUrl(cloudName: string, image: StoredImage) {
  return `https://res.cloudinary.com/${cloudName}/image/${image.type}/${image.version ? `v${image.version}/` : ""}${image.publicId}.${image.format}`;
}

export async function fetchTicketImage(url: string) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const image = parseTicketImage(url);
  if (!cloudName || !apiSecret || !image) throw new ApiError(404, "Gambar tidak ditemukan");

  const source = `${image.publicId}.${image.format}`;
  const signature = createHash("sha1").update(source + apiSecret).digest("base64url").slice(0, 8);
  const signed = image.type === "authenticated" ? `s--${signature}--/` : "";
  let response: Response;
  try {
    response = await fetch(`https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/${image.type}/${signed}${image.version ? `v${image.version}/` : ""}${source}`);
  } catch {
    throw new ApiError(502, "Gambar gagal dimuat. Coba lagi.");
  }
  if (response.status === 404) throw new ApiError(404, "Gambar tidak ditemukan");
  if (!response.ok) {
    console.error("Cloudinary fetch failed", image.publicId, response.status);
    throw new ApiError(502, "Gambar gagal dimuat. Coba lagi.");
  }
  return { bytes: await response.arrayBuffer(), contentType: image.format === "png" ? "image/png" : "image/jpeg", extension: image.format === "png" ? "png" : "jpg" };
}

export async function uploadTicketImage(dataUrl: string) {
  const match = dataUrlPattern.exec(dataUrl);
  if (!match) throw new ApiError(400, "Gambar harus berformat PNG atau JPG.");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw new ApiError(413, "Ukuran gambar terlalu besar.");
  const kind = imageKind(bytes);
  if (!kind) throw new ApiError(400, "Gambar harus berformat PNG atau JPG.");

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new ApiError(503, "Unggah gambar belum dikonfigurasi, sehingga tiket belum dapat dikirim. Hubungi tim IT.");
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const allowedFormats = "jpg,png";
  const transformation = `c_limit,h_${MAX_IMAGE_SIDE},w_${MAX_IMAGE_SIDE}`;
  const params = { allowed_formats: allowedFormats, folder: TICKET_FOLDER, timestamp, transformation, type: "authenticated" };
  const form = new FormData();
  form.set("file", `data:image/${kind};base64,${bytes.toString("base64")}`);
  for (const [key, value] of Object.entries(params)) form.set(key, value);
  form.set("api_key", apiKey);
  form.set("signature", signParams(params, apiSecret));

  let response: Response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, { method: "POST", body: form });
  } catch {
    throw new ApiError(502, "Gambar gagal diunggah. Periksa koneksi lalu coba lagi.");
  }
  const result = (await response.json().catch(() => null)) as { public_id?: string; version?: number; format?: string; type?: string; width?: number; height?: number } | null;
  if (response.status === 400) throw new ApiError(400, "Gambar rusak atau tidak dapat dibaca. Gunakan file PNG atau JPG lain.");
  const url = response.ok && result?.type === "authenticated" && result.public_id && result.version && result.format
    ? `https://res.cloudinary.com/${cloudName}/image/authenticated/v${result.version}/${result.public_id}.${result.format}`
    : null;
  if (!url || !result || !parseTicketImage(url)) throw new ApiError(502, "Gambar gagal diunggah. Coba lagi.");
  if (!result.width || !result.height || result.width < MIN_IMAGE_SIDE || result.height < MIN_IMAGE_SIDE) {
    await deleteTicketImage(url);
    throw new ApiError(400, `Gambar terlalu kecil untuk sebuah screenshot (minimal ${MIN_IMAGE_SIDE} × ${MIN_IMAGE_SIDE} piksel).`);
  }
  return url;
}

export async function privatizeTicketImage(url: string) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const image = parseTicketImage(url);
  if (!cloudName || !apiKey || !apiSecret) throw new Error("CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, dan CLOUDINARY_API_SECRET wajib diisi.");
  if (!image) throw new Error(`Bukan alamat gambar tiket: ${url}`);
  if (image.type === "authenticated") return storedUrl(cloudName, image);

  const params = { from_public_id: image.publicId, invalidate: "true", timestamp: String(Math.floor(Date.now() / 1000)), to_public_id: image.publicId, to_type: "authenticated", type: "upload" };
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.set(key, value);
  form.set("api_key", apiKey);
  form.set("signature", signParams(params, apiSecret));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/rename`, { method: "POST", body: form });
  const result = (await response.json().catch(() => null)) as { public_id?: string; version?: number; format?: string; type?: string; error?: { message?: string } } | null;
  if (!response.ok || result?.type !== "authenticated" || !result.public_id || !result.format) {
    throw new Error(`Cloudinary menolak ${image.publicId}: ${result?.error?.message ?? response.status}`);
  }
  return storedUrl(cloudName, { type: "authenticated", version: result.version ? String(result.version) : image.version, publicId: result.public_id, format: result.format });
}

export async function deleteTicketImage(url: string) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const image = parseTicketImage(url);
  if (!cloudName || !apiKey || !apiSecret || !image) return;
  const publicId = image.publicId;

  const params = { invalidate: "true", public_id: publicId, timestamp: String(Math.floor(Date.now() / 1000)), type: image.type };
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.set(key, value);
  form.set("api_key", apiKey);
  form.set("signature", signParams(params, apiSecret));
  try {
    const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/destroy`, { method: "POST", body: form });
    const result = (await response.json().catch(() => null)) as { result?: string } | null;
    if (!response.ok || result?.result !== "ok") console.error("Cloudinary destroy failed", publicId, response.status, result);
  } catch (error) {
    console.error("Cloudinary destroy failed", publicId, error);
  }
}
