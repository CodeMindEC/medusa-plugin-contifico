import { toast } from "@medusajs/ui"
import { useCallback, useMemo, useState } from "react"
import type { VariantMode, WeightedPvpField } from "../../../lib/contifico-config"
import { normalizeAdvancedSettings } from "../../../lib/advanced-settings"
import { parseJsonResponse, getErrorDescription, isInvoicePreviewType } from "./controller-helpers"
import type {
    Bodega,
    ContificoConfigData,
    ImportFilterRuleData,
    InvoiceEntry,
    ProgressState,
    SyncLog,
} from "./types"
import {
    getDerivedWeightedSettings,
    parseControllerAdvancedSettings,
    resolveControllerGates,
} from "./state-derived"
import {
    getWeightedCreationProfileOptions,
    INVOICE_STATUS_FILTER_OPTIONS,
    INVOICE_TYPE_FILTER_OPTIONS,
    INVOICE_TYPE_OPTIONS,
    MAPPING_MODE_OPTIONS,
    mapNamedOptions,
    WEIGHTED_CREATION_MODE_OPTIONS,
    WEIGHTED_PRICE_STRATEGY_OPTIONS,
    WEIGHTED_PVP_OPTIONS,
} from "./state-options"
import { createLoadErrorReporter, useAdminData } from "./use-admin-data"
import { useRuntimeActions } from "./use-runtime-actions"
import { useWeightedSettingsActions } from "./use-weighted-settings-actions"

export function useContificoSettingsController() {
    const [config, setConfig] = useState<ContificoConfigData | null>(null)
    const [bodegas, setBodegas] = useState<Bodega[]>([])
    const [syncLogs, setSyncLogs] = useState<SyncLog[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [isTesting, setIsTesting] = useState(false)
    const [isLoadingBodegas, setIsLoadingBodegas] = useState(false)
    const [isSyncingProducts, setIsSyncingProducts] = useState(false)
    const [isSyncingStock, setIsSyncingStock] = useState(false)
    const [isSyncingCustomers, setIsSyncingCustomers] = useState(false)
    const [isDeletingProducts, setIsDeletingProducts] = useState(false)
    const [syncProgress, setSyncProgress] = useState<ProgressState | null>(null)
    const [deleteProgress, setDeleteProgress] = useState<ProgressState | null>(null)
    const [invoiceTestMode, setInvoiceTestMode] = useState(false)
    const [invoices, setInvoices] = useState<InvoiceEntry[]>([])
    const [isCreatingTestPRE, setIsCreatingTestPRE] = useState(false)
    const [isCreatingTestFAC, setIsCreatingTestFAC] = useState(false)
    const [isDeletingTestDocs, setIsDeletingTestDocs] = useState(false)
    const [isTableOpen, setIsTableOpen] = useState(false)
    const [filterStatus, setFilterStatus] = useState("ALL")
    const [filterType, setFilterType] = useState("ALL")
    const [filterDateStr, setFilterDateStr] = useState("")
    const [apiKey, setApiKey] = useState("")
    const [apiPos, setApiPos] = useState("")
    const [bodegaIds, setBodegaIds] = useState<string[]>([])
    const [syncProducts, setSyncProducts] = useState(false)
    const [syncCustomers, setSyncCustomers] = useState(false)
    const [autoInvoice, setAutoInvoice] = useState(false)
    const [autoPreinvoice, setAutoPreinvoice] = useState(false)
    const [syncInterval, setSyncInterval] = useState(60)
    const [manageInventory, setManageInventory] = useState(false)
    const [allowBackorder, setAllowBackorder] = useState(false)
    const [salesChannelId, setSalesChannelId] = useState("")
    const [shippingProfileId, setShippingProfileId] = useState("")
    const [variantMode, setVariantModeState] = useState<VariantMode>("auto")
    const [weightedPvpField, setWeightedPvpField] =
        useState<WeightedPvpField>("pvp1")
    const [advancedSettingsJson, setAdvancedSettingsJson] = useState("")
    const [salesChannels, setSalesChannels] = useState<
        Array<{ id: string; name: string }>
    >([])
    const [shippingProfiles, setShippingProfiles] = useState<
        Array<{ id: string; name: string; type: string }>
    >([])
    const [syncPreview, setSyncPreview] = useState<string | null>(null)
    const [deletePreview, setDeletePreview] = useState<string | null>(null)
    const [invoicePreview, setInvoicePreview] = useState<string | null>(null)
    const [isPreviewingSync, setIsPreviewingSync] = useState(false)
    const [isPreviewingDelete, setIsPreviewingDelete] = useState(false)
    const [isPreviewingInvoice, setIsPreviewingInvoice] = useState(false)
    const [invoicePreviewOrderId, setInvoicePreviewOrderId] = useState("")
    const [invoicePreviewType, setInvoicePreviewTypeState] =
        useState<"PRE" | "FAC">("FAC")
    const [filterMode, setFilterMode] = useState<"and" | "or">("and")
    const [filterRules, setFilterRules] = useState<ImportFilterRuleData[]>([])

    const parsedAdvancedSettings = useMemo(() => {
        return parseControllerAdvancedSettings(advancedSettingsJson)
    }, [advancedSettingsJson])

    const {
        weightedCreationMode,
        weightedCreationProfiles,
        weightedDefaultProfileId,
        weightedFallbackField,
        weightedPriceStrategy,
        weightedPvpRules,
    } = useMemo(
        () =>
            getDerivedWeightedSettings(
                parsedAdvancedSettings,
                weightedPvpField
            ),
        [parsedAdvancedSettings, weightedPvpField]
    )
    const salesChannelOptions = useMemo(
        () => mapNamedOptions(salesChannels),
        [salesChannels]
    )
    const shippingProfileOptions = useMemo(
        () => mapNamedOptions(shippingProfiles),
        [shippingProfiles]
    )
    const weightedCreationProfileOptions = useMemo(
        () => getWeightedCreationProfileOptions(weightedCreationProfiles),
        [weightedCreationProfiles]
    )

    const configUiContext = useMemo(
        () => ({
            api_key: apiKey,
            api_pos: apiPos,
            sync_products_enabled: syncProducts,
            sync_customers_enabled: syncCustomers,
            auto_invoice_enabled: autoInvoice,
            auto_preinvoice_enabled: autoPreinvoice,
            variant_mode: variantMode,
            advanced_settings: parsedAdvancedSettings,
        }),
        [
            apiKey,
            apiPos,
            autoInvoice,
            autoPreinvoice,
            parsedAdvancedSettings,
            syncCustomers,
            syncProducts,
            variantMode,
        ]
    )

    const reportLoadError = useMemo(() => createLoadErrorReporter(), [])

    const handleVariantModeChange = useCallback(
        (value: VariantMode) => {
            setVariantModeState(value)

            if (!parsedAdvancedSettings) {
                return
            }

            setAdvancedSettingsJson(
                JSON.stringify(
                    normalizeAdvancedSettings({
                        ...parsedAdvancedSettings,
                        weighted: {
                            ...parsedAdvancedSettings.weighted,
                            enabled: value === "weighted",
                        },
                    }),
                    null,
                    2
                )
            )
        },
        [parsedAdvancedSettings, setAdvancedSettingsJson]
    )

    const {
        autoInvoiceGate,
        deleteImportedProductsGate,
        productSyncActionsGate,
        syncIntervalGate,
        weightedCreationModeGate,
        weightedCreationProfilesGate,
        weightedFixedFieldGate,
        weightedPriceLockGate,
        weightedRulesGate,
        weightedStrategyGate,
    } = useMemo(
        () => resolveControllerGates(configUiContext),
        [configUiContext]
    )

    const { fetchBodegas, fetchInvoices, fetchSyncLogs } = useAdminData({
        apiKey,
        configApiKey: config?.api_key,
        isTableOpen,
        parsedAdvancedSettings,
        reportLoadError,
        setAdvancedSettingsJson,
        setAllowBackorder,
        setApiKey,
        setApiPos,
        setAutoInvoice,
        setAutoPreinvoice,
        setBodegaIds,
        setBodegas,
        setConfig,
        setFilterMode,
        setFilterRules,
        setInvoiceTestMode,
        setInvoices,
        setIsLoading,
        setIsLoadingBodegas,
        setManageInventory,
        setSalesChannelId,
        setSalesChannels,
        setShippingProfileId,
        setShippingProfiles,
        setSyncCustomers,
        setSyncInterval,
        setSyncLogs,
        setSyncProducts,
        setVariantMode: setVariantModeState,
        setWeightedPvpField,
    })

    const handleSave = useCallback(async () => {
        setIsSaving(true)
        try {
            if (!parsedAdvancedSettings) {
                toast.error("Configuración avanzada inválida", {
                    description: "Revisa el JSON antes de guardar.",
                })
                return
            }

            const response = await fetch("/admin/contifico/config", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    api_key: apiKey,
                    api_pos: apiPos || null,
                    bodega_ids: bodegaIds,
                    sync_products_enabled: syncProducts,
                    sync_customers_enabled: syncCustomers,
                    auto_invoice_enabled: autoInvoice,
                    auto_preinvoice_enabled: autoPreinvoice,
                    sync_interval_minutes: syncInterval,
                    manage_inventory: manageInventory,
                    allow_backorder: allowBackorder,
                    sales_channel_id: salesChannelId || null,
                    shipping_profile_id: shippingProfileId || null,
                    variant_mode: variantMode,
                    weighted_pvp_field: weightedPvpField,
                    advanced_settings: parsedAdvancedSettings,
                    invoice_test_mode: invoiceTestMode,
                    import_filters:
                        filterRules.length > 0
                            ? { mode: filterMode, rules: filterRules }
                            : null,
                }),
            })

            if (!response.ok) {
                const errorData = await parseJsonResponse<{
                    error?: { formErrors?: string[] } | string
                }>(response)
                toast.error("Error", {
                    description:
                        typeof errorData.error === "object"
                            ? errorData.error?.formErrors?.join(", ") ||
                              "Error guardando"
                            : errorData.error || "Error guardando",
                })
                return
            }

            const data = await parseJsonResponse<{ config: ContificoConfigData }>(
                response
            )
            setConfig(data.config)
            toast.success("Guardado", {
                description: "Configuracion de Contifico actualizada",
            })
            fetchBodegas()
        } catch (error) {
            toast.error("Error", {
                description: getErrorDescription(error),
            })
        } finally {
            setIsSaving(false)
        }
    }, [
        allowBackorder,
        apiKey,
        apiPos,
        autoInvoice,
        autoPreinvoice,
        bodegaIds,
        fetchBodegas,
        filterMode,
        filterRules,
        invoiceTestMode,
        manageInventory,
        parsedAdvancedSettings,
        salesChannelId,
        shippingProfileId,
        syncCustomers,
        syncInterval,
        syncProducts,
        variantMode,
        weightedPvpField,
    ])

    const weightedActions = useWeightedSettingsActions({
        parsedAdvancedSettings,
        weightedFallbackField,
        setAdvancedSettingsJson,
        setFilterDateStr,
        setFilterRules,
        setFilterStatus,
        setFilterType,
        setVariantMode: handleVariantModeChange,
        setWeightedPvpField,
    })

    const runtimeActions = useRuntimeActions({
        apiKey,
        fetchInvoices,
        fetchSyncLogs,
        invoicePreviewOrderId,
        invoicePreviewType,
        setDeletePreview,
        setDeleteProgress,
        setInvoicePreview,
        setIsCreatingTestFAC,
        setIsCreatingTestPRE,
        setIsDeletingProducts,
        setIsDeletingTestDocs,
        setIsPreviewingDelete,
        setIsPreviewingInvoice,
        setIsPreviewingSync,
        setIsSyncingCustomers,
        setIsSyncingProducts,
        setIsSyncingStock,
        setIsTesting,
        setSyncPreview,
        setSyncProgress,
    })

    const activeTestInvoicesCount = useMemo(
        () =>
            invoices.filter((invoice) => invoice.is_test && invoice.estado !== "A")
                .length,
        [invoices]
    )

    const filteredInvoices = useMemo(() => {
        let list = invoices
        if (filterStatus !== "ALL") {
            list = list.filter((invoice) => invoice.estado === filterStatus)
        }
        if (filterType !== "ALL") {
            list = list.filter((invoice) => invoice.tipo_documento === filterType)
        }
        if (filterDateStr) {
            list = list.filter(
                (invoice) =>
                    new Date(invoice.created_at).toLocaleDateString("en-CA") ===
                    filterDateStr
            )
        }
        return list
    }, [filterDateStr, filterStatus, filterType, invoices])

    return {
        activeTestInvoicesCount,
        advancedSettingsJson,
        allowBackorder,
        apiKey,
        apiPos,
        autoInvoice,
        autoPreinvoice,
        autoInvoiceGate,
        bodegaIds,
        bodegas,
        config,
        deleteImportedProductsGate,
        deletePreview,
        deleteProgress,
        fetchBodegas,
        fetchInvoices,
        fetchSyncLogs,
        filterDateStr,
        filterMode,
        filterRules,
        filterStatus,
        filterType,
        filteredInvoices,
        handleSave,
        invoicePreview,
        invoicePreviewOrderId,
        invoicePreviewType,
        invoiceStatusFilterOptions: INVOICE_STATUS_FILTER_OPTIONS,
        invoiceTestMode,
        invoiceTypeFilterOptions: INVOICE_TYPE_FILTER_OPTIONS,
        invoiceTypeOptions: INVOICE_TYPE_OPTIONS,
        invoices,
        isCreatingTestFAC,
        isCreatingTestPRE,
        isDeletingProducts,
        isDeletingTestDocs,
        isLoading,
        isLoadingBodegas,
        isPreviewingDelete,
        isPreviewingInvoice,
        isPreviewingSync,
        isSaving,
        isSyncingCustomers,
        isSyncingProducts,
        isSyncingStock,
        isTableOpen,
        isTesting,
        manageInventory,
        mappingModeOptions: MAPPING_MODE_OPTIONS,
        parsedAdvancedSettings,
        productSyncActionsGate,
        salesChannelId,
        salesChannelOptions,
        setAdvancedSettingsJson,
        setAllowBackorder,
        setApiKey,
        setApiPos,
        setAutoInvoice,
        setAutoPreinvoice,
        setBodegaIds,
        setFilterDateStr,
        setFilterMode,
        setFilterRules,
        setFilterStatus,
        setFilterType,
        setInvoicePreviewOrderId,
        setInvoicePreviewType: (value: string) => {
            if (isInvoicePreviewType(value)) {
                setInvoicePreviewTypeState(value)
            }
        },
        setInvoiceTestMode,
        setIsTableOpen,
        setManageInventory,
        setSalesChannelId,
        setShippingProfileId,
        setSyncCustomers,
        setSyncInterval,
        setSyncProducts,
        setVariantMode: handleVariantModeChange,
        shippingProfileId,
        shippingProfileOptions,
        syncCustomers,
        syncInterval,
        syncIntervalGate,
        syncLogs,
        syncPreview,
        syncProducts,
        syncProgress,
        variantMode,
        weightedCreationMode,
        weightedCreationModeGate,
        weightedCreationModeOptions: WEIGHTED_CREATION_MODE_OPTIONS,
        weightedCreationProfileOptions,
        weightedCreationProfiles,
        weightedCreationProfilesGate,
        weightedDefaultProfileId,
        weightedFallbackField,
        weightedFixedFieldGate,
        weightedPriceLockGate,
        weightedPriceStrategy,
        weightedPriceStrategyOptions: WEIGHTED_PRICE_STRATEGY_OPTIONS,
        weightedPvpField,
        weightedPvpOptions: WEIGHTED_PVP_OPTIONS,
        weightedPvpRules,
        weightedRulesGate,
        weightedStrategyGate,
        ...weightedActions,
        ...runtimeActions,
    }
}

export type ContificoSettingsController = ReturnType<
    typeof useContificoSettingsController
>
