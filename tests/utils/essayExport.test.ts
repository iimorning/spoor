import { describe, it, expect, vi, afterEach } from 'vitest';
import JSZip from 'jszip';
import { downloadBlob, essayExportFilename } from '../../src/utils/downloadBlob';
import {
  buildEssayExportHtml,
  exportEssayAsDocx,
  printHtmlDocument,
} from '../../src/utils/essayExport';
import {
  parseEssayExportInlines,
  parseEssayExportMarkdown,
} from '../../src/utils/parseEssayExportMarkdown';

describe('essayExportFilename', () => {
  it('strips reserved characters and keeps a readable stem', () => {
    expect(essayExportFilename('A / B: 长文?*', 'docx')).toBe('A B 长文.docx');
    expect(essayExportFilename('   ', 'pdf')).toBe('essay.pdf');
  });
});

describe('parseEssayExportMarkdown', () => {
  it('parses headings, emphasis, lists, images, and fenced code', () => {
    const blocks = parseEssayExportMarkdown(
      ['# Title', '', 'Hello **world** and *you*.', '', '- one', '- two', '', '![图](spoor-article-media:img1)', '', '```js', 'const a = 1;', '```'].join(
        '\n',
      ),
    );
    expect(blocks).toEqual([
      { type: 'heading', level: 1, inlines: [{ type: 'text', text: 'Title' }] },
      {
        type: 'paragraph',
        inlines: [
          { type: 'text', text: 'Hello ' },
          { type: 'strong', text: 'world' },
          { type: 'text', text: ' and ' },
          { type: 'em', text: 'you' },
          { type: 'text', text: '.' },
        ],
      },
      {
        type: 'list',
        ordered: false,
        items: [[{ type: 'text', text: 'one' }], [{ type: 'text', text: 'two' }]],
      },
      { type: 'image', alt: '图', src: 'spoor-article-media:img1' },
      { type: 'code', lang: 'js', text: 'const a = 1;' },
    ]);
  });

  it('parses links and line breaks inside a paragraph', () => {
    expect(parseEssayExportInlines('see [here](https://example.com)\nnext')).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'link', text: 'here', href: 'https://example.com' },
      { type: 'break' },
      { type: 'text', text: 'next' },
    ]);
  });
});

describe('buildEssayExportHtml', () => {
  it('embeds title, labels, and escaped body', async () => {
    const html = await buildEssayExportHtml(
      { title: 'Alpha <T>', author: 'Ann', date: '2026', markdown: 'Hello **world**' },
      { author: 'Author', published: 'Published' },
    );
    expect(html).toContain('Alpha &lt;T&gt;');
    expect(html).toContain('Author: Ann');
    expect(html).toContain('<strong>world</strong>');
  });
});

describe('exportEssayAsDocx', () => {
  it('packs a Word document that contains the title and body', async () => {
    const blob = await exportEssayAsDocx(
      { title: 'Alpha Unique Title', markdown: '## Hello\n\nA **bold** line.' },
      { author: 'Author', published: 'Published' },
    );
    expect(blob.size).toBeGreaterThan(1000);
    const zip = await JSZip.loadAsync(blob);
    expect(zip.file('word/document.xml')).toBeTruthy();
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Alpha Unique Title');
    expect(xml).toContain('Hello');
    expect(xml).toContain('bold');
  });
});

describe('printHtmlDocument', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('writes HTML into a hidden iframe and calls print', async () => {
    const print = vi.fn();
    const afterPrint: Array<() => void> = [];
    const fakeWin = {
      print,
      focus: vi.fn(),
      addEventListener: (type: string, handler: () => void) => {
        if (type === 'afterprint') afterPrint.push(handler);
      },
    };
    const fakeDoc = {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
      images: [] as HTMLImageElement[],
    };
    const originalCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'iframe') return originalCreate(tag);
      const iframe = originalCreate('iframe') as HTMLIFrameElement;
      Object.defineProperty(iframe, 'contentDocument', { value: fakeDoc });
      Object.defineProperty(iframe, 'contentWindow', { value: fakeWin });
      return iframe;
    });

    await printHtmlDocument('<html><body>Hi</body></html>');
    expect(fakeDoc.write).toHaveBeenCalledWith('<html><body>Hi</body></html>');
    expect(print).toHaveBeenCalled();
    createSpy.mockRestore();
  });
});

describe('exportEssayAsDocx structure', () => {
  async function readPart(markdown: string, part: string): Promise<string> {
    const blob = await exportEssayAsDocx(
      { title: 'DocX', markdown },
      { author: 'Author', published: 'Published' },
    );
    const zip = await JSZip.loadAsync(blob);
    const entry = zip.file(part);
    if (!entry) throw new Error(`docx part "${part}" not found`);
    return entry.async('string');
  }

  it('renders an ordered list with decimal numbering definition', async () => {
    const [doc, numbering] = await Promise.all([
      readPart('1. alpha\n2. beta', 'word/document.xml'),
      readPart('1. alpha\n2. beta', 'word/numbering.xml'),
    ]);
    // List paragraphs always carry numPr; the bullet vs decimal distinction
    // lives in numbering.xml.
    expect(doc).toContain('<w:numPr>');
    expect(numbering).toContain('%1.');
    expect(numbering).toContain('decimal');
  });

  it('renders an unordered list with bullet numbering definition', async () => {
    const [doc, numbering] = await Promise.all([
      readPart('- alpha\n- beta', 'word/document.xml'),
      readPart('- alpha\n- beta', 'word/numbering.xml'),
    ]);
    expect(doc).toContain('<w:numPr>');
    expect(numbering).toContain('•');
    expect(numbering).toContain('bullet');
    // The bullet list must not introduce a decimal definition alongside.
    expect(numbering).not.toContain('%1.');
  });

  it('renders blockquote with italic and left border', async () => {
    const xml = await readPart('> quoted line', 'word/document.xml');
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('<w:pBdr');
  });

  it('falls back to a caption paragraph when an image has no resolvable source', async () => {
    // Remote URL is not a spoor-article-media ref and has no data: payload,
    // so resolveImageBlob returns null and imageParagraph writes a caption
    // instead of an <w:drawing>.
    const xml = await readPart('![lone](https://example.com/missing.png)', 'word/document.xml');
    expect(xml).not.toContain('<w:drawing>');
    expect(xml).toContain('lone (https://example.com/missing.png)');
  });
});

describe('downloadBlob', () => {
  it('clicks a temporary object-URL link', () => {
    const originalCreate = document.createElement.bind(document);
    const click = vi.fn();
    const remove = vi.fn();
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'a') return originalCreate(tag);
      const anchor = originalCreate('a');
      anchor.click = click;
      anchor.remove = remove;
      return anchor;
    });
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    downloadBlob(new Blob(['x'], { type: 'text/plain' }), 'a.txt');
    expect(click).toHaveBeenCalled();
    expect(urlSpy).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();

    createSpy.mockRestore();
    urlSpy.mockRestore();
    revokeSpy.mockRestore();
  });
});
