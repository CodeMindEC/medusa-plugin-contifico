import { Select } from "@medusajs/ui"

export interface SelectOption {
    value: string
    label: string
}

export function UiSelectField({
    value,
    onValueChange,
    options,
    placeholder,
    triggerClassName,
    disabled,
}: {
    value: string
    onValueChange: (value: string) => void
    options: SelectOption[]
    placeholder?: string
    triggerClassName?: string
    disabled?: boolean
}) {
    const selectedLabel = options.find((option) => option.value === value)?.label

    return (
        <Select
            value={value || undefined}
            onValueChange={onValueChange}
            disabled={disabled}
        >
            <Select.Trigger className={triggerClassName}>
                {selectedLabel ? (
                    <span className="truncate">{selectedLabel}</span>
                ) : (
                    <Select.Value placeholder={placeholder || "Seleccionar"} />
                )}
            </Select.Trigger>
            <Select.Content>
                {options.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                        {option.label}
                    </Select.Item>
                ))}
            </Select.Content>
        </Select>
    )
}
