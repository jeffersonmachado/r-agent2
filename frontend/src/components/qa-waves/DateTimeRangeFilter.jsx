import React from 'react';

export function DateTimeRangeFilter({ filters, onChange, onClear }) {
  return (
    <div className="qa-waves-filter-grid">
      <input type="date" name="startDate" value={filters.startDate} onChange={onChange} />
      <input type="time" name="startTime" value={filters.startTime} onChange={onChange} />
      <input type="date" name="endDate" value={filters.endDate} onChange={onChange} />
      <input type="time" name="endTime" value={filters.endTime} onChange={onChange} />
      <select name="status" value={filters.status} onChange={onChange}>
        <option value="">Todos os status</option>
        <option value="success">Success</option>
        <option value="failure">Failure</option>
        <option value="executing">Executing</option>
        <option value="pending">Pending</option>
      </select>
      <button type="button" onClick={onClear}>Limpar</button>
    </div>
  );
}

export default DateTimeRangeFilter;
