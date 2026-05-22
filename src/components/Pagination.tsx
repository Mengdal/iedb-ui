import React from 'react';
import { useTranslation } from 'react-i18next';

interface PaginationProps {
  offset: number;
  pageSize: number;
  total: number;
  onOffsetChange: (offset: number) => void;
  /** i18n namespace for pageOf and totalRecords keys (default: 'common') */
  i18nNs?: string;
  totalLabel?: string;
  prevLabel?: string;
  nextLabel?: string;
  pageOfLabel?: string;
}

const Pagination: React.FC<PaginationProps> = ({
  offset,
  pageSize,
  total,
  onOffsetChange,
  totalLabel,
  prevLabel,
  nextLabel,
  pageOfLabel,
}) => {
  const { t } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;

  if (total === 0) return null;

  return (
    <div className="audit-pagination">
      <span className="audit-pagination-info">
        {totalLabel || t('common.pagination.totalRecords', { count: total })}
      </span>
      <div className="audit-pagination-controls">
        <button
          disabled={offset === 0}
          onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
        >
          {prevLabel || t('common.pagination.prevPage')}
        </button>
        <span className="audit-pagination-info">
          {pageOfLabel || t('common.pagination.pageOf', { page: currentPage, total: totalPages })}
        </span>
        <button
          disabled={offset + pageSize >= total}
          onClick={() => onOffsetChange(offset + pageSize)}
        >
          {nextLabel || t('common.pagination.nextPage')}
        </button>
      </div>
    </div>
  );
};

export default Pagination;
