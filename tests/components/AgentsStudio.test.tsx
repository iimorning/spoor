import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AgentsStudio } from '../../src/components/AgentsStudio';
import { db } from '../../src/db';
import {
  clearVoicePreviewMemoryCache,
  voicePreviewCacheKey,
  writeVoicePreviewClip,
} from '../../src/utils/voicePreviewCache';
import { voicePreviewLine } from '../../src/components/AgentsStudio';
import type { AgentConfig } from '../../src/db';

const { extractDocumentText } = vi.hoisted(() => ({
  extractDocumentText: vi.fn(async () => '占星讲义正文'),
}));

const callAIMock = vi.fn();

vi.mock('../../src/utils/extractDocumentText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/extractDocumentText')>();
  return { ...actual, extractDocumentText };
});

vi.mock('../../src/utils/agentMarkdownKnowledge', () => ({
  AGENT_KNOWLEDGE_MAX_FILE_BYTES: 512_000,
  isAgentMarkdownFilename: (name: string) => name.endsWith('.md'),
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        if (key === 'agents.sandbox_title') return `Sandbox: ${opts?.name ?? ''}`;
        if (key === 'agents.message_placeholder') return `Message ${opts?.name ?? ''}`;
        if (key === 'agents.sandbox_empty') return `Empty sandbox for ${opts?.name ?? ''}`;
        if (key === 'agents.studio.from_document_user') return `FROMDOC ${opts?.document ?? ''}`;
        return key;
      },
      i18n: { language: 'en' },
    }),
  };
});

const openTtsStreamMock = vi.fn(async (_options?: unknown) => ({
  enqueueText: vi.fn(),
  finish: vi.fn(),
  waitUntilIdle: vi.fn(async () => undefined),
  stop: vi.fn(),
}));

vi.mock('../../src/services/minimaxTtsStream', () => ({
  openMinimaxTtsStream: (options?: unknown) => openTtsStreamMock(options),
}));

vi.mock('../../src/utils/aiI18n', () => ({
  buildAgentSystemInstruction: () => 'system',
  getLocaleDirective: () => 'locale',
  resolveAgentLocalizedName: (a: AgentConfig) => a.name,
  resolveAgentLocalizedRole: (a: AgentConfig) => a.role,
  resolveAgentSystemPrompt: (a: AgentConfig) => a.prompt,
}));

vi.mock('lucide-react', async (importOriginal) =>
  (await import('../mocks/lucideReactMock')).lucideReactMock(importOriginal),
);

const agentA: AgentConfig = {
  id: 'agent-a',
  name: 'Agent Alpha',
  role: 'Tester',
  prompt: 'You are alpha',
  temperature: 0.7,
  creativity: 0.4,
};

const agentB: AgentConfig = {
  id: 'agent-b',
  name: 'Agent Beta',
  role: 'Tester',
  prompt: 'You are beta',
  temperature: 0.5,
  creativity: 0.3,
};

const aiConfig = {
  provider: 'gemini',
  apiKey: 'k',
  baseUrl: '',
  model: 'gemini-2.0-flash',
  minimaxApiKey: 'mm',
};

function renderStudio(
  agents: AgentConfig[] = [agentA, agentB],
  setAgentConfigs = vi.fn().mockResolvedValue(undefined),
  extra?: { onGenerateCover?: (id: string) => void; generatingCoverAgentId?: string | null },
) {
  return render(
    <AgentsStudio
      agentConfigs={agents}
      setAgentConfigs={setAgentConfigs}
      aiConfig={aiConfig}
      callAI={callAIMock}
      onGenerateCover={extra?.onGenerateCover}
      generatingCoverAgentId={extra?.generatingCoverAgentId}
    />,
  );
}

describe('AgentsStudio 沙盒', () => {
  beforeEach(async () => {
    await db.agentSandboxThreads.clear();
    callAIMock.mockReset();
    callAIMock.mockResolvedValue('Assistant reply');
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('打开沙盒时从 IndexedDB 恢复历史消息', async () => {
    await db.agentSandboxThreads.put({
      agentId: 'agent-a',
      messages: [
        { role: 'user', text: 'Stored question' },
        { role: 'model', text: 'Stored answer' },
      ],
      updatedAt: Date.now(),
    });

    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));

    await waitFor(() => {
      expect(screen.getByText('Stored question')).toBeInTheDocument();
      expect(screen.getByText('Stored answer')).toBeInTheDocument();
    });
  });

  it('发送消息时通过 onStreamChunk 流式更新沙盒回复', async () => {
    callAIMock.mockImplementation(async (opts: { onStreamChunk?: (t: string) => void }) => {
      opts.onStreamChunk?.('Part');
      opts.onStreamChunk?.('Assistant reply');
      return 'Assistant reply';
    });

    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));

    const input = await screen.findByPlaceholderText('Message Agent Alpha');
    await user.type(input, 'Stream test');
    const submitBtn = input.closest('form')!.querySelector('button[type="submit"]') as HTMLButtonElement;
    await user.click(submitBtn);

    await waitFor(() => {
      expect(callAIMock).toHaveBeenCalled();
      expect(callAIMock.mock.calls[0][0].onStreamChunk).toEqual(expect.any(Function));
      expect(screen.getByText('Assistant reply')).toBeInTheDocument();
    });
  });

  it('发送消息后写入 agentSandboxThreads', async () => {
    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));

    const input = await screen.findByPlaceholderText('Message Agent Alpha');
    await user.type(input, 'Hello sandbox');
    const submitBtn = input.closest('form')!.querySelector('button[type="submit"]') as HTMLButtonElement;
    await user.click(submitBtn);

    await waitFor(() => {
      expect(callAIMock).toHaveBeenCalled();
    });
    await waitFor(async () => {
      const row = await db.agentSandboxThreads.get('agent-a');
      expect(row?.messages.some((m) => m.text === 'Hello sandbox')).toBe(true);
      expect(row?.messages.some((m) => m.text === 'Assistant reply')).toBe(true);
    });
  });

  it('清空沙盒删除线程并清空界面', async () => {
    await db.agentSandboxThreads.put({
      agentId: 'agent-a',
      messages: [{ role: 'user', text: 'To clear' }],
      updatedAt: Date.now(),
    });

    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));
    await waitFor(() => expect(screen.getByText('To clear')).toBeInTheDocument());

    const clearBtn = screen.getByLabelText('agents.sandbox_clear_aria');
    await user.click(clearBtn);
    await user.click(screen.getByRole('button', { name: 'dialog.confirm' }));

    await waitFor(() => {
      expect(screen.queryByText('To clear')).not.toBeInTheDocument();
    });
    const row = await db.agentSandboxThreads.get('agent-a');
    expect(row).toBeUndefined();
  });

  it('切换人格后加载对应沙盒记录', async () => {
    await db.agentSandboxThreads.bulkPut([
      {
        agentId: 'agent-a',
        messages: [{ role: 'user', text: 'Only A' }],
        updatedAt: 1,
      },
      {
        agentId: 'agent-b',
        messages: [{ role: 'user', text: 'Only B' }],
        updatedAt: 2,
      },
    ]);

    const user = userEvent.setup();
    renderStudio();
    await user.click(screen.getByText('agents.test_sandbox'));
    await waitFor(() => expect(screen.getByText('Only A')).toBeInTheDocument());

    const betaRow = screen.getByRole('heading', { name: 'Agent Beta' }).closest('[class*="cursor-pointer"]');
    expect(betaRow).toBeTruthy();
    await user.click(betaRow!);
    await waitFor(
      () => {
        expect(screen.getByText('Only B')).toBeInTheDocument();
        expect(screen.queryByText('Only A')).not.toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });
});

describe('AgentsStudio 生成卡片', () => {
  beforeEach(async () => {
    await db.nodes.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('名称旁有生成卡片按钮，不展示插画预览区', () => {
    renderStudio();
    const name = screen.getByLabelText('agents.persona_name');
    const generate = screen.getByTestId('agent-studio-generate-cover');
    // 图标按钮：文字挪到可访问名上，界面里只留图标
    expect(generate).toHaveTextContent('');
    expect(generate).toHaveAccessibleName('agents.card_cover_generate');
    expect(generate.querySelector('svg')).toBeTruthy();
    expect(name.compareDocumentPosition(generate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('agent-studio-cover-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-studio-cover')).not.toBeInTheDocument();
    expect(screen.queryByText('agents.card_cover')).not.toBeInTheDocument();
  });

  it('点击生成会把当前人格 id 交给 onGenerateCover', async () => {
    const onGenerateCover = vi.fn();
    const user = userEvent.setup();
    renderStudio([agentA, agentB], vi.fn().mockResolvedValue(undefined), { onGenerateCover });
    await user.click(screen.getByTestId('agent-studio-generate-cover'));
    expect(onGenerateCover).toHaveBeenCalledWith('agent-a');
  });

  it('已有封面时名称旁显示封面缩略图，按钮改为重新生成', () => {
    renderStudio([{ ...agentA, coverImageUrl: 'https://img.example/fox.jpg' }]);
    expect(screen.getByTestId('agent-studio-generate-cover')).toHaveAccessibleName(
      'agents.card_cover_regenerate',
    );
    expect(screen.queryByTestId('agent-studio-clear-cover')).not.toBeInTheDocument();
    const thumbs = screen.getAllByTestId('agent-cover-thumb');
    expect(thumbs.length).toBeGreaterThanOrEqual(1);
    expect(thumbs[0]).toHaveAttribute('src', 'https://img.example/fox.jpg');
  });

  it('单击头像可上传本地图片并写入 coverImageUrl', async () => {
    const setAgentConfigs = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderStudio([agentA], setAgentConfigs);

    expect(screen.getByTestId('agent-studio-upload-cover')).toHaveAttribute(
      'aria-label',
      'agents.card_cover_upload',
    );

    const file = new File(['avatar-bytes'], 'me.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('agent-studio-cover-input'), file);

    await waitFor(() => {
      expect(setAgentConfigs).toHaveBeenCalled();
    });
    const next = setAgentConfigs.mock.calls[0][0] as AgentConfig[];
    expect(next[0].id).toBe('agent-a');
    expect(next[0].coverImageUrl).toMatch(/^data:image\/png;base64,/);
  });
});

describe('AgentsStudio 从文档生成提示词', () => {
  beforeEach(() => {
    callAIMock.mockReset();
    callAIMock.mockResolvedValue('New Enhanced Prompt:\nYou are an astrologer.');
    extractDocumentText.mockReset();
    extractDocumentText.mockResolvedValue('占星讲义正文');
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('从文档生成按钮在「身份与基调」标题旁，而且只有图标', () => {
    renderStudio();
    const heading = screen.getByRole('heading', { name: 'agents.identity_tone' });
    const fromDoc = within(heading.parentElement as HTMLElement).getByTestId(
      'agent-studio-prompt-from-doc',
    );
    // 不再显示「从文档生成」那几个字，但可访问名还在（title / aria-label）
    expect(fromDoc).toHaveTextContent('');
    expect(fromDoc).toHaveAccessibleName('agents.prompt_from_doc');
    expect(fromDoc.querySelector('svg')).toBeTruthy();
  });

  it('上传 Word 后把 AI 起草的系统提示词写入角色', async () => {
    const setAgentConfigs = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderStudio([agentA], setAgentConfigs);

    const file = new File(['doc-bytes'], 'brief.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await user.upload(screen.getByTestId('agent-studio-prompt-doc-input'), file);
    await user.click(screen.getByRole('button', { name: 'dialog.confirm' }));

    await waitFor(() => {
      expect(extractDocumentText).toHaveBeenCalled();
      expect(callAIMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('占星讲义正文'),
        }),
      );
    });
    await waitFor(() => {
      expect(setAgentConfigs).toHaveBeenCalled();
    });
    const next = setAgentConfigs.mock.calls.at(-1)?.[0] as AgentConfig[];
    expect(next[0].prompt).toBe('You are an astrologer.');
  });
});

describe('AgentsStudio 系统提示词输入法', () => {
  it('组字过程中不写入，选字后才持久化最终汉字', async () => {
    const setAgentConfigs = vi.fn().mockResolvedValue(undefined);
    renderStudio([agentA], setAgentConfigs);
    const field = screen.getByTestId('agent-studio-system-prompt');

    fireEvent.compositionStart(field);
    fireEvent.change(field, { target: { value: 'You are alpha' + 'ru' } });
    expect(setAgentConfigs).not.toHaveBeenCalled();
    expect(field).toHaveValue('You are alpharu');

    fireEvent.change(field, { target: { value: 'You are alpha如果' } });
    fireEvent.compositionEnd(field);
    expect(setAgentConfigs).toHaveBeenCalled();
    const next = setAgentConfigs.mock.calls.at(-1)?.[0] as AgentConfig[];
    expect(next[0].prompt).toBe('You are alpha如果');
  });
});

describe('AgentsStudio 朗读音色', () => {
  it('打开菜单才列音色，中英文两组都在，界面语言那一组在前', async () => {
    renderStudio([agentA]);
    // 菜单没打开时，音色一个都不该出现在页面上
    expect(screen.queryByTestId('agent-studio-voice-menu')).toBeNull();

    fireEvent.click(await screen.findByTestId('agent-studio-voice'));
    const menu = await screen.findByTestId('agent-studio-voice-menu');

    const groupLabels = Array.from(menu.querySelectorAll('p')).map((p) => p.textContent);
    // 测试里的界面语言是 en，所以英文组在前、中文组在后
    expect(groupLabels).toEqual(['agents.voice_group_en', 'agents.voice_group_zh']);
    expect(screen.getByTestId('agent-studio-voice-option-female-yujie').textContent).toContain(
      '御姐',
    );
    expect(
      screen.getByTestId('agent-studio-voice-option-English_Trustworthy_Man').textContent,
    ).toContain('Trustworthy Man');
  });

  it('搜索框按名字和 id 过滤', async () => {
    renderStudio([agentA]);
    fireEvent.click(await screen.findByTestId('agent-studio-voice'));
    fireEvent.change(screen.getByTestId('agent-studio-voice-search'), {
      target: { value: '御姐' },
    });

    expect(screen.getByTestId('agent-studio-voice-option-female-yujie')).toBeInTheDocument();
    expect(
      screen.queryByTestId('agent-studio-voice-option-English_Trustworthy_Man'),
    ).toBeNull();

    // 按 id 也能搜到
    fireEvent.change(screen.getByTestId('agent-studio-voice-search'), {
      target: { value: 'whispering' },
    });
    expect(
      screen.getByTestId('agent-studio-voice-option-English_Whispering_girl'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('agent-studio-voice-option-female-yujie')).toBeNull();
  });

  it('音色菜单里可以试听：第一次按这个音色现合成一句', async () => {
    openTtsStreamMock.mockClear();
    await db.voicePreviewClips.clear();
    clearVoicePreviewMemoryCache();
    renderStudio([{ ...agentA, voiceId: 'female-yujie' }]);
    fireEvent.click(await screen.findByTestId('agent-studio-voice'));
    const preview = await screen.findByTestId('agent-studio-voice-option-female-yujie-preview');
    expect(preview).toHaveAccessibleName('agents.voice_preview');
    fireEvent.click(preview);
    // 试听走我们自己的合成链路，所以用的是这个音色，而且开了录音（留给缓存）
    await waitFor(() => {
      expect(openTtsStreamMock).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: 'female-yujie', recordAudio: true }),
      );
    });
  });

  it('缓存里已有这个音色：直接本地播放，不再合成', async () => {
    openTtsStreamMock.mockClear();
    await db.voicePreviewClips.clear();
    clearVoicePreviewMemoryCache();
    await writeVoicePreviewClip(
      voicePreviewCacheKey({
        model: 'speech-2.6-turbo',
        voiceId: 'female-yujie',
        line: voicePreviewLine('female-yujie', 'zh'),
      }),
      new Uint8Array([1, 2, 3]),
    );

    renderStudio([{ ...agentA, voiceId: 'female-yujie' }]);
    fireEvent.click(await screen.findByTestId('agent-studio-voice'));
    fireEvent.click(await screen.findByTestId('agent-studio-voice-option-female-yujie-preview'));

    // 合成链路一次都没走 —— 这就是缓存的意义（第一次之后都是瞬间出声）
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(openTtsStreamMock).not.toHaveBeenCalled();
  });

  it('缓存命中时真的走本地播放：拿 blob URL 建 audio 并 play', async () => {
    await db.voicePreviewClips.clear();
    clearVoicePreviewMemoryCache();
    await writeVoicePreviewClip(
      voicePreviewCacheKey({
        model: 'speech-2.6-turbo',
        voiceId: 'female-yujie',
        line: voicePreviewLine('female-yujie', 'zh'),
      }),
      new Uint8Array([1, 2, 3]),
    );

    const created: Array<{ src: string; play: ReturnType<typeof vi.fn> }> = [];
    class FakeAudio {
      src: string;
      onended: (() => void) | null = null;
      play: ReturnType<typeof vi.fn>;
      pause = vi.fn();
      constructor(src: string) {
        this.src = src;
        this.play = vi.fn(async () => {
          this.onended?.();
        });
        created.push({ src, play: this.play });
      }
    }
    vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
    try {
      renderStudio([{ ...agentA, voiceId: 'female-yujie' }]);
      fireEvent.click(await screen.findByTestId('agent-studio-voice'));
      fireEvent.click(await screen.findByTestId('agent-studio-voice-option-female-yujie-preview'));

      await waitFor(() => expect(created.length).toBe(1));
      expect(created[0]!.src.startsWith('blob:')).toBe(true);
      expect(created[0]!.play).toHaveBeenCalled();
      // 播完把状态收回来（按钮回到"试听"）
      await waitFor(() =>
        expect(screen.getByTestId('agent-studio-voice-option-female-yujie-preview')).toHaveAccessibleName(
          'agents.voice_preview',
        ),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('默认项（跟随全局设置）不给试听键：没有确定的音色可听', async () => {
    renderStudio();
    fireEvent.click(await screen.findByTestId('agent-studio-voice'));
    expect(
      screen.queryByTestId('agent-studio-voice-option-default-preview'),
    ).not.toBeInTheDocument();
  });

  it('选中音色后收起菜单，并把音色写进这个角色的配置', async () => {
    const setAgentConfigs = vi.fn().mockResolvedValue(undefined);
    renderStudio([agentA, agentB], setAgentConfigs);

    fireEvent.click(await screen.findByTestId('agent-studio-voice'));
    fireEvent.click(screen.getByTestId('agent-studio-voice-option-female-yujie'));

    expect(screen.queryByTestId('agent-studio-voice-menu')).toBeNull();
    await waitFor(() => expect(setAgentConfigs).toHaveBeenCalled());
    const next = setAgentConfigs.mock.calls.at(-1)?.[0] as AgentConfig[];
    expect(next.find((a) => a.id === 'agent-a')?.voiceId).toBe('female-yujie');
    // 只动当前这个角色
    expect(next.find((a) => a.id === 'agent-b')?.voiceId).toBeUndefined();
  });

  it('触发按钮显示已选音色的名字，选回默认就清掉而不是存空字符串', async () => {
    const setAgentConfigs = vi.fn().mockResolvedValue(undefined);
    renderStudio([{ ...agentA, voiceId: 'female-yujie' }], setAgentConfigs);
    expect((await screen.findByTestId('agent-studio-voice')).textContent).toContain('御姐');

    fireEvent.click(screen.getByTestId('agent-studio-voice'));
    fireEvent.click(screen.getByTestId('agent-studio-voice-option-default'));

    await waitFor(() => expect(setAgentConfigs).toHaveBeenCalled());
    const next = setAgentConfigs.mock.calls.at(-1)?.[0] as AgentConfig[];
    expect(next[0].voiceId).toBeUndefined();
  });

  it('表里没有的 id 也照实显示，不会看起来像没设置', async () => {
    renderStudio([{ ...agentA, voiceId: 'my-cloned-voice' }]);
    expect((await screen.findByTestId('agent-studio-voice')).textContent).toContain(
      'my-cloned-voice',
    );
  });
});
