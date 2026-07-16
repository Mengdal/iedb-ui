import React, { useEffect, useRef } from 'react';
import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { sql } from '@codemirror/lang-sql';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { Check, X } from 'lucide-react';
import './SqlDiffView.css';

interface SqlDiffViewProps {
  originalSql: string;
  newSql: string;
  onAccept: (sql: string) => void;
  onReject: () => void;
  t?: (key: string, fallback?: string) => string;
}

const SqlDiffView: React.FC<SqlDiffViewProps> = ({
  originalSql,
  newSql,
  onAccept,
  onReject,
  t: translate,
}) => {
  const tn = (key: string, fallback?: string) => translate?.(key) ?? fallback ?? key;
  const containerRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);

  const hasChanges = originalSql.trim() !== newSql.trim();

  useEffect(() => {
    if (!hasChanges || !containerRef.current) return;

    const sharedExtensions = [
      sql(),
      vscodeDark,
      EditorState.readOnly.of(true),
    ];

    mergeViewRef.current = new MergeView({
      a: { doc: originalSql, extensions: sharedExtensions },
      b: { doc: newSql, extensions: sharedExtensions },
      parent: containerRef.current,
      gutter: true,
      highlightChanges: true,
    });

    return () => {
      mergeViewRef.current?.destroy();
      mergeViewRef.current = null;
    };
  }, [originalSql, newSql, hasChanges]);

  if (!hasChanges) {
    return (
      <div className="sqldiff-no-change">
        <span>{tn('ai.diffNoChange', 'AI 生成与原 SQL 一致，无需修改')}</span>
      </div>
    );
  }

  return (
    <div className="sqldiff-container">
      <div className="sqldiff-header">
        <span className="sqldiff-title">{tn('ai.diffTitle', 'SQL 变更建议')}</span>
      </div>
      <div className="sqldiff-merge-container" ref={containerRef} />
      <div className="sqldiff-actions">
        <button
          className="sqldiff-btn sqldiff-btn-accept"
          onClick={() => onAccept(newSql)}
        >
          <Check size={16} />
          <span>{tn('ai.diffAccept', '接受变更')}</span>
        </button>
        <button
          className="sqldiff-btn sqldiff-btn-reject"
          onClick={onReject}
        >
          <X size={16} />
          <span>{tn('ai.diffReject', '拒绝')}</span>
        </button>
      </div>
    </div>
  );
};

export default SqlDiffView;
