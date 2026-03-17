/**
 * Facade backward-compatible del ContificoClient.
 *
 * Compone los domain clients (products, invoices, customers, inventory)
 * en una única interfaz para que los consumidores existentes no necesiten cambios.
 *
 * Para código nuevo, preferir inyectar el sub-client específico.
 */

export { ContificoBaseClient, type ClientOptions, type RequestOptions } from "./base"
export { ContificoProductsClient } from "./products"
export { ContificoInvoicesClient } from "./invoices"
export { ContificoCustomersClient } from "./customers"
export { ContificoInventoryClient } from "./inventory"

import type { ClientOptions } from "./base"
import { ContificoProductsClient } from "./products"
import { ContificoInvoicesClient } from "./invoices"
import { ContificoCustomersClient } from "./customers"
import { ContificoInventoryClient } from "./inventory"

/**
 * Cliente unificado que delega a sub-clientes por dominio.
 * Mantiene la misma API pública que el `ContificoClient` original.
 */
export class ContificoClient {
    readonly products: ContificoProductsClient
    readonly invoices: ContificoInvoicesClient
    readonly customers: ContificoCustomersClient
    readonly inventory: ContificoInventoryClient

    constructor(options: ClientOptions) {
        this.products = new ContificoProductsClient(options)
        this.invoices = new ContificoInvoicesClient(options)
        this.customers = new ContificoCustomersClient(options)
        this.inventory = new ContificoInventoryClient(options)
    }

    // ── Delegaciones backward-compatible ─────────────────────
    // Productos
    getProductos = (...a: Parameters<ContificoProductsClient["getProductos"]>) => this.products.getProductos(...a)
    getAllProductos = (...a: Parameters<ContificoProductsClient["getAllProductos"]>) => this.products.getAllProductos(...a)
    getProducto = (...a: Parameters<ContificoProductsClient["getProducto"]>) => this.products.getProducto(...a)
    getProductoPorCodigo = (...a: Parameters<ContificoProductsClient["getProductoPorCodigo"]>) => this.products.getProductoPorCodigo(...a)
    createProducto = (...a: Parameters<ContificoProductsClient["createProducto"]>) => this.products.createProducto(...a)
    updateProducto = (...a: Parameters<ContificoProductsClient["updateProducto"]>) => this.products.updateProducto(...a)
    getCategorias = (...a: Parameters<ContificoProductsClient["getCategorias"]>) => this.products.getCategorias(...a)
    getAllCategorias = (...a: Parameters<ContificoProductsClient["getAllCategorias"]>) => this.products.getAllCategorias(...a)
    getCategoriasV1 = (...a: Parameters<ContificoProductsClient["getCategoriasV1"]>) => this.products.getCategoriasV1(...a)
    getCategoria = (...a: Parameters<ContificoProductsClient["getCategoria"]>) => this.products.getCategoria(...a)
    getVariantes = (...a: Parameters<ContificoProductsClient["getVariantes"]>) => this.products.getVariantes(...a)
    getVarianteById = (...a: Parameters<ContificoProductsClient["getVarianteById"]>) => this.products.getVarianteById(...a)

    // Documentos / Facturas
    getDocumentos = (...a: Parameters<ContificoInvoicesClient["getDocumentos"]>) => this.invoices.getDocumentos(...a)
    getAllDocumentos = (...a: Parameters<ContificoInvoicesClient["getAllDocumentos"]>) => this.invoices.getAllDocumentos(...a)
    getDocumento = (...a: Parameters<ContificoInvoicesClient["getDocumento"]>) => this.invoices.getDocumento(...a)
    createDocumento = (...a: Parameters<ContificoInvoicesClient["createDocumento"]>) => this.invoices.createDocumento(...a)
    updateDocumento = (...a: Parameters<ContificoInvoicesClient["updateDocumento"]>) => this.invoices.updateDocumento(...a)
    anularDocumento = (...a: Parameters<ContificoInvoicesClient["anularDocumento"]>) => this.invoices.anularDocumento(...a)
    getDocumentoEstado = (...a: Parameters<ContificoInvoicesClient["getDocumentoEstado"]>) => this.invoices.getDocumentoEstado(...a)
    getCobros = (...a: Parameters<ContificoInvoicesClient["getCobros"]>) => this.invoices.getCobros(...a)
    createCobro = (...a: Parameters<ContificoInvoicesClient["createCobro"]>) => this.invoices.createCobro(...a)
    getFormasPago = (...a: Parameters<ContificoInvoicesClient["getFormasPago"]>) => this.invoices.getFormasPago(...a)

    // Personas / Clientes
    getPersonas = (...a: Parameters<ContificoCustomersClient["getPersonas"]>) => this.customers.getPersonas(...a)
    getAllPersonas = (...a: Parameters<ContificoCustomersClient["getAllPersonas"]>) => this.customers.getAllPersonas(...a)
    getPersona = (...a: Parameters<ContificoCustomersClient["getPersona"]>) => this.customers.getPersona(...a)
    getPersonaPorIdentificacion = (...a: Parameters<ContificoCustomersClient["getPersonaPorIdentificacion"]>) => this.customers.getPersonaPorIdentificacion(...a)
    buscarPersona = (...a: Parameters<ContificoCustomersClient["buscarPersona"]>) => this.customers.buscarPersona(...a)
    createPersona = (...a: Parameters<ContificoCustomersClient["createPersona"]>) => this.customers.createPersona(...a)
    updatePersona = (...a: Parameters<ContificoCustomersClient["updatePersona"]>) => this.customers.updatePersona(...a)

    // Inventario / Bodegas
    getBodegas = (...a: Parameters<ContificoInventoryClient["getBodegas"]>) => this.inventory.getBodegas(...a)
    getAllBodegas = (...a: Parameters<ContificoInventoryClient["getAllBodegas"]>) => this.inventory.getAllBodegas(...a)
    getStock = (...a: Parameters<ContificoInventoryClient["getStock"]>) => this.inventory.getStock(...a)
    getStockAll = (...a: Parameters<ContificoInventoryClient["getStockAll"]>) => this.inventory.getStockAll(...a)
    getMovimientos = (...a: Parameters<ContificoInventoryClient["getMovimientos"]>) => this.inventory.getMovimientos(...a)

    // ── Utilidades ───────────────────────────────────────────

    async testConnection(): Promise<{ ok: boolean; bodegas: number }> {
        const res = await this.inventory.getBodegas()
        return { ok: true, bodegas: res.count }
    }
}
