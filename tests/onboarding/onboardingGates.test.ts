import { describe, expect, it } from 'vitest';

import type { CanvasNode, CanvasWorkZone } from '../../src/db';

import {

  hasCreatedEssay,

  hasDraggedMaterialIntoZone,

  hasExcerptedFromChat,

  isOnboardingGateMet,

  snapshotOutsideMaterialPositions,

} from '../../src/onboarding/onboardingGates';



const zone: CanvasWorkZone = {

  id: 'zone-1',

  canvasId: 'default',

  personaNodeId: 'ask',

  x: 100,

  y: 100,

  width: 400,

  height: 300,

  createdAt: 1,

};



const note = (id: string, x: number, y: number): CanvasNode => ({

  id,

  canvasId: 'default',

  type: 'note',

  content: 'hi',

  x,

  y,

  createdAt: 1,

});



describe('onboardingGates', () => {

  it('detects dragging outside material into the work room', () => {

    const baseline = snapshotOutsideMaterialPositions([note('n1', 600, 120)], zone);

    expect(

      hasDraggedMaterialIntoZone(baseline, [note('n1', 600, 120)], zone),

    ).toBe(false);

    expect(

      hasDraggedMaterialIntoZone(baseline, [note('n1', 220, 180)], zone),

    ).toBe(true);

  });



  it('detects chat send and excerpt gates', () => {

    expect(

      isOnboardingGateMet('chat-sent', {

        nodes: [],

        materialBaseline: new Map(),

        workZone: zone,

        userMessageBaseline: 0,

        userMessageCount: 1,

        nodeIdsBaseline: new Set(),

      }),

    ).toBe(true);



    expect(

      hasExcerptedFromChat(

        [{ ...note('n2', 0, 0), sourceMessageId: 'm1' }],

        new Set(['n1']),

      ),

    ).toBe(true);

    expect(

      hasCreatedEssay(

        [{ ...note('essay-1', 0, 0), type: 'essay', content: '{}' }],

        new Set(['n1']),

      ),

    ).toBe(true);

    expect(

      isOnboardingGateMet('essay-created', {

        nodes: [{ ...note('essay-1', 0, 0), type: 'essay', content: '{}' }],

        materialBaseline: new Map(),

        workZone: zone,

        userMessageBaseline: 0,

        userMessageCount: 0,

        nodeIdsBaseline: new Set(['n1']),

      }),

    ).toBe(true);

  });

});

