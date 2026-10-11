"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react/lib/core";
import { dashboardEcharts } from "./dashboardCharts";

type TransferActivityPoint = {
    label: string;
    cygld: number;
    tx: number;
};

type TransferActivityLineChartEchartsProps = {
    series: TransferActivityPoint[];
    locale: string;
    transfersSuffix: string;
};

export function TransferActivityLineChartEcharts({
    series,
    locale,
    transfersSuffix,
}: TransferActivityLineChartEchartsProps) {
    const option = useMemo(() => {
        const values = series.map((entry) => entry.cygld);
        const maxValue = values.length > 0 ? Math.max(...values) : 1;
        const paddedMax = Math.max(1, maxValue * 1.12);
        const yInterval = paddedMax / 4;
        const yMax = yInterval * 4;
        const numberFormatter = new Intl.NumberFormat(locale, {
            notation: yMax >= 1_000 ? "compact" : "standard",
            maximumFractionDigits: yMax >= 1_000 ? 1 : 3,
        });
        const txFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
        const cygldFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });

        return {
            animation: true,
            animationDuration: 350,
            animationDurationUpdate: 0,
            grid: {
                top: 12,
                right: 72,
                bottom: 8,
                left: 6,
                containLabel: false,
            },
            tooltip: {
                trigger: "axis",
                axisPointer: {
                    type: "line",
                    snap: true,
                    lineStyle: {
                        color: "rgba(212, 175, 55, 0.35)",
                        width: 1,
                        type: "dashed",
                    },
                },
                backgroundColor: "var(--background-swap-container)",
                borderColor: "var(--swap-container-border)",
                textStyle: { color: "#333", fontSize: 11 },
                formatter: (params: Array<{ dataIndex?: number }>) => {
                    const dataPoint = params.find((entry) => typeof entry.dataIndex === "number");
                    const dataIndex = dataPoint?.dataIndex;
                    if (dataIndex === undefined) return "";
                    const point = series[dataIndex];
                    if (!point) return "";
                    return [
                        point.label,
                        `Transferred: <b>${cygldFormatter.format(point.cygld)} CYGLD</b>`,
                        `Tx: <b>${txFormatter.format(point.tx)} ${transfersSuffix}</b>`,
                    ].join("<br/>");
                },
            },
            xAxis: {
                type: "category",
                data: series.map((entry) => entry.label),
                boundaryGap: false,
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { show: false },
                splitLine: { show: false },
            },
            yAxis: {
                type: "value",
                position: "right",
                min: 0,
                max: yMax,
                interval: yInterval,
                splitNumber: 4,
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: {
                    show: true,
                    color: "var(--text-muted)",
                    fontSize: 10,
                    margin: 8,
                    showMinLabel: true,
                    showMaxLabel: true,
                    formatter: (value: number | string) => {
                        const numeric = Number(value);
                        if (!Number.isFinite(numeric)) return "";
                        return `{tick|${numberFormatter.format(numeric)}}`;
                    },
                    rich: {
                        tick: {
                            width: 64,
                            align: "right",
                            color: "var(--text-muted)",
                            fontSize: 10,
                        },
                    },
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
                    name: "Transferred",
                    data: series.map((entry) => entry.cygld),
                    smooth: 0.25,
                    showSymbol: false,
                    lineStyle: {
                        color: "hsl(46, 71%, 56%)",
                        width: 2.5,
                        shadowBlur: 8,
                        shadowColor: "rgba(212, 175, 55, 0.25)",
                    },
                    itemStyle: {
                        color: "hsl(46, 71%, 56%)",
                    },
                    areaStyle: {
                        color: {
                            type: "linear",
                            x: 0,
                            y: 0,
                            x2: 0,
                            y2: 1,
                            colorStops: [
                                { offset: 0, color: "rgba(234, 179, 8, 0.18)" },
                                { offset: 1, color: "rgba(234, 179, 8, 0.03)" },
                            ],
                        },
                        shadowBlur: 14,
                        shadowColor: "rgba(212, 175, 55, 0.15)",
                    },
                    emphasis: {
                        focus: "none",
                    },
                    z: 4,
                },
            ],
        };
    }, [locale, series, transfersSuffix]);

    return <ReactECharts echarts={dashboardEcharts} option={option} notMerge lazyUpdate style={{ height: "8rem", width: "100%" }} />;
}
