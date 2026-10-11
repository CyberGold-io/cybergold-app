"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react/lib/core";
import { dashboardEcharts } from "./dashboardCharts";

type PegTrackingPoint = {
    label: string;
    value: number;
};

type PegTrackingLineChartEchartsProps = {
    series: PegTrackingPoint[];
    referenceValue?: number;
};

export function PegTrackingLineChartEcharts({
    series,
    referenceValue = 1,
}: PegTrackingLineChartEchartsProps) {
    const option = useMemo(() => {
        const values = series.map((entry) => entry.value);
        const deviations = values.map((value) => value - referenceValue);
        const minDeviation = deviations.length > 0 ? Math.min(...deviations, 0) : 0;
        const maxDeviation = deviations.length > 0 ? Math.max(...deviations, 0) : 0;
        const maxAbsDeviation = Math.max(Math.abs(minDeviation), Math.abs(maxDeviation), 0);
        const paddedAbsDeviation = Math.max(0.0003, maxAbsDeviation * 1.18);
        const yMinDeviation = -paddedAbsDeviation;
        const yMaxDeviation = paddedAbsDeviation;
        const yAxisValueSpan = (yMaxDeviation - yMinDeviation) || 0;
        const yAxisInterval = yAxisValueSpan > 0 ? yAxisValueSpan / 4 : 0.00015;
        const axisLabelPrecision =
            yAxisValueSpan <= 0.001 ? 5 : yAxisValueSpan <= 0.01 ? 4 : yAxisValueSpan <= 0.1 ? 3 : 2;
        const originalLabels = series.map((entry) => entry.label);
        const originalPegValues = series.map((entry) => Number(entry.value.toFixed(4)));

        type ExpandedPoint = {
            x: number;
            value: number;
        };

        const expandedPoints: ExpandedPoint[] = [];
        for (let index = 0; index < series.length; index += 1) {
            const current = series[index];
            const next = series[index + 1];
            if (!current) continue;

            expandedPoints.push({
                x: index,
                value: Number(current.value.toFixed(4)),
            });

            if (!next) continue;

            const currentDelta = current.value - referenceValue;
            const nextDelta = next.value - referenceValue;
            if (currentDelta === 0 || nextDelta === 0) continue;
            if (currentDelta * nextDelta > 0) continue;

            const ratio = (referenceValue - current.value) / (next.value - current.value);
            if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) continue;

            expandedPoints.push({
                x: index + ratio,
                value: Number(referenceValue.toFixed(4)),
            });
        }

        const toPair = (point: ExpandedPoint, y: number | null) => [point.x, y] as [number, number | null];
        const referencePairs = expandedPoints.map((point) => toPair(point, 0));
        const aboveLinePairs = expandedPoints.map((point) =>
            toPair(point, point.value >= referenceValue ? Number((point.value - referenceValue).toFixed(4)) : null)
        );
        const belowLinePairs = expandedPoints.map((point) =>
            toPair(point, point.value <= referenceValue ? Number((point.value - referenceValue).toFixed(4)) : null)
        );
        const xMax = Math.max(0, series.length - 1);

        return {
            animation: true,
            animationDuration: 350,
            animationDurationUpdate: 0,
            grid: {
                top: 10,
                right: 56,
                bottom: 10,
                left: 6,
                containLabel: false,
            },
            tooltip: {
                trigger: "axis",
                backgroundColor: "var(--background-swap-container)",
                borderColor: "var(--swap-container-border)",
                textStyle: { color: "#333", fontSize: 11 },
                formatter: (params: Array<{ axisValue?: number | string }>) => {
                    const axisValue = Number(params[0]?.axisValue);
                    if (!Number.isFinite(axisValue)) return "";
                    const roundedIndex = Math.round(axisValue);
                    if (Math.abs(axisValue - roundedIndex) > 1e-6) return "";

                    const label = originalLabels[roundedIndex];
                    const value = originalPegValues[roundedIndex];
                    if (!label || typeof value !== "number") return "";

                    return `${label}<br/>Peg: <b>${value.toFixed(4)}</b>`;
                },
                axisPointer: {
                    type: "line",
                    snap: true,
                    lineStyle: {
                        color: "rgba(161, 161, 170, 0.35)",
                        width: 1,
                    },
                },
            },
            xAxis: {
                type: "value",
                min: 0,
                max: xMax,
                boundaryGap: false,
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { show: false },
                splitLine: { show: false },
            },
            yAxis: {
                type: "value",
                min: yMinDeviation,
                max: yMaxDeviation,
                interval: yAxisInterval,
                splitNumber: 4,
                position: "right",
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: {
                    show: true,
                    color: "var(--text-muted)",
                    fontSize: 10,
                    margin: 8,
                    showMinLabel: true,
                    showMaxLabel: true,
                    formatter: (value: number | string) => (referenceValue + Number(value)).toFixed(axisLabelPrecision),
                },
                splitLine: {
                    show: true,
                    lineStyle: {
                        color: "rgba(161, 161, 170, 0.12)",
                    },
                },
            },
            series: [
                {
                    type: "line",
                    name: "Reference",
                    data: referencePairs,
                    showSymbol: false,
                    silent: true,
                    tooltip: { show: false },
                    lineStyle: {
                        color: "hsl(46, 71%, 56%)",
                        width: 1.6,
                        type: "solid",
                    },
                    itemStyle: { opacity: 0 },
                    z: 2,
                },
                {
                    type: "line",
                    name: "Peg Above",
                    data: aboveLinePairs,
                    smooth: 0.25,
                    showSymbol: false,
                    symbol: "circle",
                    symbolSize: 6,
                    connectNulls: false,
                    lineStyle: {
                        color: "#22c55e",
                        width: 2.5,
                        shadowBlur: 8,
                        shadowColor: "rgba(34, 197, 94, 0.28)",
                    },
                    itemStyle: {
                        color: "#22c55e",
                    },
                    areaStyle: {
                        color: {
                            type: "linear",
                            x: 0,
                            y: 0,
                            x2: 0,
                            y2: 1,
                            colorStops: [
                                { offset: 0, color: "rgba(34, 197, 94, 0.22)" },
                                { offset: 1, color: "rgba(34, 197, 94, 0.03)" },
                            ],
                        },
                        shadowBlur: 14,
                        shadowColor: "rgba(34, 197, 94, 0.18)",
                    },
                    emphasis: {
                        focus: "none",
                        scale: true,
                        itemStyle: {
                            borderColor: "#fff",
                            borderWidth: 1,
                        },
                    },
                    z: 5,
                },
                {
                    type: "line",
                    name: "Peg Below",
                    data: belowLinePairs,
                    smooth: 0.25,
                    showSymbol: false,
                    symbol: "circle",
                    symbolSize: 6,
                    connectNulls: false,
                    lineStyle: {
                        color: "#ef4444",
                        width: 2.5,
                        shadowBlur: 8,
                        shadowColor: "rgba(239, 68, 68, 0.28)",
                    },
                    itemStyle: {
                        color: "#ef4444",
                    },
                    areaStyle: {
                        color: {
                            type: "linear",
                            x: 0,
                            y: 0,
                            x2: 0,
                            y2: 1,
                            colorStops: [
                                { offset: 0, color: "rgba(239, 68, 68, 0.03)" },
                                { offset: 1, color: "rgba(239, 68, 68, 0.22)" },
                            ],
                        },
                        shadowBlur: 14,
                        shadowColor: "rgba(239, 68, 68, 0.18)",
                    },
                    emphasis: {
                        focus: "none",
                        scale: true,
                        itemStyle: {
                            borderColor: "#fff",
                            borderWidth: 1,
                        },
                    },
                    z: 4,
                },
            ],
        };
    }, [referenceValue, series]);

    return <ReactECharts echarts={dashboardEcharts} option={option} notMerge lazyUpdate style={{ height: "8rem", width: "100%" }} />;
}
