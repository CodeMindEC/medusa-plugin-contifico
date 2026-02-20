import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * GET /admin/contifico/media?url=<encoded_url>
 * Proxy que descarga una imagen de Contifico y la re-sirve
 * con Content-Type correcto para que <img> la muestre.
 *
 * Contifico envía Content-Disposition: attachment y/o
 * Content-Type: application/octet-stream, lo cual impide
 * que el navegador muestre la imagen inline.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
    const url = req.query.url as string

    if (!url) {
        res.status(400).json({ error: "Parámetro 'url' requerido" })
        return
    }

    try {
        const resp = await fetch(url, { redirect: "follow" })
        if (!resp.ok) {
            res.status(resp.status).json({ error: `Error descargando imagen: ${resp.status}` })
            return
        }

        const buffer = Buffer.from(await resp.arrayBuffer())
        if (buffer.length < 100) {
            res.status(404).json({ error: "Imagen vacía" })
            return
        }

        // Detectar tipo real por magic bytes (no confiar en headers de Contifico)
        const mimeType =
            buffer[0] === 0x89 && buffer[1] === 0x50 ? "image/png"
                : buffer[0] === 0xFF && buffer[1] === 0xD8 ? "image/jpeg"
                    : buffer[0] === 0x52 && buffer[1] === 0x49 ? "image/webp"
                        : buffer[0] === 0x47 && buffer[1] === 0x49 ? "image/gif"
                            : "image/jpeg"

        res.setHeader("Content-Type", mimeType)
        res.setHeader("Content-Length", buffer.length)
        res.setHeader("Cache-Control", "public, max-age=86400") // cache 24h
        res.setHeader("Content-Disposition", "inline")
        res.end(buffer)
    } catch (err) {
        res.status(500).json({ error: `Error proxy: ${(err as Error).message}` })
    }
}
