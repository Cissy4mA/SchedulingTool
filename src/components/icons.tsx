type P = { size?: number; color?: string }

export const ChevronLeft = ({ size = 18, color = '#6B7280' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M15 5l-7 7 7 7" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const ChevronRight = ({ size = 18, color = '#6B7280' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M9 5l7 7-7 7" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const Plus = ({ size = 24, color = '#fff' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M12 5v14M5 12h14" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
  </svg>
)

export const Close = ({ size = 18, color = '#9AA2B1' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </svg>
)

export const CalendarIcon = ({ size = 20, color = '#6B7280' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke={color} strokeWidth={2} />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </svg>
)

export const ListIcon = ({ size = 20, color = '#6B7280' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M8 6h12M8 12h12M8 18h12" stroke={color} strokeWidth={2} strokeLinecap="round" />
    <circle cx="4" cy="6" r="1.4" fill={color} />
    <circle cx="4" cy="12" r="1.4" fill={color} />
    <circle cx="4" cy="18" r="1.4" fill={color} />
  </svg>
)

export const TodayIcon = ({ size = 20, color = '#6B7280' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="8" stroke={color} strokeWidth={2} />
    <circle cx="12" cy="12" r="2.6" fill={color} />
  </svg>
)

export const SearchIcon = ({ size = 16, color = '#9AA2B1' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="11" cy="11" r="7" stroke={color} strokeWidth={2} />
    <path d="M16 16l4 4" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </svg>
)

export const WeekIcon = ({ size = 18, color = '#6B7280' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth={2} />
    <path d="M12 7.5V12l3 1.8" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const DayIcon = ({ size = 18, color = '#6B7280' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="4.5" stroke={color} strokeWidth={2} />
    <path
      d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    />
  </svg>
)

export const BellIcon = ({ size = 18, color = '#6B7280' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"
      stroke={color}
      strokeWidth={2}
      strokeLinejoin="round"
    />
    <path d="M10.5 20a1.8 1.8 0 0 0 3 0" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </svg>
)

// AI 助手：四角星
export const SparkleIcon = ({ size = 18, color = '#6B7280' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M12 3c.6 3.8 2.2 5.9 6 6.5-3.8.6-5.4 2.7-6 6.5-.6-3.8-2.2-5.9-6-6.5 3.8-.6 5.4-2.7 6-6.5zM19 14c.3 1.9 1.1 2.9 3 3.2-1.9.3-2.7 1.3-3 3.2-.3-1.9-1.1-2.9-3-3.2 1.9-.3 2.7-1.3 3-3.2z"
      fill={color}
    />
  </svg>
)