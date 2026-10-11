import type { AIConfig } from '../components/AISettingsModal';
import { OPENROUTER_BOOK_MODEL } from '../constants/openrouter';

/**
 * 书籍卡该用哪个模型。
 *
 * 陪读这一路既不写代码也不带图，默认模型往往是照着代码任务调的，写出来像技术
 * 文档。所以当用户选了 OpenRouter 时，把没写全的模型名补成书籍专用的那个 slug。
 * 顺带说一句，OpenRouter 上并没有 "4.0" 这个名字，4.1 之前那条线就叫
 * `deepseek/deepseek-v4-flash`。
 *
 * 这里**只改 model 和 lockModel，不动 provider**：provider 在直连路径上是真的
 * （用户填了自己的 Key 时，provider 决定请求打到哪个域名），动它等于改掉用户
 * 自己的设置。
 */
export function withBookModel(aiConfig: AIConfig): {
  config: AIConfig;
  lockModel: boolean;
} {
  if (aiConfig.provider !== 'openrouter') {
    // 用户拿自己的 Key 直连豆包 / DeepSeek 官方 / 本地模型：
    // 那些命名空间里没有 OpenRouter 的 slug，塞过去只会 404。
    return { config: aiConfig, lockModel: false };
  }
  const picked = (aiConfig.model ?? '').trim();
  // 带斜杠才是 OpenRouter 的 slug（`provider/model`）。像 `doubao-seed-2-0-lite-…`
  // 这种是豆包自己的命名空间，拿去 OpenRouter 会 404。
  return {
    config: { ...aiConfig, model: picked.includes('/') ? picked : OPENROUTER_BOOK_MODEL },
    lockModel: true,
  };
}