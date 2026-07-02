export type GlyphDiagnosticsStatus = 'idle' | 'queued' | 'running' | 'complete' | 'failed' | 'skipped';

export interface GlyphSample {
  code: number;
  codeHex: string;
  unicode: string | null;
  unicodeCodePoints: string;
  advanceX: number;
  advanceY: number;
  x: number;
  y: number;
  renderingMode: number;
}

export interface GlyphFontMetadata {
  name: string;
  subtype: string;
  implementation: string;
  encoding: string | null;
  descendantSubtype: string | null;
  cidSystem: string | null;
  embedded: boolean;
  damaged: boolean;
  vertical: boolean;
  hasToUnicode: boolean;
}

export type GlyphRepairPlan =
  | 'no-text'
  | 'mapping-present'
  | 'deterministic-to-unicode-candidate'
  | 'existing-to-unicode-needs-review'
  | 'ocr-assisted-mapping-candidate';

export interface GlyphFontReport {
  resourceName: string;
  font: GlyphFontMetadata;
  glyphEvents: number;
  uniqueCodes: number;
  unmappedGlyphs: number;
  privateUseGlyphs: number;
  replacementGlyphs: number;
  invisibleGlyphs: number;
  repairPlan: GlyphRepairPlan;
  samples: GlyphSample[];
}

export interface GlyphPageReport {
  pageNumber: number;
  fontCount: number;
  glyphEvents: number;
  unmappedGlyphs: number;
  suspectScore: number;
  fonts: GlyphFontReport[];
}

export interface GlyphDiagnosticsReport {
  pageCount: number;
  encrypted: boolean;
  signatureCount: number;
  pagesAnalyzed: number;
  fontCount: number;
  glyphEvents: number;
  unmappedGlyphs: number;
  deterministicCandidateFonts: number;
  pages: GlyphPageReport[];
}
