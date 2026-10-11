"use client";

import { useEffect, useMemo, useRef } from "react";
import ReactECharts from "echarts-for-react/lib/core";
import { dashboardEcharts } from "./dashboardCharts";

type EchartsOverlayDatum = {
    id: string;
    label: string;
    color: string;
    actualValue: number;
    targetValue: number;
};

type TargetOverlayDonutEchartsProps = {
    data: EchartsOverlayDatum[];
    actualLabel: string;
    targetLabel: string;
};

function darkenHslColor(color: string, lightnessDelta = 14) {
    const hslMatch = color.match(
        /hsl\(\s*([0-9.]+)\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*\)|hsl\(\s*([0-9.]+)\s+([0-9.]+)%\s+([0-9.]+)%\s*\)/i
    );
    if (!hslMatch) return color;

    const hue = Number(hslMatch[1] ?? hslMatch[4]);
    const saturation = Number(hslMatch[2] ?? hslMatch[5]);
    const lightness = Number(hslMatch[3] ?? hslMatch[6]);
    const nextLightness = Math.max(0, Math.min(100, lightness - lightnessDelta));
    return `hsl(${hue}, ${saturation}%, ${nextLightness}%)`;
}

export function TargetOverlayDonutEcharts({
    data,
    actualLabel,
    targetLabel,
}: TargetOverlayDonutEchartsProps) {
    const chartRef = useRef<ReactECharts | null>(null);
    const lastHighlightedIndexRef = useRef<number | null>(null);

    useEffect(() => {
        // Reset linked-hover state when the series size changes to avoid stale dataIndex actions.
        lastHighlightedIndexRef.current = null;
    }, [data.length]);

    const option = useMemo(
        () => ({
            color: data.map((entry) => entry.color),
            tooltip: {
                trigger: "item",
                formatter: (params: { dataIndex?: number; name?: string }) => {
                    const index = params.dataIndex;
                    const datum = typeof index === "number" ? data[index] : undefined;
                    if (!datum) return "";
                    return [
                        `<b>${params.name ?? datum.label}</b>`,
                        `${targetLabel}: <b>${datum.targetValue.toFixed(1)}%</b>`,
                        `${actualLabel}: <b>${datum.actualValue.toFixed(1)}%</b>`,
                    ].join("<br/>");
                },
                backgroundColor: "var(--background-swap-container)",
                borderColor: "var(--swap-container-border)",
                textStyle: { color: "#333", fontSize: 11 },
            },
            series: [
                {
                    name: actualLabel,
                    type: "pie",
                    radius: ["46%", "72%"],
                    center: ["50%", "48%"],
                    avoidLabelOverlap: true,
                    itemStyle: { borderRadius: 2, borderColor: "transparent", borderWidth: 0 },
                    labelLine: {
                        show: true,
                        length: 16,
                        length2: 20,
                        lineStyle: {
                            width: 2,
                        },
                    },
                    label: {
                        show: true,
                        formatter: "{b}",
                        fontWeight: 700,
                        color: "#333",
                        fontSize: 14,
                    },
                    emphasis: { focus: "none", scale: true, scaleSize: 8 },
                    data: data.map((entry) => ({
                        value: Number(entry.actualValue.toFixed(3)),
                        name: entry.label,
                        itemStyle: { color: entry.color },
                        label: {
                            color: entry.color,
                            fontWeight: 700,
                            fontSize: 14,
                        },
                        labelLine: {
                            lineStyle: {
                                color: entry.color,
                                width: 2,
                            },
                        },
                    })),
                },
                {
                    name: targetLabel,
                    type: "pie",
                    radius: ["33%", "40%"],
                    center: ["50%", "48%"],
                    avoidLabelOverlap: true,
                    itemStyle: { borderRadius: 2, borderColor: "transparent", borderWidth: 0, opacity: 0.95 },
                    label: { show: false },
                    labelLine: { show: false },
                    emphasis: { focus: "none", scale: false },
                    data: data.map((entry) => ({
                        value: Number(entry.targetValue.toFixed(3)),
                        name: entry.label,
                        itemStyle: { color: darkenHslColor(entry.color), opacity: 0.96 },
                    })),
                },
            ],
        }),
        [actualLabel, data, targetLabel]
    );

    const onEvents = useMemo(
        () => ({
            mouseover: (params: {
                componentType?: string;
                seriesType?: string;
                seriesIndex?: number;
                dataIndex?: number;
                event?: { target?: { type?: string } };
            }) => {
                if (params.componentType !== "series" || params.seriesType !== "pie") return;
                if (typeof params.dataIndex !== "number") return;
                if (params.dataIndex < 0 || params.dataIndex >= data.length) return;
                if (params.event?.target?.type !== "sector") return;
                if (params.seriesIndex !== 0 && params.seriesIndex !== 1) return;
                const chart = chartRef.current?.getEchartsInstance();
                if (!chart) return;

                const nextIndex = params.dataIndex;
                const previousIndex = lastHighlightedIndexRef.current;
                const counterpartSeriesIndex = params.seriesIndex === 0 ? 1 : 0;
                if (previousIndex !== null && previousIndex !== nextIndex) {
                    if (previousIndex >= 0 && previousIndex < data.length) {
                        chart.dispatchAction({
                            type: "downplay",
                            seriesIndex: 0,
                            dataIndex: previousIndex,
                        });
                        chart.dispatchAction({
                            type: "downplay",
                            seriesIndex: 1,
                            dataIndex: previousIndex,
                        });
                    }
                }

                // Hovered slice is highlighted by ECharts already; link the matching slice in the other ring.
                chart.dispatchAction({
                    type: "highlight",
                    seriesIndex: counterpartSeriesIndex,
                    dataIndex: nextIndex,
                });
                lastHighlightedIndexRef.current = nextIndex;
            },
            mouseout: (params: {
                componentType?: string;
                seriesType?: string;
                seriesIndex?: number;
                dataIndex?: number;
            }) => {
                if (params.componentType !== "series" || params.seriesType !== "pie") return;
                if (typeof params.dataIndex !== "number") return;
                if (params.dataIndex < 0 || params.dataIndex >= data.length) return;
                if (params.seriesIndex !== 0 && params.seriesIndex !== 1) return;
                const chart = chartRef.current?.getEchartsInstance();
                if (!chart) return;

                const counterpartSeriesIndex = params.seriesIndex === 0 ? 1 : 0;
                chart.dispatchAction({
                    type: "downplay",
                    seriesIndex: counterpartSeriesIndex,
                    dataIndex: params.dataIndex,
                });
                if (lastHighlightedIndexRef.current === params.dataIndex) {
                    lastHighlightedIndexRef.current = null;
                }
            },
            globalout: () => {
                const chart = chartRef.current?.getEchartsInstance();
                const previousIndex = lastHighlightedIndexRef.current;
                if (!chart || previousIndex === null) return;
                if (previousIndex >= 0 && previousIndex < data.length) {
                    chart.dispatchAction({ type: "downplay", seriesIndex: 0, dataIndex: previousIndex });
                    chart.dispatchAction({ type: "downplay", seriesIndex: 1, dataIndex: previousIndex });
                }
                lastHighlightedIndexRef.current = null;
            },
        }),
        [data.length]
    );

    return (
        <ReactECharts echarts={dashboardEcharts}
            ref={chartRef}
            option={option}
            onEvents={onEvents}
            notMerge
            lazyUpdate
            style={{ height: "100%", width: "100%" }}
        />
    );
}
