import { Badge, Button, Heading, Table, Text } from "@medusajs/ui"
import { Fragment, useMemo, useState } from "react"
import type { SyncLog, SyncLogDetails, SyncLogErrorEntry } from "../types"

interface SyncLogsTableProps {
    syncLogs: SyncLog[]
}

interface ParsedSyncLogError {
    label: string | null
    error: string
}

function getStatusColor(status: string) {
    return status === "success"
        ? "green"
        : status === "queued" || status === "running"
          ? "blue"
        : status === "partial"
          ? "orange"
          : "red"
}

function parseSyncLogErrors(details?: SyncLogDetails | null): ParsedSyncLogError[] {
    const entries = [
        ...(Array.isArray(details?.errors) ? details.errors : []),
        ...(Array.isArray(details?.error_details) ? details.error_details : []),
    ]
    const parsed = entries
        .map(normalizeSyncLogError)
        .filter((entry): entry is ParsedSyncLogError => !!entry)

    if (parsed.length > 0) {
        return parsed
    }

    return details?.fatal
        ? [
              {
                  label: "Fatal",
                  error: details.fatal,
              },
          ]
        : []
}

function normalizeSyncLogError(
    value: string | SyncLogErrorEntry
): ParsedSyncLogError | null {
    if (typeof value === "string") {
        return { label: null, error: value }
    }

    if (!value || typeof value.error !== "string" || value.error.length === 0) {
        return null
    }

    return {
        label:
            value.producto ||
            value.persona ||
            value.id ||
            value.variant_id ||
            null,
        error: value.error,
    }
}

export function SyncLogsTable({ syncLogs }: SyncLogsTableProps) {
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null)
    const parsedErrorsById = useMemo(
        () =>
            new Map(
                syncLogs.map((log) => [log.id, parseSyncLogErrors(log.details)])
            ),
        [syncLogs]
    )

    if (syncLogs.length === 0) {
        return null
    }

    return (
        <div className="p-6 border rounded-lg border-ui-border-base">
            <Heading level="h2" className="mb-4">
                Historial de Sincronizaciones
            </Heading>
            <Table>
                <Table.Header>
                    <Table.Row>
                        <Table.HeaderCell>Tipo</Table.HeaderCell>
                        <Table.HeaderCell>Estado</Table.HeaderCell>
                        <Table.HeaderCell>Fase</Table.HeaderCell>
                        <Table.HeaderCell>Procesados</Table.HeaderCell>
                        <Table.HeaderCell>Errores</Table.HeaderCell>
                        <Table.HeaderCell>Duracion</Table.HeaderCell>
                        <Table.HeaderCell>Fecha</Table.HeaderCell>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {syncLogs.map((log) => {
                        const parsedErrors = parsedErrorsById.get(log.id) || []
                        const canExpand = parsedErrors.length > 0
                        const isExpanded = expandedLogId === log.id

                        return (
                            <Fragment key={log.id}>
                                <Table.Row>
                                    <Table.Cell>
                                        <Badge>{log.sync_type}</Badge>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <Badge color={getStatusColor(log.status)}>
                                            {log.status}
                                        </Badge>
                                    </Table.Cell>
                                    <Table.Cell>{log.phase || "—"}</Table.Cell>
                                    <Table.Cell>{log.total_processed}</Table.Cell>
                                    <Table.Cell>
                                        {canExpand ? (
                                            <Button
                                                variant="transparent"
                                                size="small"
                                                className="h-auto p-0 text-ui-fg-interactive"
                                                onClick={() =>
                                                    setExpandedLogId((current) =>
                                                        current === log.id
                                                            ? null
                                                            : log.id
                                                    )
                                                }
                                            >
                                                {log.total_errors}
                                            </Button>
                                        ) : (
                                            log.total_errors
                                        )}
                                    </Table.Cell>
                                    <Table.Cell>
                                        {(log.duration_ms / 1000).toFixed(1)}s
                                    </Table.Cell>
                                    <Table.Cell>
                                        <Text>
                                            {new Date(
                                                log.created_at
                                            ).toLocaleString()}
                                        </Text>
                                    </Table.Cell>
                                </Table.Row>
                                        {isExpanded && (
                                    <Table.Row>
                                        <Table.Cell colSpan={7}>
                                            <div className="space-y-3 py-2">
                                                {log.details?.correlation_id ? (
                                                    <Text className="text-ui-fg-subtle text-xs">
                                                        Correlation ID:{" "}
                                                        {log.details.correlation_id}
                                                    </Text>
                                                ) : null}
                                                {log.parent_log_id ? (
                                                    <Text className="text-ui-fg-subtle text-xs">
                                                        Parent Log ID: {log.parent_log_id}
                                                    </Text>
                                                ) : null}
                                                <div className="space-y-2">
                                                    {parsedErrors.map(
                                                        (entry, index) => (
                                                            <div
                                                                key={`${log.id}-${index}`}
                                                                className="rounded-md border border-ui-border-base p-3"
                                                            >
                                                                {entry.label ? (
                                                                    <Text
                                                                        weight="plus"
                                                                        className="text-sm mb-1"
                                                                    >
                                                                        {
                                                                            entry.label
                                                                        }
                                                                    </Text>
                                                                ) : null}
                                                                <Text className="text-sm">
                                                                    {
                                                                        entry.error
                                                                    }
                                                                </Text>
                                                            </div>
                                                        )
                                                    )}
                                                </div>
                                            </div>
                                        </Table.Cell>
                                    </Table.Row>
                                )}
                            </Fragment>
                        )
                    })}
                </Table.Body>
            </Table>
        </div>
    )
}
