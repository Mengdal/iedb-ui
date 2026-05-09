import type { QueryResponse } from '../views/DataExplorer';

export const buildChartOption = (type: 'line' | 'bar', result: QueryResponse) => {
  if (!result.columns || !result.data || result.data.length === 0) return {};

  const timeIndex = result.columns.findIndex(c => c.toLowerCase() === 'time');
  const xColIndex = timeIndex !== -1 ? timeIndex : 0;

  const numericSeries: { name: string; index: number }[] = [];
  result.columns.forEach((col, idx) => {
    if (idx !== xColIndex) {
      const firstNonNull = result.data!.find(row => row[idx] !== null && row[idx] !== undefined);
      if (firstNonNull && typeof firstNonNull[idx] === 'number') {
        numericSeries.push({ name: col, index: idx });
      }
    }
  });

  const xAxisData = result.data.map(row => {
    const val = row[xColIndex];
    if (typeof val === 'string' && val.includes('T')) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
      }
    }
    return val;
  });

  const series = numericSeries.map(s => ({
    name: s.name,
    type: type,
    smooth: true,
    showSymbol: false,
    emphasis: { focus: 'series' },
    data: result.data!.map(row => row[s.index] || 0),
    lineStyle: type === 'line' ? { width: 2 } : undefined
  }));

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(24, 24, 27, 0.9)',
      borderColor: '#3f3f46',
      textStyle: { color: '#fff', fontSize: 12 },
      axisPointer: { type: 'cross', label: { backgroundColor: '#6b7280' } }
    },
    legend: {
      type: 'scroll',
      top: 10,
      textStyle: { color: '#9ca3af', fontSize: 12 },
      pageIconColor: '#3b82f6',
      pageTextStyle: { color: '#9ca3af' }
    },
    grid: { left: '3%', right: '4%', bottom: '3%', top: 50, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: type === 'bar',
      data: xAxisData,
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

export const downloadFile = (content: string, filename: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
