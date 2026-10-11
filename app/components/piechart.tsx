'use client';

import { ResponsivePie } from '@nivo/pie'

type chartData = {
    id: string,
    label: string,
    value: number,
    color: string
};

type props = {
    data: chartData[];
};

export function PieChart( {data}: props ) {


    return (
        <ResponsivePie 
            data={data}
            colors={{ datum: "data.color" }}
            margin={{ top: 40, right: 100, bottom: 100, left: 100 }}
            innerRadius={0.5}
            padAngle={0.6}
                cornerRadius={2}
                activeOuterRadiusOffset={8}
                arcLinkLabelsSkipAngle={10}
                arcLinkLabelsTextColor="#333333"
                arcLinkLabelsThickness={2}
                arcLinkLabelsColor={{ from: 'color' }}
                arcLabelsSkipAngle={10}
                arcLabelsTextColor={{ from: 'color', modifiers: [['darker', 2]] }}
                layers={[
                    'arcs',
                    'arcLabels',
                    'arcLinkLabels',
                    'legends'
                ]}
                /*
                legends={[
                    {
                        anchor: 'bottom',
                        direction: 'column',
                        justify: false,
                        translateX: -150,
                        translateY: 50,
                        itemWidth: 100,
                        itemHeight: 18,
                        symbolShape: 'circle'
                    }
        ]}
                    */
    />
)}
