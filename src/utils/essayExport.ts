import {
  AlignmentType,
  BorderStyle,
  Document as DocxDocument,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
  type INumberingOptions,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from 'docx';
import type { ArticleMedia } from '../db';
import { articleMediaIdFromUrl } from './articleMedia';
import {
  parseEssayExportMarkdown,
  type EssayExportBlock,
  type EssayExportInline,
} from './parseEssayExportMarkdown';

export interface EssayExportDoc {
  title: string;
  author?: string;
  date?: string;
  markdown: string;
  media?: ArticleMedia[];
}

export interface EssayExportLabels {
  author: string;
  published: string;
}

const BODY_FONT = {
  ascii: 'Calibri',
  hAnsi: 'Calibri',
  eastAsia: 'Microsoft YaHei',
};
const MAX_IMAGE_PX = 560;

type DocxImageType = 'jpg' | 'png' | 'gif' | 'bmp';

function mimeToDocxType(mime: string): DocxImageType | null {
  const lower = mime.toLowerCase();
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('png')) return 'png';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('bmp')) return 'bmp';
  return null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.replace(/\s/g, ''));
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] });
  } catch {
    return null;
  }
}

async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  return { width: MAX_IMAGE_PX, height: Math.round(MAX_IMAGE_PX * 0.62) };
}

function fitImage(width: number, height: number): { width: number; height: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (w <= MAX_IMAGE_PX) return { width: w, height: h };
  return { width: MAX_IMAGE_PX, height: Math.max(1, Math.round((h * MAX_IMAGE_PX) / w)) };
}

async function blobForDocx(blob: Blob, mimeType: string): Promise<{ data: ArrayBuffer; type: DocxImageType } | null> {
  let type = mimeToDocxType(mimeType || blob.type);
  let payload = blob;
  if (!type) {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
    try {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bitmap.close();
        return null;
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!png) return null;
      payload = png;
      type = 'png';
    } catch {
      return null;
    }
  }
  return { data: await payload.arrayBuffer(), type };
}

function mediaById(media: ArticleMedia[] | undefined, id: string): ArticleMedia | undefined {
  return media?.find((item) => item.id === id);
}

async function resolveImageBlob(
  src: string,
  media: ArticleMedia[] | undefined,
): Promise<{ blob: Blob; mimeType: string } | null> {
  const mediaId = articleMediaIdFromUrl(src);
  if (mediaId) {
    const item = mediaById(media, mediaId);
    if (!item) return null;
    return { blob: item.blob, mimeType: item.mimeType };
  }
  if (src.startsWith('data:image/')) {
    const blob = dataUrlToBlob(src);
    if (!blob) return null;
    return { blob, mimeType: blob.type || 'image/png' };
  }
  return null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlinesToHtml(inlines: EssayExportInline[]): string {
  return inlines
    .map((node) => {
      switch (node.type) {
        case 'text':
          return escapeHtml(node.text);
        case 'strong':
          return `<strong>${escapeHtml(node.text)}</strong>`;
        case 'em':
          return `<em>${escapeHtml(node.text)}</em>`;
        case 'code':
          return `<code>${escapeHtml(node.text)}</code>`;
        case 'link':
          return `<a href="${escapeHtml(node.href)}">${escapeHtml(node.text)}</a>`;
        case 'break':
          return '<br>';
        default:
          return '';
      }
    })
    .join('');
}

async function imageSrcForHtml(src: string, media: ArticleMedia[] | undefined): Promise<string> {
  const resolved = await resolveImageBlob(src, media);
  if (!resolved) return src;
  return blobToDataUrl(resolved.blob);
}

async function blocksToHtml(blocks: EssayExportBlock[], media: ArticleMedia[] | undefined): Promise<string> {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        parts.push(`<h${block.level}>${inlinesToHtml(block.inlines)}</h${block.level}>`);
        break;
      case 'paragraph':
        parts.push(`<p>${inlinesToHtml(block.inlines)}</p>`);
        break;
      case 'blockquote':
        parts.push(`<blockquote><p>${inlinesToHtml(block.inlines)}</p></blockquote>`);
        break;
      case 'code':
        parts.push(`<pre><code>${escapeHtml(block.text)}</code></pre>`);
        break;
      case 'hr':
        parts.push('<hr>');
        break;
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        const items = block.items.map((item) => `<li>${inlinesToHtml(item)}</li>`).join('');
        parts.push(`<${tag}>${items}</${tag}>`);
        break;
      }
      case 'image': {
        const href = await imageSrcForHtml(block.src, media);
        parts.push(
          `<figure><img src="${escapeHtml(href)}" alt="${escapeHtml(block.alt)}">${
            block.alt ? `<figcaption>${escapeHtml(block.alt)}</figcaption>` : ''
          }</figure>`,
        );
        break;
      }
      default:
        break;
    }
  }
  return parts.join('\n');
}

export async function buildEssayExportHtml(doc: EssayExportDoc, labels: EssayExportLabels): Promise<string> {
  const blocks = parseEssayExportMarkdown(doc.markdown);
  const body = await blocksToHtml(blocks, doc.media);
  const meta = [doc.author && `${labels.author}: ${doc.author}`, doc.date && `${labels.published}: ${doc.date}`]
    .filter(Boolean)
    .join(' · ');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.title || 'essay')}</title>
<style>
  @page { size: A4; margin: 2.2cm; }
  html, body { background: #fff; color: #1a1a1a; }
  body {
    font-family: "Newsreader", Georgia, "Zhuque Fangsong", "Source Han Serif SC", "Noto Serif SC", "Songti SC", "SimSun", serif;
    font-size: 12pt;
    line-height: 1.7;
    max-width: 40rem;
    margin: 0 auto;
    padding: 1.5rem;
  }
  h1.title { font-size: 22pt; line-height: 1.3; margin: 0 0 0.6rem; }
  .meta { color: #5a5a54; font-size: 10pt; margin: 0 0 1.6rem; font-family: sans-serif; }
  h1, h2, h3 { font-weight: 700; page-break-after: avoid; }
  h1 { font-size: 18pt; }
  h2 { font-size: 15pt; }
  h3 { font-size: 13pt; }
  p { margin: 0 0 0.85em; }
  blockquote { margin: 0 0 1em; padding-left: 1em; border-left: 3px solid #C2410C; color: #3f3f3a; }
  pre { background: #F4F1ED; padding: 0.8rem 1rem; overflow: auto; font-size: 10pt; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 0.92em; }
  ul, ol { margin: 0 0 1em; padding-left: 1.4em; }
  figure { margin: 1em 0; }
  img { max-width: 100%; height: auto; }
  figcaption { font-size: 9pt; color: #8c8a84; margin-top: 0.35rem; }
  hr { border: 0; border-top: 1px solid #E6E4DF; margin: 1.4em 0; }
</style>
</head>
<body>
<h1 class="title">${escapeHtml(doc.title || '')}</h1>
${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ''}
${body}
</body>
</html>`;
}

function waitForImages(doc: globalThis.Document): Promise<void> {
  const images = Array.from(doc.images);
  if (images.length === 0) return Promise.resolve();
  return Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        }),
    ),
  ).then(() => undefined);
}

export async function printHtmlDocument(html: string, win: Window = window): Promise<void> {
  const iframe = win.document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('data-testid', 'essay-export-print-frame');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
  });
  win.document.body.appendChild(iframe);
  const frameDoc = iframe.contentDocument;
  const frameWin = iframe.contentWindow;
  if (!frameDoc || !frameWin) {
    iframe.remove();
    throw new Error('print frame unavailable');
  }
  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();
  await waitForImages(frameDoc);
  const cleanup = () => {
    iframe.remove();
  };
  frameWin.addEventListener('afterprint', cleanup, { once: true });
  win.setTimeout(cleanup, 120_000);
  frameWin.focus();
  frameWin.print();
}

function bodyRun(text: string, extra?: IRunOptions): TextRun {
  return new TextRun({
    text,
    font: BODY_FONT,
    size: 24,
    ...extra,
  });
}

function childrenFromInlines(inlines: EssayExportInline[]): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const node of inlines) {
    switch (node.type) {
      case 'text':
        children.push(bodyRun(node.text));
        break;
      case 'strong':
        children.push(bodyRun(node.text, { bold: true }));
        break;
      case 'em':
        children.push(bodyRun(node.text, { italics: true }));
        break;
      case 'code':
        children.push(bodyRun(node.text, { font: 'Consolas' }));
        break;
      case 'link':
        children.push(
          new ExternalHyperlink({
            link: node.href,
            children: [bodyRun(node.text, { style: 'Hyperlink' })],
          }),
        );
        break;
      case 'break':
        children.push(bodyRun('', { break: 1 }));
        break;
      default:
        break;
    }
  }
  return children.length > 0 ? children : [bodyRun('')];
}

function paragraphFromInlines(
  inlines: EssayExportInline[],
  extras?: Omit<IParagraphOptions, 'children'>,
): Paragraph {
  return new Paragraph({
    spacing: { after: 200 },
    ...extras,
    children: childrenFromInlines(inlines),
  });
}

const HEADING_LEVEL = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
} as const;

async function imageParagraph(src: string, alt: string, media: ArticleMedia[] | undefined): Promise<Paragraph> {
  const resolved = await resolveImageBlob(src, media);
  if (resolved) {
    try {
      const encoded = await blobForDocx(resolved.blob, resolved.mimeType);
      if (encoded) {
        const raw = await imageSize(resolved.blob);
        const size = fitImage(raw.width, raw.height);
        return new Paragraph({
          spacing: { after: 200 },
          children: [
            new ImageRun({
              type: encoded.type,
              data: encoded.data,
              transformation: size,
              altText: { title: alt || 'image', description: alt, name: alt || 'image' },
            }),
          ],
        });
      }
    } catch {
      // fall through to caption
    }
  }
  const caption = alt ? `${alt} (${src})` : src;
  return paragraphFromInlines([{ type: 'text', text: caption }], { run: { italics: true } });
}

export async function buildEssayDocx(doc: EssayExportDoc, labels: EssayExportLabels): Promise<Blob> {
  const blocks = parseEssayExportMarkdown(doc.markdown);
  const children: Paragraph[] = [];
  const numberingConfig: Array<INumberingOptions['config'][number]> = [
    {
      reference: 'export-bullets',
      levels: [
        {
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        },
      ],
    },
  ];
  let orderedList = 0;

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 },
      children: [bodyRun(doc.title || '', { bold: true, size: 48 })],
    }),
  );

  const meta = [doc.author && `${labels.author}: ${doc.author}`, doc.date && `${labels.published}: ${doc.date}`]
    .filter(Boolean)
    .join('  ·  ');
  if (meta) {
    children.push(
      new Paragraph({
        spacing: { after: 360 },
        children: [bodyRun(meta, { size: 20, color: '5A5A54' })],
      }),
    );
  }

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        children.push(
          paragraphFromInlines(block.inlines, {
            heading: HEADING_LEVEL[block.level],
            spacing: { before: 240, after: 160 },
          }),
        );
        break;
      case 'paragraph':
        children.push(paragraphFromInlines(block.inlines));
        break;
      case 'blockquote':
        children.push(
          paragraphFromInlines(block.inlines, {
            run: { italics: true },
            indent: { left: 360 },
            border: {
              left: { color: 'C2410C', space: 8, style: BorderStyle.SINGLE, size: 12 },
            },
          }),
        );
        break;
      case 'code':
        children.push(
          new Paragraph({
            spacing: { after: 200 },
            shading: { type: ShadingType.CLEAR, fill: 'F4F1ED' },
            children: [bodyRun(block.text, { font: 'Consolas', size: 20 })],
          }),
        );
        break;
      case 'hr':
        children.push(
          new Paragraph({
            spacing: { before: 120, after: 120 },
            border: { bottom: { color: 'E6E4DF', space: 1, style: BorderStyle.SINGLE, size: 6 } },
            children: [bodyRun('')],
          }),
        );
        break;
      case 'list': {
        if (block.ordered) {
          orderedList += 1;
          numberingConfig.push({
            reference: `export-numbers-${orderedList}`,
            levels: [
              {
                level: 0,
                format: LevelFormat.DECIMAL,
                text: '%1.',
                alignment: AlignmentType.LEFT,
                style: { paragraph: { indent: { left: 720, hanging: 360 } } },
              },
            ],
          });
        }
        const reference = block.ordered ? `export-numbers-${orderedList}` : 'export-bullets';
        for (const item of block.items) {
          children.push(
            paragraphFromInlines(item, {
              numbering: { reference, level: 0 },
            }),
          );
        }
        break;
      }
      case 'image':
        children.push(await imageParagraph(block.src, block.alt, doc.media));
        break;
      default:
        break;
    }
  }

  const document = new DocxDocument({
    title: doc.title,
    styles: {
      default: {
        document: {
          run: {
            font: BODY_FONT,
            size: 24,
          },
        },
      },
    },
    numbering: { config: numberingConfig },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(document);
}

export async function exportEssayAsDocx(doc: EssayExportDoc, labels: EssayExportLabels): Promise<Blob> {
  return buildEssayDocx(doc, labels);
}

export async function exportEssayAsPdf(doc: EssayExportDoc, labels: EssayExportLabels): Promise<void> {
  const html = await buildEssayExportHtml(doc, labels);
  await printHtmlDocument(html);
}
