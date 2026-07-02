import { describe, expect, it } from 'vitest';
import { analyzeTextLayerHealth, isSuspectTextHealth } from './textLayerHealth';

type TextContentInput = Parameters<typeof analyzeTextLayerHealth>[0];
type TextContentItemInput = TextContentInput['items'][number];

const textItem = (str: string, renderingMode?: number): TextContentItemInput => ({
  str,
  dir: 'ltr',
  transform: [1, 0, 0, 1, 0, 0],
  width: str.length * 8,
  height: 12,
  fontName: 'f1',
  hasEOL: false,
  ...(renderingMode === undefined ? {} : { renderingMode }),
}) as TextContentItemInput;

const textContent = (items: TextContentItemInput[]): TextContentInput => ({
  items,
  styles: {},
  lang: null,
});

describe('text layer health', () => {
  it('marks pages with no extracted text as image-only', () => {
    expect(analyzeTextLayerHealth(textContent([]))).toMatchObject({
      status: 'imageOnly',
      reasons: ['no-text'],
      itemCount: 0,
    });
  });

  it('detects hidden OCR from rendering mode ratio', () => {
    const health = analyzeTextLayerHealth(textContent([
      textItem('Invisible OCR line one', 3),
      textItem('Invisible OCR line two', 3),
      textItem('Invisible OCR line three', 3),
      textItem('Invisible OCR line four', 3),
      textItem('Visible footer', 0),
    ]));

    expect(health.status).toBe('hiddenOcr');
    expect(health.reasons).toContain('mostly-hidden-text');
    expect(health.hiddenTextRatio).toBe(0.8);
  });

  it('marks private-use and replacement characters as suspect encoding', () => {
    const health = analyzeTextLayerHealth(textContent([
      textItem('Broken \uE000\uE001 text \uFFFD still has enough length'),
    ]));

    expect(health.status).toBe('suspectEncoding');
    expect(health.reasons).toEqual(expect.arrayContaining([
      'private-use-characters',
      'replacement-characters',
    ]));
  });

  it('uses control character ratio as a garbled text signal', () => {
    const control = String.fromCharCode(1);
    const health = analyzeTextLayerHealth(textContent([
      textItem(`alpha${control}${control}${control} beta${control}${control}${control} gamma`),
    ]));

    expect(health.status).toBe('suspectEncoding');
    expect(health.reasons).toContain('control-character-ratio');
  });

  it('routes low-text pages to sparse scan-like handling', () => {
    expect(analyzeTextLayerHealth(textContent([textItem('p. 1')]))).toMatchObject({
      status: 'sparse',
      reasons: ['low-text-count'],
    });
  });

  it('keeps normal extracted text healthy', () => {
    const health = analyzeTextLayerHealth(textContent([
      textItem('This page contains ordinary readable text.'),
      textItem('It has enough words to be treated as selectable native text.'),
      textItem('The encoding looks normal and stable.'),
      textItem('Numbers like 12345 and punctuation are fine.'),
      textItem('Another line keeps the page out of sparse mode.'),
    ]));

    expect(health.status).toBe('healthy');
    expect(health.reasons).toEqual([]);
    expect(isSuspectTextHealth(health.status)).toBe(false);
  });

  it('treats suspect and unsupported statuses as unsafe for native text rendering', () => {
    expect(isSuspectTextHealth('suspectEncoding')).toBe(true);
    expect(isSuspectTextHealth('unsupported')).toBe(true);
    expect(isSuspectTextHealth('healthy')).toBe(false);
  });
});
