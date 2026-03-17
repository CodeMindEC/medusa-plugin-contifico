import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Text, Toaster } from "@medusajs/ui"
import { AdvancedFiltersSection } from "./components/advanced-filters-section"
import { CredentialsSection } from "./components/credentials-section"
import { InvoicesSection } from "./components/invoices-section"
import { ProductOptionsSection } from "./components/product-options-section"
import { SyncSection } from "./components/sync-section"
import { useContificoSettingsController } from "./state"

const ContificoSettingsPage = () => {
    const controller = useContificoSettingsController()

    if (controller.isLoading) {
        return (
            <Container className="p-8">
                <Text>Cargando configuracion...</Text>
            </Container>
        )
    }

    return (
        <>
            <Toaster />
            <Container className="p-8">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <Heading level="h1">Contifico</Heading>
                        <Text className="mt-1 text-ui-fg-subtle">
                            Configuracion de la integracion con Contifico ERP
                        </Text>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="secondary"
                            onClick={controller.handleTestConnection}
                            disabled={!controller.apiKey || controller.isTesting}
                            isLoading={controller.isTesting}
                        >
                            Probar Conexion
                        </Button>
                        <Button
                            onClick={controller.handleSave}
                            disabled={!controller.apiKey || controller.isSaving}
                            isLoading={controller.isSaving}
                        >
                            Guardar
                        </Button>
                    </div>
                </div>

                <CredentialsSection controller={controller} />
                <ProductOptionsSection controller={controller} />
                <AdvancedFiltersSection controller={controller} />
                <InvoicesSection controller={controller} />
                <SyncSection controller={controller} />
            </Container>
        </>
    )
}

export const config = defineRouteConfig({
    label: "Contifico",
})

export default ContificoSettingsPage
