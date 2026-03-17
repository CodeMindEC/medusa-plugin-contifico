import { Badge, Text } from "@medusajs/ui"
import type { ProgressState } from "../types"

interface ProgressCardProps {
    progress: ProgressState
    color: "blue" | "red"
}

export function ProgressCard({ progress, color }: ProgressCardProps) {
    const progressColor =
        progress.percent >= 100
            ? "#10b981"
            : color === "red"
                ? "#ef4444"
                : "#3b82f6"

    return (
        <div className="p-3 bg-ui-bg-subtle rounded-lg border border-ui-border-base">
            <div className="flex items-center justify-between mb-2">
                <Text className="text-sm font-medium text-ui-fg-base">
                    {progress.message}
                </Text>
                <Badge color={color} className="text-xs">
                    {progress.percent}%
                </Badge>
            </div>
            <div className="w-full bg-ui-bg-base rounded-full h-2 overflow-hidden">
                <div
                    className="h-2 rounded-full transition-all duration-500 ease-out"
                    style={{
                        width: `${progress.percent}%`,
                        backgroundColor: progressColor,
                    }}
                />
            </div>
        </div>
    )
}
