import { put } from '@vercel/blob'

export interface ObjectStorageAdapter {
  putObject(key: string, data: Uint8Array, contentType?: string): Promise<string>
  getObject(urlOrPath: string): Promise<Uint8Array | null>
}

export class VercelBlobStorageAdapter implements ObjectStorageAdapter {
  async putObject(pathname: string, data: Uint8Array, contentType = 'application/json'): Promise<string> {
    const blob = await put(pathname, Buffer.from(data), {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    return blob.url
  }

  async getObject(urlOrPath: string): Promise<Uint8Array | null> {
    try {
      let fetchUrl = urlOrPath
      // If it's a relative storage key like pastes/xxx.json
      if (!fetchUrl.startsWith('http')) {
        // Construct canonical Vercel public blob URL
        // https://store_<id>.public.blob.vercel-storage.com/<path>
        const storeId = process.env.BLOB_STORE_ID?.replace(/^store_/, '')
        if (storeId) {
          fetchUrl = `https://${storeId}.public.blob.vercel-storage.com/${urlOrPath}`
        } else {
          return null
        }
      }

      const res = await fetch(fetchUrl, { cache: 'no-store' })
      if (!res.ok) return null
      const buf = await res.arrayBuffer()
      return new Uint8Array(buf)
    } catch {
      return null
    }
  }
}

let activeAdapter: ObjectStorageAdapter | null = null

export function getStorageAdapter(): ObjectStorageAdapter {
  if (!activeAdapter) {
    activeAdapter = new VercelBlobStorageAdapter()
  }
  return activeAdapter
}
