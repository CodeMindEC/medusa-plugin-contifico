/**
 * Re-export desde la nueva estructura modular.
 * Mantiene backward compatibility: `import { ContificoClient } from "../client"` sigue funcionando.
 */
export {
    ContificoClient,
    ContificoBaseClient,
    ContificoProductsClient,
    ContificoInvoicesClient,
    ContificoCustomersClient,
    ContificoInventoryClient,
    type ClientOptions,
    type RequestOptions,
} from "./client/index"
