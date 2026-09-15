import { useEffect, useRef } from 'react';

import { useLiveQuery } from 'dexie-react-hooks';

import { db, type CanvasNode, type CanvasWorkZone } from '../db';

import type { OnboardingController } from './useOnboarding';

import {

  countUserThreadMessages,

  isOnboardingGateMet,

  snapshotOutsideMaterialPositions,

  type MaterialPositionSnapshot,

} from './onboardingGates';



type UseOnboardingGatesOptions = {

  onboarding: OnboardingController;

  nodes: CanvasNode[];

  workZone: CanvasWorkZone | null;

  personaThreadId: string | null;

  enabled: boolean;

};



export function useOnboardingGates({

  onboarding,

  nodes,

  workZone,

  personaThreadId,

  enabled,

}: UseOnboardingGatesOptions): { canAdvance: boolean } {

  const materialBaselineRef = useRef<MaterialPositionSnapshot>(new Map());

  const userMessageBaselineRef = useRef(0);

  const nodeIdsBaselineRef = useRef<Set<string>>(new Set());

  const advancedForStepRef = useRef<string | null>(null);



  const thread = useLiveQuery(

    () => (personaThreadId ? db.canvasPersonaThreads.get(personaThreadId) : undefined),

    [personaThreadId],

  );



  const step = onboarding.currentStep;

  const gate = step?.gate;



  useEffect(() => {

    if (!enabled || !onboarding.isActive || !step) return;

    advancedForStepRef.current = null;

    if (gate === 'material-moved' && workZone) {

      materialBaselineRef.current = snapshotOutsideMaterialPositions(nodes, workZone);

    }

    if (gate === 'chat-sent') {

      userMessageBaselineRef.current = countUserThreadMessages(thread?.messages);

    }

    if (gate === 'excerpt-created' || gate === 'essay-created') {

      nodeIdsBaselineRef.current = new Set(nodes.map((n) => n.id));

    }

  }, [enabled, gate, nodes, onboarding.isActive, step, thread?.messages, workZone]);



  const userMessageCount = countUserThreadMessages(thread?.messages);

  const gateMet =

    enabled &&

    onboarding.isActive &&

    isOnboardingGateMet(gate, {

      nodes,

      materialBaseline: materialBaselineRef.current,

      workZone,

      userMessageBaseline: userMessageBaselineRef.current,

      userMessageCount,

      nodeIdsBaseline: nodeIdsBaselineRef.current,

    });



  useEffect(() => {

    if (!enabled || !onboarding.isActive || !step || !gate || gate === 'manual') return;

    if (!gateMet) return;

    if (advancedForStepRef.current === step.id) return;

    advancedForStepRef.current = step.id;

    onboarding.next();

  }, [enabled, gate, gateMet, onboarding, onboarding.isActive, step]);



  const canAdvance = !gate || gate === 'manual' || gateMet;



  return { canAdvance };

}

