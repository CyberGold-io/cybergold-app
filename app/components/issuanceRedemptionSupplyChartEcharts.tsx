"use client";

import { useMemo, useRef } from "react";
import ReactECharts from "echarts-for-react/lib/core";
import { dashboardEcharts } from "./dashboardCharts";

type FlowPoint = {
    label: string;
    mint: number;
    redeem: number;
    supply: number;
};

type IssuanceRedemptionSupplyChartEchartsProps = {
    series: FlowPoint[];
    locale: string;
};

export function IssuanceRedemptionSupplyChartEcharts({
    series,
    locale,
}: IssuanceRedemptionSupplyChartEchartsProps) {
    const supplyDimmedRef = useRef(false);

    const option = useMemo(() => {
        const mintValues = series.map((entry) => Math.max(0, entry.mint));
        const redeemValues = series.map((entry) => Math.max(0, entry.redeem));
        const signedRedeemValues = redeemValues.map((value) => -value);
        const netFlowValues = series.map((entry) => entry.mint - entry.redeem);
        const netFlowDotData = netFlowValues.map((value) => ({
            value,
            itemStyle: {
                color: "#ffffff",
                borderColor: value === 0 ? "rgba(161, 161, 170, 0.9)" : value > 0 ? "#22c55e" : "#ef4444",
                borderWidth: 1.8,
            },
        }));
        const supplyValues = series.map((entry) => entry.supply);

        const maxFlowAbs = Math.max(...mintValues, ...redeemValues, 1);
        const paddedFlowAbs = Math.max(1, maxFlowAbs * 1.12);
        const flowInterval = paddedFlowAbs / 2;
        const flowAxisBound = flowInterval * 2;

        const minSupply = supplyValues.length > 0 ? Math.min(...supplyValues) : 0;
        const maxSupply = supplyValues.length > 0 ? Math.max(...supplyValues) : 1;
        const supplyPadding = Math.max(1, (maxSupply - minSupply) * 0.14);
        const supplyAxisMin = Math.max(0, minSupply - supplyPadding);
        const supplyAxisMax = Math.max(supplyAxisMin + 1, maxSupply + supplyPadding);
        const supplyInterval = (supplyAxisMax - supplyAxisMin) / 4;

        const compactFormatter = new Intl.NumberFormat(locale, {
            notation: "compact",
            maximumFractionDigits: 3,
        });
        const amountFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });

        return {
            animation: true,
            animationDuration: 350,
            animationDurationUpdate: 0,
            grid: {
                top: 12,
                right: 72,
                bottom: 8,
                left: 56,
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
                    const net = point.mint - point.redeem;

                    return [
                        point.label,
                        `Issuance: <b>${amountFormatter.format(point.mint)} CYGLD</b>`,
                        `Redemption: <b>${amountFormatter.format(point.redeem)} CYGLD</b>`,
                        `Net flow: <b>${net >= 0 ? "+" : "-"}${amountFormatter.format(Math.abs(net))} CYGLD</b>`,
                        `Supply: <b>${amountFormatter.format(point.supply)} CYGLD</b>`,
                    ].join("<br/>");
                },
            },
            xAxis: {
                type: "category",
                data: series.map((entry) => entry.label),
                boundaryGap: true,
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { show: false },
                splitLine: { show: false },
            },
            yAxis: [
                {
                    type: "value",
                    position: "left",
                    min: -flowAxisBound,
                    max: flowAxisBound,
                    interval: flowInterval,
                    splitNumber: 4,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: {
                        show: true,
                        color: "var(--text-muted)",
                        fontSize: 10,
                        margin: 8,
                        formatter: (value: number | string) => {
                            const numeric = Number(value);
                            if (!Number.isFinite(numeric)) return "";
                            const sign = numeric > 0 ? "+" : "";
                            return `{tick|${sign}${compactFormatter.format(numeric)}}`;
                        },
                        rich: {
                            tick: {
                                width: 48,
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
                {
                    type: "value",
                    position: "right",
                    min: supplyAxisMin,
                    max: supplyAxisMax,
                    interval: supplyInterval,
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
                            return `{tick|${compactFormatter.format(numeric)}}`;
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
                    splitLine: { show: false },
                },
            ],
            series: [
                {
                    type: "bar",
                    name: "Issuance",
                    stack: "flow",
                    data: mintValues,
                    yAxisIndex: 0,
                    barWidth: "42%",
                    itemStyle: {
                        color: "#22c55e",
                        borderRadius: [2, 2, 0, 0],
                    },
                    emphasis: { focus: "none" },
                    z: 3,
                },
                {
                    type: "bar",
                    name: "Redemption",
                    stack: "flow",
                    data: signedRedeemValues,
                    yAxisIndex: 0,
                    barWidth: "42%",
                    itemStyle: {
                        color: "#ef4444",
                        borderRadius: [0, 0, 2, 2],
                    },
                    emphasis: { focus: "none" },
                    z: 3,
                },
                {
                    type: "line",
                    id: "flow-supply-line",
                    name: "Supply",
                    data: supplyValues,
                    yAxisIndex: 1,
                    smooth: 0.2,
                    showSymbol: false,
                    lineStyle: {
                        color: "hsl(46, 71%, 56%)",
                        width: 2.3,
                        shadowBlur: 8,
                        shadowColor: "rgba(212, 175, 55, 0.22)",
                    },
                    itemStyle: {
                        color: "hsl(46, 71%, 56%)",
                    },
                    emphasis: { focus: "series" },
                    z: 6,
                },
                {
                    type: "scatter",
                    name: "Net flow",
                    data: netFlowDotData,
                    yAxisIndex: 0,
                    symbol: "circle",
                    symbolSize: 6,
                    silent: true,
                    tooltip: { show: false },
                    emphasis: {
                        focus: "none",
                        scale: false,
                    },
                    blur: {
                        itemStyle: {
                            opacity: 0.22,
                        },
                    },
                    z: 5,
                },
            ],
        };
    }, [locale, series]);

    const setSupplyDimmed = (
        chart: {
            setOption: (option: object, opts?: { lazyUpdate?: boolean }) => void;
        },
        dimmed: boolean
    ) => {
        if (supplyDimmedRef.current === dimmed) return;
        supplyDimmedRef.current = dimmed;
        chart.setOption(
            {
                series: [
                    {
                        id: "flow-supply-line",
                        lineStyle: { opacity: dimmed ? 0.28 : 1 },
                        itemStyle: { opacity: dimmed ? 0.28 : 1 },
                    },
                ],
            },
            { lazyUpdate: true }
        );
    };

    const onEvents = useMemo(
        () => ({
            mouseover: (
                params: { componentType?: string; seriesType?: string; seriesName?: string },
                chart: {
                    dispatchAction: (action: { type: string; seriesName?: string }) => void;
                    setOption: (option: object, opts?: { lazyUpdate?: boolean }) => void;
                }
            ) => {
                if (params.componentType !== "series") return;
                if (params.seriesName === "Supply") {
                    setSupplyDimmed(chart, false);
                    return;
                }
                if (params.seriesType === "bar") {
                    setSupplyDimmed(chart, true);
                }
            },
            mouseout: (
                _params: unknown,
                chart: {
                    dispatchAction: (action: { type: string; seriesName?: string }) => void;
                    setOption: (option: object, opts?: { lazyUpdate?: boolean }) => void;
                }
            ) => {
                setSupplyDimmed(chart, false);
            },
            globalout: (
                _params: unknown,
                chart: {
                    dispatchAction: (action: { type: string; seriesName?: string }) => void;
                    setOption: (option: object, opts?: { lazyUpdate?: boolean }) => void;
                }
            ) => {
                setSupplyDimmed(chart, false);
            },
        }),
        []
    );

    return <ReactECharts echarts={dashboardEcharts} option={option} onEvents={onEvents} notMerge lazyUpdate style={{ height: "9rem", width: "100%" }} />;
}
