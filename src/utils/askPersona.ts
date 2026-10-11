import type { TFunction } from 'i18next';
import type { AgentConfig } from '../db';

/**
 * 阿狸的"人格替身"。
 *
 * 阿狸不是 `db.agents` 里的行——画布上它是另一种卡（`type: 'ask'`），身份来自
 * i18n（`ai.prompts.askCharacterIdentity`），见 `useAiActions` 里走 `else` 分支的那条
 * 路径。书籍和长文没有画布卡，于是要有一个能喂给同一套提示词拼接的东西。
 *
 * 所以这里合成一个 `AgentConfig` 形状的对象，让它走和其他角色完全一样的
 * `buildAgentSystemInstruction` 拼接路径——身份在前、功能契约在后，和画布上跟阿狸
 * 说话时一样。它不入库、不进候选列表、也不占房间名单：空房间就代表阿狸在场。
 */
export const ASK_PERSONA_ID = '__ask__';

export function buildAskPersona(
  t: TFunction<'translation', undefined>,
): AgentConfig {
  const name = t('ask.character_name');
  return {
    id: ASK_PERSONA_ID,
    name,
    role: '',
    // 和画布 ask 路径同一句：告诉模型自己的名字，被问起时照实说。
    prompt: t('ai.prompts.askCharacterIdentity', { name }),
  };
}

export function isAskPersona(agent: AgentConfig | null | undefined): boolean {
  return agent?.id === ASK_PERSONA_ID;
}
