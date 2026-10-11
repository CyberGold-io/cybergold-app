"use client";

import { useMemo } from "react";
import ReactECharts from "echarts-for-react/lib/core";
import { dashboardEcharts } from "./dashboardCharts";

type PriceCandle = {
    label: string;
    open: number;
    high: number;
    low: number;
    close: number;
};

type PriceCandlestickChartEchartsProps = {
    candles: PriceCandle[];
    formatFiat: (amountUsd: number) => string;
};

export function PriceCandlestickChartEcharts({
    candles,
    formatFiat,
}: PriceCandlestickChartEchartsProps) {
    const option = useMemo(() => {
        const lows = candles.map((candle) => candle.low);
        const highs = candles.map((candle) => candle.high);
        const minPrice = lows.length > 0 ? Math.min(...lows) : 0;
        const maxPrice = highs.length > 0 ? Math.max(...highs) : 1;
        const padding = Math.max(0.1, (maxPrice - minPrice) * 0.18);
        const yMin = Math.max(0, minPrice - padding);
        const yMax = maxPrice + padding;
        const ySpan = Math.max(0.0001, yMax - yMin);
        const yAxisInterval = ySpan / 4;
        const axisPrecision = ySpan < 1 ? 3 : ySpan < 10 ? 2 : 2;

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
                        color: "rgba(16, 185, 129, 0.35)",
                        width: 1,
                        type: "dashed",
                    },
                },
                backgroundColor: "var(--background-swap-container)",
                borderColor: "var(--swap-container-border)",
                textStyle: { color: "#333", fontSize: 11 },
                formatter: (params: Array<{ axisValue?: string; dataIndex?: number }>) => {
                    const dataPoint = params.find((entry) => typeof entry.dataIndex === "number");
                    const dataIndex = dataPoint?.dataIndex;
                    if (dataIndex === undefined) return "";
                    const candle = candles[dataIndex];
                    if (!candle) return "";
                    return [
                        candle.label,
                        `O <b>${formatFiat(candle.open)}</b>`,
                        `H <b>${formatFiat(candle.high)}</b>`,
                        `L <b>${formatFiat(candle.low)}</b>`,
                        `C <b>${formatFiat(candle.close)}</b>`,
                    ].join("<br/>");
                },
            },
            xAxis: {
                type: "category",
                data: candles.map((candle) => candle.label),
                boundaryGap: true,
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { show: false },
                splitLine: { show: false },
            },
            yAxis: {
                type: "value",
                position: "right",
                min: yMin,
                max: yMax,
                interval: yAxisInterval,
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
                        const formatted = new Intl.NumberFormat(undefined, {
                            minimumFractionDigits: axisPrecision,
                            maximumFractionDigits: axisPrecision,
                        }).format(numeric);
                        return `{tick|${formatted}}`;
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
                    type: "candlestick",
                    data: candles.map((candle) => [candle.open, candle.close, candle.low, candle.high]),
                    itemStyle: {
                        color: "#22c55e",
                        color0: "#ef4444",
                        borderColor: "#22c55e",
                        borderColor0: "#ef4444",
                    },
                    barMaxWidth: 14,
                    emphasis: {
                        itemStyle: {
                            borderWidth: 2,
                        },
                    },
                },
            ],
        };
    }, [candles, formatFiat]);

    return <ReactECharts echarts={dashboardEcharts} option={option} notMerge lazyUpdate style={{ height: "8rem", width: "100%" }} />;
}
