import * as dashboardEcharts from "echarts/core";
import { BarChart, CandlestickChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

dashboardEcharts.use([
  BarChart, CandlestickChart, LineChart, PieChart, ScatterChart,
  GridComponent, TooltipComponent, CanvasRenderer,
]);

export { dashboardEcharts };
