export type Mode = 'mix' | 'long' | 'half'
export type Kind = 'asfalt' | 'trava'
export type CornerKey = 'tl' | 'tr' | 'br' | 'bl'
export type SideKey = 't' | 'r' | 'b' | 'l'

export interface Shape {
  id: string
  name: string
  kind: Kind
  wpx: number
  hpx: number
  r: Record<CornerKey, number>
  sides: Record<SideKey, boolean>
  mode: Mode
  x: number // cm, world position of the shape's top-left before rotation
  y: number
  rot: number
  // imported outline (px, relative to its bounding box); when present it replaces the rectangle
  path?: { pts: [number, number][]; breaks: number[] }
  edgeCurbs?: boolean[] // per outline edge; missing entries count as curbed
}

export interface Settings {
  spx: number // scale: spx pixels on the drawing ...
  scm: number // ... equal scm centimetres
  gap: number
  pL: number
  pS: number
}

export interface Ruler { id: string; a: [number, number]; b: [number, number] } // world cm
export interface Join { id: string; name: string; members: string[]; mode: Mode; edgeCurbs?: boolean[] }
export interface Plan { version: 1; settings: Settings; shapes: Shape[]; rulers?: Ruler[]; joins?: Join[] }

export const DEFAULT_SETTINGS: Settings = { spx: 214, scm: 650, gap: 1, pL: 6.6, pS: 2.39 }

// Croatian labels; pass them through t() where they are shown
export const MODES: Record<Mode, string> = {
  mix: '100 + 33 cm',
  long: 'Samo 100 cm',
  half: '100 cm, luk od polovica',
}
export const KINDS: Record<Kind, string> = { asfalt: 'Asfalt', trava: 'Trava' }
