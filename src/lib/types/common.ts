/**
 * Tipos de la API de Contifico v2
 * Docs: https://api.contifico.com/sistema/api/v2/documentacion/
 * Fallback v1: https://api.contifico.com/sistema/api/v1/documentacion/
 *
 * NOTA: Usamos v2 como base. Donde v2 no tiene endpoint (ej. variante),
 * se usa v1. Los campos "string <decimal>" de la API se tipan como
 * `string` ya que la API los devuelve como string numerico.
 */

// ─── Paginacion v2 ─────────────────────────────────────────

export interface ContificoPaginatedResponse<T> {
    count: number
    next: string | null
    previous: string | null
    results: T[]
}

// ─── Producto ───────────────────────────────────────────────

export interface ContificoProducto {
    id: string
    codigo: string
    nombre: string
    /** "SIM" simple | "COM" combo | "PRO" produccion | "COP" compuesto */
    tipo_producto: "SIM" | "COM" | "PRO" | "COP"
    /** "PRO" producto | "SER" servicio */
    tipo: "PRO" | "SER"
    /** "A" activo | "I" inactivo */
    estado: "A" | "I"
    unidad?: string | null
    categoria_id?: string | null
    codigo_auxiliar?: string | null
    codigo_barra?: string | null
    pvp_manual: boolean
    pvp1?: string | null
    pvp2?: string | null
    pvp3?: string | null
    pvp4?: string | null
    porcentaje_iva?: number | null
    minimo?: string | null
    para_pos?: boolean
    personalizado1?: string | null
    personalizado2?: string | null
    descripcion?: string | null
    generacion_automatica?: boolean
    fecha_creacion?: string
    costo_maximo?: string | null
    codigo_proveedor?: string | null
    lead_time?: number
    cantidad_stock?: string
    cuenta_venta_id?: string
    cuenta_compra_id?: string
    cuenta_costo_id?: string
    marca_id?: string | null
    marca_nombre?: string | null
    imagen?: string
    producto_base_id?: string | null
    nombre_producto_base?: string | null
    detalle_variantes?: Array<{
        variante_id: string
        valor_id: string | null
    }>
    /** Campos extras v2 */
    porcentaje_ice?: string | null
    valor_ice?: string | null
    campo_catalogo?: string | null
    maneja_nombremanual?: boolean
    porcentaje_servicio?: boolean
    id_integracion_proveedor?: string | null
    pvp_peso?: string | null
    peso_desde?: string | null
    peso_hasta?: string | null
}

export interface ContificoProductoCreate {
    codigo: string
    nombre: string
    pvp_manual: boolean
    pvp1?: string | null
    pvp2?: string | null
    pvp3?: string | null
    pvp4?: string | null
    categoria_id?: string
    porcentaje_iva?: number
    /** "A" activo | "I" inactivo */
    estado?: "A" | "I"
    /** "PRO" producto | "SER" servicio */
    tipo?: "PRO" | "SER"
    /** "SIM" simple | "COM" combo | "PRO" produccion | "COP" compuesto */
    tipo_producto?: "SIM" | "COM" | "PRO" | "COP"
    para_pos?: boolean
    unidad?: string
    codigo_auxiliar?: string
    codigo_barra?: string
    descripcion?: string
    minimo?: string
    personalizado1?: string
    personalizado2?: string
    generacion_automatica?: boolean
    codigo_proveedor?: string
}

// ─── Categoria ──────────────────────────────────────────────

/** Categoria v2 (simplificada) */
export interface ContificoCategoria {
    id: string
    nombre: string
    cuenta_venta?: number | null
}

/** Categoria v1 (mas completa, usamos para fallback) */
export interface ContificoCategoriaV1 {
    id: string
    nombre: string
    padre_id?: string | null
    agrupar?: boolean
    tipo_producto?: "PROD" | "SERV"
    cuenta_venta?: string
    cuenta_compra?: string
    cuenta_inventario?: string
}

// ─── Bodega ─────────────────────────────────────────────────

export interface ContificoBodega {
    id: string
    nombre: string
    codigo: string
    venta: boolean
    produccion: boolean
    compra: boolean
}

// ─── Stock ──────────────────────────────────────────────────

export interface ContificoStockBodega {
    bodega_id: string
    bodega_nombre: string
    cantidad: number
}

// ─── Variante (solo v1) ─────────────────────────────────────

export interface ContificoVarianteValor {
    id: string
    valor: string
}

export interface ContificoVariante {
    id: string
    nombre: string
    valores: ContificoVarianteValor[]
}

// ─── Persona ────────────────────────────────────────────────

export interface ContificoPersona {
    id: string
    /** "N" natural | "J" juridica | "I" identificacion | "P" pasaporte (v2) */
    tipo: "N" | "J" | "I" | "P"
    ruc?: string | null
    cedula?: string | null
    placa?: string | null
    razon_social: string
    nombre_comercial?: string | null
    email: string
    telefonos?: string | null
    direccion?: string | null
    es_cliente?: boolean
    es_proveedor?: boolean
    es_empleado?: boolean
    es_corporativo?: boolean
    es_vendedor?: boolean
    es_extranjero?: boolean
    aplicar_cupo?: string
    porcentaje_descuento?: string
    pvp_default?: string | null
    personaasociada_id?: string | null
    adicional1_cliente?: string
    adicional2_cliente?: string
    adicional3_cliente?: string
    adicional4_cliente?: string
    adicional1_proveedor?: string
    adicional2_proveedor?: string
    adicional3_proveedor?: string
    adicional4_proveedor?: string
    banco_codigo_id?: string | null
    tipo_cuenta?: string
    numero_tarjeta?: string
    categoria_id?: string
    categoria_nombre?: string
    /** v2: Objeto con id e id_integracion */
    cuenta_por_cobrar_id?: { id?: number; id_integracion?: string } | null
    cuenta_por_pagar_id?: { id?: number; id_integracion?: string } | null
    fecha_modificacion?: string | null
    sueldo?: string | null
    dias_credito?: string | null
    cupo_credito?: string | null
    vendedor_asignado?: { id: string; nombre: string } | null
}

export interface ContificoPersonaCreate {
    /** "N" natural | "J" juridica | "I" identificacion | "P" pasaporte */
    tipo: "N" | "J" | "I" | "P"
    razon_social: string
    email: string
    cedula?: string | null
    ruc?: string | null
    placa?: string | null
    nombre_comercial?: string | null
    telefonos?: string | null
    direccion?: string | null
    es_cliente?: boolean
    es_proveedor?: boolean
    es_empleado?: boolean
    es_corporativo?: boolean
    es_vendedor?: boolean
    es_extranjero?: boolean
    pvp_default?: string | null
    personaasociada_id?: string | null
    cuenta_por_cobrar_id?: { id_integracion: string } | null
    cuenta_por_pagar_id?: { id_integracion: string } | null
    sueldo?: string | null
    dias_credito?: string | null
    cupo_credito?: string | null
    vendedor_asignado?: { id: string; nombre: string } | null
}

// ─── Documento ──────────────────────────────────────────────

/**
 * Tipos de documento conocidos en Contifico.
 * FAC: Factura, PRE: Pre-factura, NC: Nota de Credito,
 * ND: Nota de Debito, GR: Guia de Remision, LQC: Liquidacion de Compra
 */
export type ContificoTipoDocumento = "PRE" | "FAC" | "NC" | "ND" | "GR" | "LQC"

/** Tipo de registro: CLI cliente | PRO proveedor */
export type ContificoTipoRegistro = "CLI" | "PRO"

/** Estado del documento: P Pendiente | C Cobrado | G Pagado | A Anulado | E Generado | F Facturado */
export type ContificoEstadoDocumento = "P" | "C" | "G" | "A" | "E" | "F"

/** Detalle de un documento (linea de producto) */
export interface ContificoDocumentoDetalle {
    producto_id: string
    cantidad: number | string
    precio: number | string
    porcentaje_iva: number
    porcentaje_descuento?: number | string
    porcentaje_ice?: number | string
    valor_ice?: number | string
    base_cero?: number | string
    base_gravable?: number | string
    base_no_gravable?: number | string
    descripcion?: string
    serie?: string | null
    /** Campos extras que puede retornar la API */
    producto_nombre?: string
    cuenta_id?: string | null
    centro_costo_id?: string | null
    color_id?: string | null
    formula?: unknown[]
    formula_asociada?: string | null
    nombre_manual?: string | null
    peso?: string | null
    volumen?: string | null
    adicional1?: string
    codigo_bien?: string | null
    personas_asociadas?: unknown | null
    ibpnr?: string
}

/** Cobro / pago asociado a un documento */
export interface ContificoCobro {
    id?: string
    forma_cobro: string
    monto: number | string
    fecha?: string | null
    caja_id?: string | null
    cuenta_bancaria_id?: string | null
    numero_comprobante?: string | null
    numero_cheque?: string | null
    numero_tarjeta?: string | null
    lote?: string | null
    tipo_ping?: string | null
    monto_propina?: string | null
    bin_tarjeta?: string | null
    nombre_tarjeta?: string | null
    tipo_banco?: string | null
    fecha_cheque?: string | null
    fecha_creacion?: string
}

/** Cobro simplificado para crear */
export interface ContificoCobroCreate {
    forma_cobro: string
    monto: number | string
    fecha?: string | null
    tipo_ping?: string | null
    numero_comprobante?: string | null
    numero_cheque?: string | null
    cuenta_bancaria_id?: string | null
    lote?: string | null
}

/** Cliente embebido en documento v2 (para crear) */
export interface ContificoDocumentoCliente {
    cedula: string
    razon_social: string
    telefonos?: string
    direccion?: string
    tipo: "N" | "J" | "I" | "P"
    email?: string
    es_extranjero?: boolean
}

/** Documento (respuesta de la API) */
export interface ContificoDocumento {
    id: string
    pos?: string
    persona_id?: string
    fecha_emision: string
    hora_emision?: string | null
    fecha_creacion?: string
    tipo_registro: ContificoTipoRegistro
    tipo_documento: string
    documento?: string | null
    electronico?: boolean
    autorizacion?: string | null
    estado?: string | null
    subtotal_12: string
    subtotal_0: string
    subtotal?: string
    iva: string
    ice?: string
    servicio?: string
    total: string
    saldo?: string
    saldo_anticipo?: string
    reserva_relacionada?: string | null
    descripcion?: string | null
    referencia?: string | null
    adicional1?: string | null
    adicional2?: string | null
    persona?: ContificoPersona
    cliente?: ContificoDocumentoCliente
    vendedor?: unknown | null
    vendedor_id?: string | null
    vendedor_identificacion?: string | null
    detalles: ContificoDocumentoDetalle[]
    cobros?: ContificoCobro[]
    cobros_read_only?: ContificoCobro[]
    documento_relacionado_id?: string | null
    tarjeta_consumo_id?: string | null
    url_ride?: string | null
    url_xml?: string | null
    firmado?: boolean
    entregado?: boolean
    anulado?: boolean
    caja_id?: string | null
    logistica?: string | null
    tipo_domicilio?: string | null
    orden_domicilio_id?: string | null
    tipo_descuento?: string | null
    placa?: string | null
    fecha_vencimiento?: string | null
    fecha_evento?: string | null
    hora_evento?: string | null
    direccion_evento?: string | null
    pax?: number | null
    /** Campos v2 extra */
    fecha_modificacion?: string
    autorizado_sri?: boolean
    enviado_sri?: boolean
    correo_enviado?: boolean
    retencion_autorizado_sri?: boolean
    retencion_firmado?: boolean
    retencion_enviado_sri?: boolean
    retencion_correo_enviado?: boolean
}

/**
 * Estructura para CREAR un documento via API v2.
 * NOTA: v2 usa `cliente` (array de objetos) en vez de `persona` al crear.
 * El campo `pos` es el API Token del POS (obligatorio).
 */
export interface ContificoDocumentoCreate {
    pos: string
    fecha_emision: string
    hora_emision?: string
    tipo_registro: ContificoTipoRegistro
    tipo_documento: string
    documento: string
    estado: string
    /** Objeto o string segun contexto (en v2 puede ser string) */
    electronico?: string | boolean
    autorizacion?: string | null
    referencia?: string
    reserva_relacionada?: string | null
    descripcion?: string
    adicional1?: string | null
    adicional2?: string | null
    /** v2: cliente como objeto JSON */
    cliente: ContificoDocumentoCliente
    detalles: ContificoDocumentoDetalleCreate[]
    cobros?: ContificoCobroCreate[]
    subtotal?: number
    subtotal_0: number
    subtotal_12: number
    iva: number
    ice: number
    servicio?: number
    total: number
    caja_id?: string | null
    documento_relacionado_id?: string | null
    fecha_vencimiento?: string
}

/** Detalle simplificado para crear documento */
export interface ContificoDocumentoDetalleCreate {
    producto_id: string
    cantidad: number
    precio: number
    porcentaje_iva: number
    base_cero?: number
    base_gravable?: number
    base_no_gravable?: number
    descripcion?: string
    serie?: string
    porcentaje_descuento?: number
}

/** Estado de documento electronico */
export interface ContificoDocumentoEstado {
    documento_id: string
    tipo_documento: string
    tipo_registro: string
    estado: string
}

/** Forma de pago de un documento (v2) */
export interface ContificoFormaPago {
    forma_pago: string
    plazo?: string | null
    unidad?: string | null
    valor?: string | null
}

// ─── Movimiento de inventario ───────────────────────────────

export interface ContificoMovimientoInventarioDetalle {
    cantidad: number
    producto_id: string
    precio?: number
    serie?: string | null
    edicion?: string | null
}

export interface ContificoMovimientoInventario {
    id: string
    pos?: string
    bodega_id: string
    codigo?: string
    codigo_interno?: string | null
    fecha: string
    /** "ING" ingreso | "EGR" egreso | "TRA" traslado | "AJU" ajuste costo */
    tipo: "ING" | "EGR" | "TRA" | "AJU"
    descripcion: string
    total?: string | number
    detalles: ContificoMovimientoInventarioDetalle[]
    /** "P" pendiente | "G" generado */
    estado: "P" | "G"
    bodega_destino_id?: string | null
    maneja_venta?: string | null
    generar_asiento?: boolean | string
}

// ─── Error ──────────────────────────────────────────────────

export interface ContificoErrorResponse {
    /** v1 puede devolver un mensaje string plano o un objeto */
    mensaje?: string
    error?: string
    detail?: string
    /** Los errores de campo vienen como { campo: ["mensaje"] } */
    [key: string]: unknown
}
