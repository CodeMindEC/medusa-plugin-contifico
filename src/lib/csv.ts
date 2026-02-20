/** Convierte array de IDs a CSV para almacenar en DB */
export const toCSV = (ids?: string[]) =>
    ids && ids.length > 0 ? ids.join(",") : null

/** Convierte CSV almacenado a array de IDs */
export const fromCSV = (csv: string | null | undefined): string[] =>
    csv ? csv.split(",").filter(Boolean) : []
