import { encodeBookContent } from './bookPayload';

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export interface FileNodeData {
  type: string;
  content: string;
  description?: string;
  fileType: string;
  width?: number;
  height?: number;
}

const BOOK_NODE_SIZE = { width: 380, height: 520 };

function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
}

function isEpubFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.epub') ||
    file.type === 'application/epub+zip' ||
    file.type === 'application/epub'
  );
}

const AUDIO_EXT_MIME: Record<string, string> = {
  wav: 'audio/wav',
  wave: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
};

function audioExtension(name: string): string | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return ext && AUDIO_EXT_MIME[ext] ? ext : null;
}

function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || audioExtension(file.name) !== null;
}

function audioMimeForFile(file: File): string {
  if (file.type.startsWith('audio/')) return file.type;
  const ext = audioExtension(file.name);
  return (ext && AUDIO_EXT_MIME[ext]) || 'audio/wav';
}

export async function processFileToNode(file: File): Promise<FileNodeData> {
  if (file.type.startsWith('video/')) {
    return {
      type: 'video',
      content: await readFileAsDataURL(file),
      fileType: file.type,
    };
  }

  if (isAudioFile(file)) {
    const mime = audioMimeForFile(file);
    const typed = file.type.startsWith('audio/')
      ? file
      : new File([file], file.name, { type: mime });
    return {
      type: 'video',
      content: await readFileAsDataURL(typed),
      description: file.name,
      fileType: mime,
    };
  }

  if (file.type.startsWith('image/')) {
    return {
      type: 'image',
      content: await readFileAsDataURL(file),
      fileType: file.type,
    };
  }

  if (isPdfFile(file)) {
    const arrayBuffer = await file.arrayBuffer();
    const { parsePdfBook } = await import('./parsePdfBook');
    const book = await parsePdfBook(arrayBuffer, file.name);
    return {
      type: 'book',
      content: encodeBookContent(book),
      description: file.name,
      fileType: 'pdf',
      ...BOOK_NODE_SIZE,
    };
  }

  if (isEpubFile(file)) {
    const arrayBuffer = await file.arrayBuffer();
    const { parseEpubBook } = await import('./parseEpubBook');
    const book = await parseEpubBook(arrayBuffer, file.name);
    return {
      type: 'book',
      content: encodeBookContent(book),
      description: file.name,
      fileType: 'epub',
      ...BOOK_NODE_SIZE,
    };
  }

  if (file.name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const arrayBuffer = await file.arrayBuffer();
    const { default: mammoth } = await import('mammoth');
    const result = await mammoth.convertToHtml({ arrayBuffer });
    return {
      type: 'document',
      content: result.value || '<p>(空文档)</p>',
      description: file.name,
      fileType: 'docx',
      ...BOOK_NODE_SIZE,
    };
  }

  if (file.name.endsWith('.txt') || file.type === 'text/plain') {
    const text = await readFileAsText(file);
    return {
      type: 'text',
      content: text,
      description: file.name,
      fileType: 'text/plain',
    };
  }

  if (file.name.endsWith('.md') || file.type === 'text/markdown') {
    const text = await readFileAsText(file);
    return {
      type: 'text',
      content: text,
      description: file.name,
      fileType: 'text/markdown',
    };
  }

  throw new Error(`Unsupported file type: ${file.type || file.name}`);
}
