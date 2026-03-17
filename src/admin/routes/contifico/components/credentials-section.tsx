import {
    Badge,
    Button,
    Checkbox,
    Container,
    Heading,
    Input,
    Label,
    Text,
} from "@medusajs/ui"
import type { ContificoSettingsController } from "../state"

export function CredentialsSection({
    controller,
}: {
    controller: ContificoSettingsController
}) {
    const {
        apiKey,
        apiPos,
        bodegas,
        bodegaIds,
        isLoadingBodegas,
        setApiKey,
        setApiPos,
        setBodegaIds,
    } = controller

    return (
        <>
            <Container className="mb-6 p-6">
                <Heading level="h2" className="mb-4">
                    Credenciales API
                </Heading>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="api_key">API Key *</Label>
                        <Input
                            id="api_key"
                            type="password"
                            placeholder="Tu API Key de Contifico"
                            value={apiKey}
                            onChange={(event) => setApiKey(event.target.value)}
                        />
                    </div>
                    <div>
                        <Label htmlFor="api_pos">
                            API POS{" "}
                            <span className="text-ui-fg-subtle">(para facturacion)</span>
                        </Label>
                        <Input
                            id="api_pos"
                            placeholder="Codigo POS para documentos"
                            value={apiPos}
                            onChange={(event) => setApiPos(event.target.value)}
                        />
                    </div>
                </div>
            </Container>

            <Container className="mb-6 p-6">
                <Heading level="h2" className="mb-4">
                    Bodegas para Stock
                </Heading>
                <Text className="text-ui-fg-subtle text-sm mb-4">
                    Selecciona las bodegas de las que se sumara el stock disponible para
                    la tienda web.
                </Text>
                <div className="max-w-md">
                    {isLoadingBodegas ? (
                        <Text className="text-ui-fg-subtle">Cargando bodegas...</Text>
                    ) : bodegas.length > 0 ? (
                        <div className="space-y-3">
                            <div className="mb-2 flex items-center gap-2">
                                <Button
                                    variant="secondary"
                                    size="small"
                                    onClick={() => setBodegaIds(bodegas.map((bodega) => bodega.id))}
                                >
                                    Todas
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="small"
                                    onClick={() => setBodegaIds([])}
                                >
                                    Ninguna
                                </Button>
                                <Badge color={bodegaIds.length > 0 ? "green" : "grey"}>
                                    {bodegaIds.length} de {bodegas.length}
                                </Badge>
                            </div>
                            {bodegas.map((bodega) => (
                                <label
                                    key={bodega.id}
                                    className="flex cursor-pointer items-center gap-3 rounded p-2 hover:bg-ui-bg-base-hover"
                                >
                                    <Checkbox
                                        checked={bodegaIds.includes(bodega.id)}
                                        onCheckedChange={(checked) => {
                                            if (checked) {
                                                setBodegaIds((current) => [...current, bodega.id])
                                                return
                                            }

                                            setBodegaIds((current) =>
                                                current.filter((id) => id !== bodega.id)
                                            )
                                        }}
                                    />
                                    <Text weight="plus">{bodega.nombre}</Text>
                                </label>
                            ))}
                        </div>
                    ) : (
                        <Text className="text-ui-fg-subtle">
                            {apiKey
                                ? "No se encontraron bodegas. Verifica la conexion."
                                : "Ingresa la API Key primero."}
                        </Text>
                    )}
                </div>
            </Container>
        </>
    )
}
