import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { BookFullscreen } from '../../src/components/BookFullscreen';
import { encodeBookContent } from '../../src/utils/bookPayload';
import { db } from '../../src/db';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        if (key === 'nodes.book_page') return `${opts?.current} / ${opts?.total}`;
        return key;
      },
    }),
  };
});

describe('BookFullscreen', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    await db.nodes.add({
      id: 'b1',
      type: 'book',
      x: 0,
      y: 0,
      description: 'demo.epub',
      fileType: 'epub',
      content: encodeBookContent({
        format: 'epub',
        title: 'Demo Book',
        units: [{ title: 'Ch1', text: 'Fullscreen chapter text' }],
      }),
    });
  });

  it('renders the book body and closes', async () => {
    const onClose = vi.fn();
    render(<BookFullscreen nodeId="b1" onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByTestId('book-fullscreen')).toBeInTheDocument();
      expect(screen.getByText('Fullscreen chapter text')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('book-fullscreen-close'));
    expect(onClose).toHaveBeenCalled();
  });
});
