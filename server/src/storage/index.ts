import { createHash, randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { del, put } from '@vercel/blob'
import { env } from '../config/env.js'

export type StoredObject = { key: string; url: string; size: number; contentType: string }

export interface StorageDriver {
  put(input: { key: string; body: Buffer; contentType: string }): Promise<StoredObject>
  remove(key: string): Promise<void>
  url(key: string): string
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
}

export const ALLOWED_IMAGE_TYPES = Object.keys(EXTENSION_BY_MIME)

/**
 * The multipart mimetype is whatever the client claims. Checking the file's
 * leading bytes stops an HTML or script payload being stored as "image/png".
 */
export function contentMatchesImageType(body: Buffer, contentType: string): boolean {
  const ascii = (start: number, end: number) => body.subarray(start, end).toString('latin1')
  switch (contentType) {
    case 'image/jpeg':
      return body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
    case 'image/png':
      return body.length > 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    case 'image/webp':
      return body.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
    case 'image/avif':
      return body.length > 12 && ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))
    default:
      return false
  }
}

/** Deterministic, collision-free keys that keep the original folder grouping. */
export function buildObjectKey(prefix: string, originalName: string, contentType: string): string {
  const extension = EXTENSION_BY_MIME[contentType] ?? (path.extname(originalName).toLowerCase() || '.bin')
  const digest = createHash('sha256').update(`${randomUUID()}:${originalName}`).digest('hex').slice(0, 32)
  return `${prefix}/${new Date().toISOString().slice(0, 7)}/${digest}${extension}`
}

class LocalDiskDriver implements StorageDriver {
  private readonly root = path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR)

  async put({ key, body, contentType }: { key: string; body: Buffer; contentType: string }): Promise<StoredObject> {
    const target = this.resolve(key)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, body)
    return { key, url: this.url(key), size: body.byteLength, contentType }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key))
    } catch (error) {
      // Deleting an already-missing object is not an error.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  url(key: string): string {
    return `${env.STORAGE_PUBLIC_URL.replace(/\/$/, '')}/${key}`
  }

  /** Blocks path traversal: the resolved path must stay inside the root. */
  private resolve(key: string): string {
    const target = path.resolve(this.root, key)
    if (target !== this.root && !target.startsWith(this.root + path.sep)) {
      throw new Error(`Refusing to write outside the storage root: ${key}`)
    }
    return target
  }
}

/**
 * Vercel Blob (public store). Serverless functions have no persistent disk, so
 * this is the production driver on Vercel. Keys are kept exactly as given, so
 * the database stores the same key under either driver and URLs stay derived.
 */
class VercelBlobDriver implements StorageDriver {
  private readonly token = env.BLOB_READ_WRITE_TOKEN
  private readonly baseUrl = blobBaseUrl()

  async put({ key, body, contentType }: { key: string; body: Buffer; contentType: string }): Promise<StoredObject> {
    await put(key, body, {
      access: 'public',
      contentType,
      token: this.token,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31_536_000,
    })
    return { key, url: this.url(key), size: body.byteLength, contentType }
  }

  async remove(key: string): Promise<void> {
    // del() is a no-op for keys that do not exist.
    await del(this.url(key), { token: this.token })
  }

  url(key: string): string {
    return `${this.baseUrl}/${key}`
  }
}

/**
 * A read-write token looks like `vercel_blob_rw_<storeId>_<secret>`, and a public
 * store serves from `https://<storeId>.public.blob.vercel-storage.com`. An
 * explicit STORAGE_PUBLIC_URL (e.g. a custom domain) wins.
 */
function blobBaseUrl(): string {
  if (env.STORAGE_PUBLIC_URL_EXPLICIT) return env.STORAGE_PUBLIC_URL.replace(/\/$/, '')
  const storeId = env.BLOB_READ_WRITE_TOKEN?.split('_')[3]
  if (!storeId) {
    throw new Error('STORAGE_DRIVER=vercel-blob needs BLOB_READ_WRITE_TOKEN (connect a Blob store to the Vercel project).')
  }
  return `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com`
}

export const storage: StorageDriver = env.STORAGE_DRIVER === 'vercel-blob' ? new VercelBlobDriver() : new LocalDiskDriver()
