// Small stroke icons drawn on a 24-unit grid
const PATHS: Record<string, string> = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  pointer: 'M6 3l12 7-5.5 1.5L10 17z',
  hand: 'M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-6.5V5a1.5 1.5 0 0 1 3 0v7m0-5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.6-2.2L4 15a1.5 1.5 0 0 1 2.2-2L8 14.5',
  grid: 'M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  close: 'M6 6l12 12M18 6L6 18',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  'rotate-left': 'M4 4v5h5M4.6 9A8 8 0 1 1 4 13',
  'rotate-right': 'M20 4v5h-5M19.4 9A8 8 0 1 0 20 13',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  ruler: 'M3 16.5L16.5 3 21 7.5 7.5 21zM7 12.5l2 2M10 9.5l2 2M13 6.5l2 2',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12',
  printer: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  help: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5M12 17.5v.01',
}

export function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
