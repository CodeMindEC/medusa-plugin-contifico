import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "./route"

// ── Mock helpers ──

function createMockReq(query: Record<string, string> = {}) {
    return { query } as any
}

function createMockRes() {
    const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        setHeader: vi.fn().mockReturnThis(),
        end: vi.fn(),
    }
    return res
}

// PNG magic bytes (89 50 4E 47) followed by enough padding to be > 100 bytes
function makePngBuffer(size = 200): Buffer {
    const buf = Buffer.alloc(size)
    buf[0] = 0x89
    buf[1] = 0x50
    buf[2] = 0x4e
    buf[3] = 0x47
    return buf
}

// JPEG magic bytes
function makeJpegBuffer(size = 200): Buffer {
    const buf = Buffer.alloc(size)
    buf[0] = 0xff
    buf[1] = 0xd8
    return buf
}

describe("GET /admin/contifico/media", () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    it("returns 400 when url parameter is missing", async () => {
        const req = createMockReq({})
        const res = createMockRes()
        await GET(req, res)
        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith({ error: "Parámetro 'url' requerido" })
    })

    it("returns 400 for malformed URL", async () => {
        const req = createMockReq({ url: "not-a-url" })
        const res = createMockRes()
        await GET(req, res)
        expect(res.status).toHaveBeenCalledWith(400)
        expect(res.json).toHaveBeenCalledWith({ error: "URL inválida" })
    })

    it("returns 403 for non-allowed domain", async () => {
        const req = createMockReq({ url: "https://evil.com/image.png" })
        const res = createMockRes()
        await GET(req, res)
        expect(res.status).toHaveBeenCalledWith(403)
        expect(res.json).toHaveBeenCalledWith({ error: "Dominio no permitido" })
    })

    it("returns 403 for domain that partially matches", async () => {
        const req = createMockReq({ url: "https://notcontifico.com/image.png" })
        const res = createMockRes()
        await GET(req, res)
        expect(res.status).toHaveBeenCalledWith(403)
    })

    it("proxies valid Contifico image as PNG", async () => {
        const pngBuf = makePngBuffer()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ "content-length": String(pngBuf.length) }),
            arrayBuffer: () => Promise.resolve(pngBuf.buffer.slice(pngBuf.byteOffset, pngBuf.byteOffset + pngBuf.byteLength)),
        }))

        const req = createMockReq({ url: "https://api.contifico.com/images/123.png" })
        const res = createMockRes()
        await GET(req, res)

        expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/png")
        expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "public, max-age=86400")
        expect(res.setHeader).toHaveBeenCalledWith("Content-Disposition", "inline")
        expect(res.end).toHaveBeenCalledWith(expect.any(Buffer))
    })

    it("detects JPEG by magic bytes", async () => {
        const jpegBuf = makeJpegBuffer()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ "content-length": String(jpegBuf.length) }),
            arrayBuffer: () => Promise.resolve(jpegBuf.buffer.slice(jpegBuf.byteOffset, jpegBuf.byteOffset + jpegBuf.byteLength)),
        }))

        const req = createMockReq({ url: "https://contifico.com/img/pic.jpg" })
        const res = createMockRes()
        await GET(req, res)

        expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/jpeg")
    })

    it("allows subdomain of contifico.com", async () => {
        const buf = makePngBuffer()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ "content-length": String(buf.length) }),
            arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
        }))

        const req = createMockReq({ url: "https://cdn.contifico.com/images/abc.png" })
        const res = createMockRes()
        await GET(req, res)

        expect(res.end).toHaveBeenCalled()
        expect(res.status).not.toHaveBeenCalledWith(403)
    })

    it("returns 404 for empty image (< 100 bytes)", async () => {
        const tinyBuf = Buffer.alloc(50)
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ "content-length": "50" }),
            arrayBuffer: () => Promise.resolve(tinyBuf.buffer.slice(tinyBuf.byteOffset, tinyBuf.byteOffset + tinyBuf.byteLength)),
        }))

        const req = createMockReq({ url: "https://api.contifico.com/images/empty.png" })
        const res = createMockRes()
        await GET(req, res)

        expect(res.status).toHaveBeenCalledWith(404)
        expect(res.json).toHaveBeenCalledWith({ error: "Imagen vacía" })
    })

    it("returns 413 when content-length exceeds limit", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ "content-length": String(11 * 1024 * 1024) }),
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        }))

        const req = createMockReq({ url: "https://api.contifico.com/images/huge.png" })
        const res = createMockRes()
        await GET(req, res)

        expect(res.status).toHaveBeenCalledWith(413)
    })

    it("returns upstream error status when fetch fails", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: false,
            status: 502,
            headers: new Headers(),
        }))

        const req = createMockReq({ url: "https://api.contifico.com/images/fail.png" })
        const res = createMockRes()
        await GET(req, res)

        expect(res.status).toHaveBeenCalledWith(502)
    })

    it("returns 500 on network error", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network fail")))

        const req = createMockReq({ url: "https://api.contifico.com/images/err.png" })
        const res = createMockRes()
        await GET(req, res)

        expect(res.status).toHaveBeenCalledWith(500)
        expect(res.json).toHaveBeenCalledWith({ error: "Error proxy: network fail" })
    })

    it("returns 500 with timeout message on AbortError", async () => {
        const abortError = new DOMException("signal timed out", "AbortError")
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError))

        const req = createMockReq({ url: "https://api.contifico.com/images/slow.png" })
        const res = createMockRes()
        await GET(req, res)

        expect(res.status).toHaveBeenCalledWith(500)
        expect(res.json).toHaveBeenCalledWith({ error: "Timeout descargando imagen" })
    })
})
