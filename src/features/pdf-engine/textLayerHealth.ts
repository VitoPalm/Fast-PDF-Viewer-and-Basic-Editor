import { type PDFPageProxy } from 'pdfjs-dist';

export type TextLayerHealthStatus =
  | 'healthy'
  | 'hiddenOcr'
  | 'sparse'
  | 'suspectEncoding'
  | 'imageOnly'
  | 'unsupported';

export interface TextLayerHealth {
  status: TextLayerHealthStatus;
  reasons: string[];
  itemCount: number;
  sample: string;
  hiddenTextRatio: number;
}

type TextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>;
type TextContentItem = TextContent['items'][number];
type TextItem = Extract<TextContentItem, { str: string }>;
type TextItemWithRenderingMode = TextItem & { renderingMode: number };

const SAMPLE_LIMIT = 500;
const MIN_HEALTHY_TEXT_LENGTH = 20;
const HIDDEN_TEXT_RATIO_THRESHOLD = 0.8;
const CONTROL_CHARACTER_RATIO_THRESHOLD = 0.05;
const SYMBOL_NOISE_RATIO_THRESHOLD = 0.35;

const hasTextString = (item: TextContentItem): item is TextItem => (
  'str' in item && typeof item.str === 'string'
);

const hasRenderingMode = (item: TextItem): item is TextItemWithRenderingMode => (
  typeof item === 'object' &&
  item !== null &&
  'renderingMode' in item &&
  typeof (item as { renderingMode?: unknown }).renderingMode === 'number'
);

const hasControlCharacter = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return (code < 32 && char !== '\n' && char !== '\r' && char !== '\t') || (code >= 127 && code <= 159);
};

const isCommonReadableCharacter = (char: string): boolean => (
  /[\p{Letter}\p{Number}\s.,;:!?'"()[\]{}\-_/@#$%&*+=<>|~`^]/u.test(char)
);

const ratio = (count: number, total: number): number => (total === 0 ? 0 : count / total);

export const analyzeTextLayerHealth = (textContent: TextContent): TextLayerHealth => {
  const textItems = textContent.items.filter(hasTextString);
  const itemCount = textItems.length;
  const fullText = textItems.map(item => item.str).join(' ');
  const normalizedText = fullText.replace(/\s+/g, ' ').trim();
  const sample = normalizedText.slice(0, SAMPLE_LIMIT);
  const hiddenTextCount = textItems.filter(hasRenderingMode).filter(item => item.renderingMode === 3).length;
  const hiddenTextRatio = ratio(hiddenTextCount, itemCount);
  const reasons: string[] = [];

  if (itemCount === 0 || normalizedText.length === 0) {
    return {
      status: 'imageOnly',
      reasons: ['no-text'],
      itemCount,
      sample,
      hiddenTextRatio,
    };
  }

  if (hiddenTextRatio >= HIDDEN_TEXT_RATIO_THRESHOLD) {
    reasons.push('mostly-hidden-text');
    return {
      status: 'hiddenOcr',
      reasons,
      itemCount,
      sample,
      hiddenTextRatio,
    };
  }

  if (/[\uE000-\uF8FF]/u.test(normalizedText)) {
    reasons.push('private-use-characters');
  }

  if (normalizedText.includes('\uFFFD')) {
    reasons.push('replacement-characters');
  }

  const characters = [...normalizedText];
  const controlCharacterRatio = ratio(characters.filter(hasControlCharacter).length, characters.length);
  if (controlCharacterRatio > CONTROL_CHARACTER_RATIO_THRESHOLD) {
    reasons.push('control-character-ratio');
  }

  const nonWhitespaceCharacters = characters.filter(char => !/\s/u.test(char));
  const symbolNoiseRatio = ratio(
    nonWhitespaceCharacters.filter(char => !isCommonReadableCharacter(char)).length,
    nonWhitespaceCharacters.length,
  );
  if (
    normalizedText.length >= MIN_HEALTHY_TEXT_LENGTH &&
    symbolNoiseRatio > SYMBOL_NOISE_RATIO_THRESHOLD
  ) {
    reasons.push('symbol-noise-ratio');
  }

  if (reasons.length > 0) {
    return {
      status: 'suspectEncoding',
      reasons,
      itemCount,
      sample,
      hiddenTextRatio,
    };
  }

  if (itemCount < 5 || normalizedText.length < MIN_HEALTHY_TEXT_LENGTH) {
    return {
      status: 'sparse',
      reasons: ['low-text-count'],
      itemCount,
      sample,
      hiddenTextRatio,
    };
  }

  return {
    status: 'healthy',
    reasons,
    itemCount,
    sample,
    hiddenTextRatio,
  };
};

export const isSuspectTextHealth = (status: TextLayerHealthStatus): boolean => (
  status === 'suspectEncoding' || status === 'unsupported'
);
