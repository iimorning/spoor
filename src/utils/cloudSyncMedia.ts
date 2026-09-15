import type { AgentConfig, CanvasNode } from '../db';
import {
  BOOK_CONTENT_PREFIX,
  encodeBookContent,
  tryParseBookContent,
} from './bookPayload';
import { inlineDataUrlForCloud, isCanvasMediaUrl, isDataUrl } from '../services/canvasMediaStorage';

function nodeMediaBase(userId: string, nodeId: string): string {
  return `${userId}/nodes/${nodeId}`;
}

export type NodeCloudPrep = {
  cloud: CanvasNode;
  localPatch?: Partial<CanvasNode>;
};

export type AgentCloudPrep = {
  cloud: AgentConfig;
  localPatch?: Partial<AgentConfig>;
};

export type LocalMediaPatches = {
  nodes: Array<{ id: string; patch: Partial<CanvasNode> }>;
  agents: Array<{ id: string; patch: Partial<AgentConfig> }>;
};

async function bookContentForCloud(
  content: string,
  userId: string,
  nodeId: string,
): Promise<{ content: string; localPatch?: Partial<CanvasNode> }> {
  if (!content.startsWith(BOOK_CONTENT_PREFIX)) {
    return { content };
  }
  const payload = tryParseBookContent(content);
  if (!payload) return { content };

  let imageIndex = 0;
  for (const unit of payload.units) {
    if (!unit.blocks?.length) continue;
    for (let i = 0; i < unit.blocks.length; i += 1) {
      const block = unit.blocks[i];
      if (block.type !== 'image' || !isDataUrl(block.src)) continue;
      const uploaded = await inlineDataUrlForCloud(
        userId,
        `${userId}/books/${nodeId}/${imageIndex}`,
        block.src,
      );
      if (uploaded) {
        unit.blocks[i] = { ...block, src: uploaded };
      }
      imageIndex += 1;
    }
  }

  const next = encodeBookContent(payload);
  return next === content ? { content } : { content: next, localPatch: { content: next } };
}

/** Strip embedded data URLs from a canvas node before JSON sync. */
export async function nodeForCloud(node: CanvasNode, userId: string): Promise<NodeCloudPrep> {
  const out: CanvasNode = { ...node };
  const patch: Partial<CanvasNode> = {};
  const base = nodeMediaBase(userId, node.id);

  if (node.type === 'image' || node.type === 'video') {
    if (isDataUrl(node.content) && !isCanvasMediaUrl(node.content)) {
      const url = await inlineDataUrlForCloud(userId, `${base}/content`, node.content);
      if (url) {
        out.content = url;
        patch.content = url;
      }
    }
    if (isDataUrl(node.sourceUrl) && !isCanvasMediaUrl(node.sourceUrl)) {
      const url = await inlineDataUrlForCloud(userId, `${base}/source`, node.sourceUrl);
      if (url) {
        out.sourceUrl = url;
        patch.sourceUrl = url;
      }
    }
  }

  if (node.type === 'book' && node.content?.startsWith(BOOK_CONTENT_PREFIX)) {
    const book = await bookContentForCloud(node.content, userId, node.id);
    out.content = book.content;
    if (book.localPatch?.content) {
      patch.content = book.localPatch.content;
    }
  }

  if (isDataUrl(node.previewImageUrl) && !isCanvasMediaUrl(node.previewImageUrl)) {
    const url = await inlineDataUrlForCloud(userId, `${base}/preview`, node.previewImageUrl);
    if (url) {
      out.previewImageUrl = url;
      patch.previewImageUrl = url;
    }
  }

  return {
    cloud: out,
    localPatch: Object.keys(patch).length > 0 ? patch : undefined,
  };
}

export async function agentForCloud(agent: AgentConfig, userId: string): Promise<AgentCloudPrep> {
  if (!isDataUrl(agent.coverImageUrl) || isCanvasMediaUrl(agent.coverImageUrl)) {
    return { cloud: agent };
  }
  const uploaded = await inlineDataUrlForCloud(
    userId,
    `${userId}/agents/${agent.id}/cover`,
    agent.coverImageUrl,
  );
  if (!uploaded) return { cloud: agent };
  return {
    cloud: { ...agent, coverImageUrl: uploaded },
    localPatch: { coverImageUrl: uploaded },
  };
}

export function collectLocalMediaPatches(
  nodePreps: NodeCloudPrep[],
  agentPreps: AgentCloudPrep[],
): LocalMediaPatches {
  return {
    nodes: nodePreps.flatMap((prep) =>
      prep.localPatch ? [{ id: prep.cloud.id, patch: prep.localPatch }] : [],
    ),
    agents: agentPreps.flatMap((prep) =>
      prep.localPatch ? [{ id: prep.cloud.id, patch: prep.localPatch }] : [],
    ),
  };
}
