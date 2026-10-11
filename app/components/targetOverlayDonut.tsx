"use client";

import { ResponsivePie } from "@nivo/pie";

type TargetOverlayDatum = {
    id: string;
    label: string;
    color: string;
    actualValue: number;
    targetValue: number;
};

type TargetOverlayDonutProps = {
    data: TargetOverlayDatum[];
    actualLabel: string;
    targetLabel: string;
};

type TargetSegment = {
    color: string;
    startAngle: number;
    endAngle: number;
};

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
    const angleRad = ((angleDeg - 90) * Math.PI) / 180;
    return {
        x: cx + radius * Math.cos(angleRad),
        y: cy + radius * Math.sin(angleRad),
    };
}

function buildTargetSegments(data: Array<{ color: string; value: number }>): TargetSegment[] {
    const total = data.reduce((sum, entry) => sum + Math.max(0, entry.value), 0);
    if (total <= 0) return [];

    let cursor = 0;
    return data
        .map((entry) => {
            const span = (Math.max(0, entry.value) / total) * 360;
            const startAngle = cursor;
            const endAngle = cursor + span;
            cursor = endAngle;
            return { color: entry.color, startAngle, endAngle };
        })
        .filter((segment) => segment.endAngle - segment.startAngle > 0.5);
}

function describeDonutSegment(
    cx: number,
    cy: number,
    outerRadius: number,
    innerRadius: number,
    startAngle: number,
    endAngle: number
) {
    const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
    const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
    const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
    const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
    const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

    return [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerEnd.x} ${innerEnd.y}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerStart.x} ${innerStart.y}`,
        "Z",
    ].join(" ");
}

export function TargetOverlayDonut({ data, actualLabel, targetLabel }: TargetOverlayDonutProps) {
    const actualData = data.map((entry) => ({
        id: entry.id,
        label: entry.label,
        value: entry.actualValue,
        color: entry.color,
    }));

    const targetData = data.map((entry) => ({
        id: entry.id,
        label: entry.label,
        value: entry.targetValue,
        color: entry.color,
    }));
    const targetSegments = buildTargetSegments(
        targetData.map((entry) => ({
            color: entry.color,
            value: Number(entry.value),
        }))
    );

    return (
        <div className="flex h-full w-full flex-col items-center">
            <div className="relative h-full w-full">
                <div className="absolute inset-0">
                    <ResponsivePie
                        data={actualData}
                        colors={{ datum: "data.color" }}
                        margin={{ top: 24, right: 90, bottom: 60, left: 90 }}
                        innerRadius={0.5}
                        padAngle={0.6}
                        cornerRadius={2}
                        activeOuterRadiusOffset={8}
                        arcLinkLabelsSkipAngle={10}
                        arcLinkLabelsTextColor="#333333"
                        arcLinkLabelsThickness={2}
                        arcLinkLabelsColor={{ from: "color" }}
                        arcLabelsSkipAngle={10}
                        arcLabelsTextColor={{ from: "color", modifiers: [["darker", 2]] }}
                        layers={["arcs", "arcLabels", "arcLinkLabels"]}
                    />
                </div>

                <div className="pointer-events-none absolute left-1/2 top-1/2 h-[42%] w-[42%] min-h-[88px] min-w-[88px] max-h-[124px] max-w-[124px] -translate-x-1/2 -translate-y-1/2">
                    <svg viewBox="0 0 100 100" className="h-full w-full">
                        <circle
                            cx={50}
                            cy={50}
                            r={28}
                            fill="none"
                            stroke="var(--swap-container-border)"
                            strokeWidth={1.2}
                            opacity={0.45}
                        />
                        {targetSegments.map((segment, index) => (
                            <path
                                key={`target-segment-${index}`}
                                d={describeDonutSegment(50, 50, 31, 25, segment.startAngle, segment.endAngle)}
                                fill={segment.color}
                            />
                        ))}
                    </svg>
                </div>
            </div>

            <div className="mt-1 flex items-center gap-4 text-[11px] text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-sm border border-[var(--text-muted)]" />
                    {actualLabel}
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full border border-[var(--text-muted)]" />
                    {targetLabel}
                </span>
            </div>
        </div>
    );
}
