import type { QueryResponse } from '../views/DataExplorer';

export type ChartResult = { chartError: string } | Record<string, any>;

export const isChartError = (r: ChartResult | null): r is { chartError: string } =>
  !!r && typeof (r as any).chartError === 'string';

export const buildChartOption = (type: 'line' | 'bar', result: QueryResponse): ChartResult | null => {
  if (!result.columns || !result.data || result.data.length === 0) return null;

  const timeIndex = result.columns.findIndex(c => c.toLowerCase() === 'time');
  const xColIndex = timeIndex !== -1 ? timeIndex : 0;

  // Classify columns into numeric (Y values) and string (potential tag/group-by)
  const numericCols: { name: string; index: number }[] = [];
  const stringCols: { name: string; index: number }[] = [];

  result.columns.forEach((col, idx) => {
    if (idx === xColIndex) return;
    const firstNonNull = result.data!.find(row => row[idx] !== null && row[idx] !== undefined);
    if (!firstNonNull) return;
    if (typeof firstNonNull[idx] === 'number') {
      numericCols.push({ name: col, index: idx });
    } else if (typeof firstNonNull[idx] === 'string') {
      stringCols.push({ name: col, index: idx });
    }
  });

  let series: any[] = [];

  // Auto group-by mode: exactly 1 numeric + 1 string (tag) column
  // e.g. SELECT time, E, dn → one line per dn value, no PIVOT needed
  if (numericCols.length === 1 && stringCols.length === 1) {
    const tagCol = stringCols[0];
    const valueCol = numericCols[0];

    // Collect unique tag values and time values (preserve insertion order)
    const tagValues = Array.from(new Set(result.data.map(row => String(row[tagCol.index] ?? ''))));
    const rawTimes = Array.from(new Set(result.data.map(row => String(row[xColIndex] ?? ''))));
    // Build lookup: tag → rawTime → value
    const lookup = new Map<string, Map<string, number | null>>();
    tagValues.forEach(tag => lookup.set(tag, new Map()));
    result.data.forEach(row => {
      const tag = String(row[tagCol.index] ?? '');
      const t = String(row[xColIndex] ?? '');
      const v = row[valueCol.index];
      lookup.get(tag)?.set(t, v !== null && v !== undefined ? v : null);
    });

    series = tagValues.map(tag => ({
      name: tag,
      type,
      smooth: true,
      showSymbol: false,
      emphasis: { focus: 'series' },
      data: rawTimes
        .map(t => [new Date(t).getTime(), lookup.get(tag)?.get(t) ?? null] as [number, number | null])
        .filter((item): item is [number, number] => item[1] != null)
        .sort((a, b) => a[0] - b[0]),
      lineStyle: type === 'line' ? { width: 2 } : undefined,
      connectNulls: false,
    }));
  } else {
    // Normal mode: one series per numeric column
    if (numericCols.length === 0) {
      // Build a helpful diagnostic message
      const allStringCols = stringCols.map(c => `"${c.name}"`).join('、');
      const reason = allStringCols
        ? `列 ${allStringCols} 为字符串类型，无法用于 Y 轴。`
        : '查询结果中没有数值列。';
      return {
        chartError: `${reason}请在 SQL 中选取数值列，或将 Cell 类型改为 Table。`
      };
    }

    series = numericCols.map(s => ({
      name: s.name,
      type,
      smooth: true,
      showSymbol: false,
      emphasis: { focus: 'series' },
      data: result.data!
        .map(row => {
          const ts = new Date(String(row[xColIndex])).getTime();
          const val = row[s.index];
          return val !== null && val !== undefined ? ([ts, val] as [number, number]) : null;
        })
        .filter((item): item is [number, number] => item != null)
        .sort((a, b) => a[0] - b[0]),
      lineStyle: type === 'line' ? { width: 2 } : undefined,
      connectNulls: false,
    }));
  }

  if (series.length === 0) return null;

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
      type: 'time',
      boundaryGap: type === 'bar',
      axisLine: { lineStyle: { color: '#4b5563' } },
      axisLabel: {
        color: '#9ca3af',
        hideOverlap: true,
        fontSize: 10,
      }
    },
    yAxis: {
      type: 'value',
      scale: true,
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
