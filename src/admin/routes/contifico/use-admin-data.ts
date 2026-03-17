import { toast } from "@medusajs/ui"
import { useCallback, useEffect } from "react"
import { normalizeAdvancedSettings } from "../../../lib/advanced-settings"
import { getWeightedFallbackPvpField } from "../../../lib/advanced-settings"
import type {
    Bodega,
    ContificoConfigData,
    ImportFilterRuleData,
    InvoiceEntry,
    SyncLog,
} from "./types"
import { getErrorDescription, isAbortError, parseJsonResponse } from "./controller-helpers"

interface UseAdminDataParams {
    apiKey: string
    configApiKey?: string
    isTableOpen: boolean
    parsedAdvancedSettings: ReturnType<typeof normalizeAdvancedSettings> | null
    reportLoadError: (resource: string, error: unknown) => void
    setAdvancedSettingsJson: (value: string) => void
    setAllowBackorder: (value: boolean) => void
    setApiKey: (value: string) => void
    setApiPos: (value: string) => void
    setAutoInvoice: (value: boolean) => void
    setAutoPreinvoice: (value: boolean) => void
    setBodegaIds: (value: string[]) => void
    setBodegas: (value: Bodega[]) => void
    setConfig: (value: ContificoConfigData | null) => void
    setFilterMode: (value: "and" | "or") => void
    setFilterRules: (value: ImportFilterRuleData[]) => void
    setInvoiceTestMode: (value: boolean) => void
    setInvoices: (value: InvoiceEntry[]) => void
    setIsLoading: (value: boolean) => void
    setIsLoadingBodegas: (value: boolean) => void
    setManageInventory: (value: boolean) => void
    setSalesChannelId: (value: string | ((current: string) => string)) => void
    setSalesChannels: (value: Array<{ id: string; name: string }>) => void
    setShippingProfileId: (value: string | ((current: string) => string)) => void
    setShippingProfiles: (
        value: Array<{ id: string; name: string; type: string }>
    ) => void
    setSyncCustomers: (value: boolean) => void
    setSyncInterval: (value: number) => void
    setSyncLogs: (value: SyncLog[]) => void
    setSyncProducts: (value: boolean) => void
    setVariantMode: (value: ContificoConfigData["variant_mode"]) => void
    setWeightedPvpField: (value: ContificoConfigData["weighted_pvp_field"]) => void
}

export function useAdminData({
    apiKey,
    configApiKey,
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
    setVariantMode,
    setWeightedPvpField,
}: UseAdminDataParams) {
    const fetchConfig = useCallback(async (signal?: AbortSignal) => {
        try {
            const response = await fetch("/admin/contifico/config", {
                credentials: "include",
                signal,
            })
            const data = await parseJsonResponse<{ config?: ContificoConfigData }>(
                response
            )
            if (!data.config) {
                return
            }

            setConfig(data.config)
            setApiKey(data.config.api_key || "")
            setApiPos(data.config.api_pos || "")
            setBodegaIds(data.config.bodega_ids || [])
            setSyncProducts(data.config.sync_products_enabled)
            setSyncCustomers(data.config.sync_customers_enabled)
            setAutoInvoice(data.config.auto_invoice_enabled)
            setAutoPreinvoice(data.config.auto_preinvoice_enabled)
            setSyncInterval(data.config.sync_interval_minutes)
            setManageInventory(data.config.manage_inventory ?? false)
            setAllowBackorder(data.config.allow_backorder ?? false)
            setSalesChannelId(data.config.sales_channel_id || "")
            setShippingProfileId(data.config.shipping_profile_id || "")
            setVariantMode(data.config.variant_mode || "auto")
            setWeightedPvpField(data.config.weighted_pvp_field || "pvp1")
            setAdvancedSettingsJson(
                JSON.stringify(
                    normalizeAdvancedSettings(data.config.advanced_settings),
                    null,
                    2
                )
            )
            setInvoiceTestMode(data.config.invoice_test_mode ?? false)
            if (data.config.import_filters) {
                setFilterMode(data.config.import_filters.mode || "and")
                setFilterRules(data.config.import_filters.rules || [])
            } else {
                setFilterMode("and")
                setFilterRules([])
            }
        } catch (error) {
            if (!isAbortError(error)) reportLoadError("configuración", error)
        } finally {
            setIsLoading(false)
        }
    }, [
        reportLoadError,
        setAdvancedSettingsJson,
        setAllowBackorder,
        setApiKey,
        setApiPos,
        setAutoInvoice,
        setAutoPreinvoice,
        setBodegaIds,
        setConfig,
        setFilterMode,
        setFilterRules,
        setInvoiceTestMode,
        setIsLoading,
        setManageInventory,
        setSalesChannelId,
        setShippingProfileId,
        setSyncCustomers,
        setSyncInterval,
        setSyncProducts,
        setVariantMode,
        setWeightedPvpField,
    ])

    const fetchBodegas = useCallback(async (signal?: AbortSignal) => {
        setIsLoadingBodegas(true)
        try {
            const response = await fetch("/admin/contifico/config/bodegas", {
                credentials: "include",
                signal,
            })
            const data = await parseJsonResponse<{ bodegas?: Bodega[] }>(response)
            if (data.bodegas) {
                setBodegas(data.bodegas)
            }
        } catch (error) {
            if (!isAbortError(error)) reportLoadError("bodegas", error)
        } finally {
            setIsLoadingBodegas(false)
        }
    }, [reportLoadError, setBodegas, setIsLoadingBodegas])

    const fetchSyncLogs = useCallback(async (signal?: AbortSignal) => {
        try {
            const response = await fetch("/admin/contifico/sync-logs?limit=10", {
                credentials: "include",
                signal,
            })
            const data = await parseJsonResponse<{ sync_logs?: SyncLog[] }>(response)
            if (data.sync_logs) {
                setSyncLogs(data.sync_logs)
            }
        } catch (error) {
            if (!isAbortError(error)) reportLoadError("logs", error)
        }
    }, [reportLoadError, setSyncLogs])

    const fetchMedusaOptions = useCallback(async (signal?: AbortSignal) => {
        try {
            const [salesChannelsResponse, shippingProfilesResponse] =
                await Promise.all([
                    fetch("/admin/sales-channels", { credentials: "include", signal }),
                    fetch("/admin/shipping-profiles", { credentials: "include", signal }),
                ])
            const salesChannelData = await parseJsonResponse<{
                sales_channels?: Array<{ id: string; name: string }>
            }>(salesChannelsResponse)
            const shippingProfileData = await parseJsonResponse<{
                shipping_profiles?: Array<{ id: string; name: string; type: string }>
            }>(shippingProfilesResponse)
            const nextSalesChannels = salesChannelData.sales_channels || []
            const nextShippingProfiles = shippingProfileData.shipping_profiles || []

            setSalesChannels(nextSalesChannels)
            setShippingProfiles(nextShippingProfiles)
            setSalesChannelId((current) => current || nextSalesChannels[0]?.id || "")
            setShippingProfileId(
                (current) => current || nextShippingProfiles[0]?.id || ""
            )
        } catch (error) {
            if (!isAbortError(error)) reportLoadError("opciones de Medusa", error)
        }
    }, [
        reportLoadError,
        setSalesChannelId,
        setSalesChannels,
        setShippingProfileId,
        setShippingProfiles,
    ])

    const fetchInvoices = useCallback(async (signal?: AbortSignal) => {
        try {
            const response = await fetch("/admin/contifico/invoices", {
                credentials: "include",
                signal,
            })
            const data = await parseJsonResponse<{ invoices?: InvoiceEntry[] }>(
                response
            )
            if (data.invoices) {
                setInvoices(data.invoices)
            }
        } catch (error) {
            if (!isAbortError(error)) reportLoadError("facturas", error)
        }
    }, [reportLoadError, setInvoices])

    useEffect(() => {
        const ac = new AbortController()
        fetchConfig(ac.signal)
        fetchSyncLogs(ac.signal)
        fetchMedusaOptions(ac.signal)
        fetchInvoices(ac.signal)
        return () => ac.abort()
    }, [fetchConfig, fetchInvoices, fetchMedusaOptions, fetchSyncLogs])

    useEffect(() => {
        const ac = new AbortController()
        const intervalId = window.setInterval(() => {
            fetchSyncLogs(ac.signal)
        }, 5000)
        return () => { ac.abort(); window.clearInterval(intervalId) }
    }, [fetchSyncLogs])

    useEffect(() => {
        if (!isTableOpen) {
            return
        }
        const ac = new AbortController()
        fetchInvoices(ac.signal)
        const intervalId = window.setInterval(() => {
            fetchInvoices(ac.signal)
        }, 15000)
        return () => { ac.abort(); window.clearInterval(intervalId) }
    }, [fetchInvoices, isTableOpen])

    useEffect(() => {
        if (apiKey) {
            const ac = new AbortController()
            fetchBodegas(ac.signal)
            return () => ac.abort()
        }
    }, [apiKey, configApiKey, fetchBodegas])

    useEffect(() => {
        if (parsedAdvancedSettings) {
            setWeightedPvpField(
                getWeightedFallbackPvpField(parsedAdvancedSettings.weighted)
            )
        }
    }, [parsedAdvancedSettings, setWeightedPvpField])

    return {
        fetchBodegas,
        fetchConfig,
        fetchInvoices,
        fetchMedusaOptions,
        fetchSyncLogs,
    }
}

export function createLoadErrorReporter() {
    return (resource: string, error: unknown) => {
        toast.error(`Error cargando ${resource}`, {
            description: getErrorDescription(error),
        })
    }
}

export function showGenericError(error: unknown) {
    toast.error("Error", {
        description: getErrorDescription(error),
    })
}
