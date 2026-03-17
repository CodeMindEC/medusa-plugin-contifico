import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const ALLOWED_HOSTS = ["api.contifico.com", "contifico.com"]
const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10 MB
const FETCH_TIMEOUT_MS = 10_000 // 10s

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

    // Validar URL y restringir dominio (prevenir SSRF)
    let parsedUrl: URL
    try {
        parsedUrl = new URL(url)
    } catch {
        res.status(400).json({ error: "URL inválida" })
        return
    }

    if (!ALLOWED_HOSTS.some((h) => parsedUrl.hostname === h || parsedUrl.hostname.endsWith(`.${h}`))) {
        res.status(403).json({ error: "Dominio no permitido" })
        return
    }

    try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

        let resp: Response
        try {
            resp = await fetch(url, { redirect: "follow", signal: controller.signal })
        } finally {
            clearTimeout(timer)
        }

        if (!resp.ok) {
            res.status(resp.status).json({ error: `Error descargando imagen: ${resp.status}` })
            return
        }

        // Verificar tamaño antes de descargar el body completo
        const contentLength = Number(resp.headers.get("content-length") || "0")
        if (contentLength > MAX_IMAGE_SIZE) {
            res.status(413).json({ error: "Imagen demasiado grande" })
            return
        }

        const buffer = Buffer.from(await resp.arrayBuffer())

        if (buffer.length > MAX_IMAGE_SIZE) {
            res.status(413).json({ error: "Imagen demasiado grande" })
            return
        }

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
        const message = (err as Error).name === "AbortError"
            ? "Timeout descargando imagen"
            : `Error proxy: ${(err as Error).message}`
        res.status(500).json({ error: message })
    }
}
