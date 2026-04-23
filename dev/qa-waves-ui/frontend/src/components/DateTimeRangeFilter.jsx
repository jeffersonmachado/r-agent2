export default function DateTimeRangeFilter({ filters, onChange }) {
  return (
    <div className="datetime-grid">
      <label>
        Data inicial
        <input
          type="date"
          value={filters.startDate}
          onChange={(event) => onChange('startDate', event.target.value)}
        />
      </label>
      <label>
        Hora inicial
        <input
          type="time"
          value={filters.startTime}
          onChange={(event) => onChange('startTime', event.target.value)}
        />
      </label>
      <label>
        Data final
        <input
          type="date"
          value={filters.endDate}
          onChange={(event) => onChange('endDate', event.target.value)}
        />
      </label>
      <label>
        Hora final
        <input
          type="time"
          value={filters.endTime}
          onChange={(event) => onChange('endTime', event.target.value)}
        />
      </label>
    </div>
  );
}
