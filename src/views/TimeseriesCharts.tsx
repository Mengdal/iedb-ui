import React, { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTranslation } from 'react-i18next';
import { useServers } from '../contexts/ServerContext';
import { useApiFetch } from '../hooks/useApiFetch';
import { usePolling } from '../hooks/usePolling';
import './TimeseriesCharts.css';

interface TimeseriesPoint {
  timestamp: string;
  values: Record<string, number>;
}

interface TimeseriesResponse {
  data: TimeseriesPoint[];
}

const buildChartOption = (title: string, data: TimeseriesPoint[], noDataText: string) => {
  if (!data || data.length === 0) {
    return {
      title: { text: title + ` (${noDataText})`, left: 'center', top: 'center', textStyle: { color: '#9ca3af' } }
    };
  }

  // Get keys from all items just to be safe, but usually they are uniform
  const keySet = new Set<string>();
  data.forEach(d => Object.keys(d.values).forEach(k => keySet.add(k)));
  const keys = Array.from(keySet);
  
  const timestamps = data.map(d => {
    const date = new Date(d.timestamp);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
  });

  const series = keys.map((key) => ({
    name: key,
    type: 'line',
    smooth: true,
    showSymbol: false,
    emphasis: { focus: 'series' },
    data: data.map(d => d.values[key] || 0),
    lineStyle: { width: 2 }
  }));

  return {
    title: { 
      text: title, 
      left: 16, 
      top: 16, 
      textStyle: { color: '#f3f4f6', fontSize: 16, fontWeight: 600 } 
    },
    tooltip: { 
      trigger: 'axis',
      backgroundColor: 'rgba(24, 24, 27, 0.9)',
      borderColor: '#3f3f46',
      textStyle: { color: '#fff', fontSize: 12 },
      axisPointer: { type: 'cross', label: { backgroundColor: '#6b7280' } }
    },
    legend: { 
      type: 'scroll',
      top: 16,
      right: 16,
      width: '50%',
      textStyle: { color: '#9ca3af', fontSize: 12 },
      pageIconColor: '#3b82f6',
      pageTextStyle: { color: '#9ca3af' }
    },
    grid: { left: '3%', right: '4%', bottom: '3%', top: 60, containLabel: true },
    xAxis: { 
      type: 'category', 
      boundaryGap: false, 
      data: timestamps, 
      axisLine: { lineStyle: { color: '#4b5563' } }, 
      axisLabel: { color: '#9ca3af' } 
    },
    yAxis: { 
      type: 'value', 
      splitLine: { lineStyle: { color: '#374151', type: 'dashed' } }, 
      axisLabel: { color: '#9ca3af' } 
    },
    series
  };
};

const TimeseriesCharts: React.FC = () => {
  const { t } = useTranslation();
  const { activeServer } = useServers();
  const { apiFetch } = useApiFetch({ handleLicense: false, handleFeature: false });
  const [systemData, setSystemData] = useState<TimeseriesPoint[]>([]);
  const [apiData, setApiData] = useState<TimeseriesPoint[]>([]);
  const [appData, setAppData] = useState<TimeseriesPoint[]>([]);

  const fetchData = React.useCallback(async () => {
    if (!activeServer) return;
    try {
      const [sysRes, apiRes, appRes] = await Promise.all([
        apiFetch('/api/v1/metrics/timeseries/system').catch(() => null),
        apiFetch('/api/v1/metrics/timeseries/api').catch(() => null),
        apiFetch('/api/v1/metrics/timeseries/application').catch(() => null)
      ]);

      if (sysRes) {
        setSystemData((sysRes as TimeseriesResponse).data || []);
      }
      if (apiRes) {
        setApiData((apiRes as TimeseriesResponse).data || []);
      }
      if (appRes) {
        setAppData((appRes as TimeseriesResponse).data || []);
      }
    } catch (err) {
      console.error("Failed to fetch timeseries data", err);
    }
  }, [activeServer, apiFetch]);

  usePolling(fetchData, 10000, { enabled: !!activeServer });

  const noDataText = t('views.timeseries.noData');

  const sysOption = useMemo(() => buildChartOption(t('views.timeseries.systemMetricsTrend'), systemData, noDataText), [systemData, noDataText, t]);
  const apiOption = useMemo(() => buildChartOption(t('views.timeseries.apiPerformanceTrend'), apiData, noDataText), [apiData, noDataText, t]);
  const appOption = useMemo(() => buildChartOption(t('views.timeseries.dbOperationsTrend'), appData, noDataText), [appData, noDataText, t]);

  return (
    <div className="timeseries-charts-container">
      <div className="chart-card">
        <ReactECharts 
          option={sysOption} 
          style={{ height: '300px', width: '100%' }} 
          opts={{ renderer: 'canvas' }} 
        />
      </div>
      <div className="chart-card">
        <ReactECharts 
          option={apiOption} 
          style={{ height: '300px', width: '100%' }} 
          opts={{ renderer: 'canvas' }} 
        />
      </div>
      <div className="chart-card">
        <ReactECharts 
          option={appOption} 
          style={{ height: '300px', width: '100%' }} 
          opts={{ renderer: 'canvas' }} 
        />
      </div>
    </div>
  );
};

export default React.memo(TimeseriesCharts);
