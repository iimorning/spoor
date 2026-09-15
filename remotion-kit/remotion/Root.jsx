import React from 'react';
import { Composition } from 'remotion';
import { MyComposition } from './Composition.jsx';
import { PromoVertical, PromoVerticalDuration } from './PromoVertical.jsx';
import { SpoorPromo, SpoorPromoZH, SpoorPromoDuration } from './SpoorPromo.jsx';
import { SpoorPromoV2, SpoorPromoV2ZH, SpoorPromoV2EN, SpoorPromoV2Duration } from './SpoorPromoV2.jsx';
import { SpoorPromoV3, SpoorPromoV3ZH, SpoorPromoV3EN, SpoorPromoV3Duration } from './SpoorPromoV3.jsx';
import spoorPromoDefaults from './spoor-promo.json';
import spoorPromoZhDefaults from './spoor-promo-zh.json';
import spoorPromoV2ZhDefaults from './spoor-promo-v2-zh.json';
import spoorPromoV2EnDefaults from './spoor-promo-v2-en.json';
import spoorPromoV3ZhDefaults from './spoor-promo-v3-zh.json';
import spoorPromoV3EnDefaults from './spoor-promo-v3-en.json';

const FPS = 30;

const durationFromProps = ({ props }, minFrames) => {
  const total = Number(props?.totalDurationSec) || 0;
  const segments = Array.isArray(props?.timestampSegments) ? props.timestampSegments : [];
  const last = segments.reduce((max, seg) => Math.max(max, Number(seg?.endSec) || 0), total);
  return {
    durationInFrames: Math.max(minFrames, Math.ceil((last + 1) * FPS)),
  };
};

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="MyComposition"
        component={MyComposition}
        durationInFrames={90}
        calculateMetadata={(meta) => durationFromProps(meta, 90)}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{}}
      />
      <Composition
        id="PromoVertical"
        component={PromoVertical}
        durationInFrames={PromoVerticalDuration}
        calculateMetadata={(meta) => durationFromProps(meta, PromoVerticalDuration)}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{}}
      />
      <Composition
        id="SpoorPromo"
        component={SpoorPromo}
        durationInFrames={SpoorPromoDuration}
        calculateMetadata={(meta) => durationFromProps(meta, SpoorPromoDuration)}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={spoorPromoDefaults}
      />
      <Composition
        id="SpoorPromoZH"
        component={SpoorPromoZH}
        durationInFrames={SpoorPromoDuration}
        calculateMetadata={(meta) => durationFromProps(meta, SpoorPromoDuration)}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={spoorPromoZhDefaults}
      />
      <Composition
        id="SpoorPromoV2"
        component={SpoorPromoV2}
        durationInFrames={SpoorPromoV2Duration}
        calculateMetadata={(meta) => durationFromProps(meta, SpoorPromoV2Duration)}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={spoorPromoV2ZhDefaults}
      />
      <Composition
        id="SpoorPromoV2ZH"
        component={SpoorPromoV2ZH}
        durationInFrames={SpoorPromoV2Duration}
        calculateMetadata={(meta) => durationFromProps(meta, SpoorPromoV2Duration)}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={spoorPromoV2ZhDefaults}
      />
      <Composition
        id="SpoorPromoV2EN"
        component={SpoorPromoV2EN}
        durationInFrames={SpoorPromoV2Duration}
        calculateMetadata={(meta) => durationFromProps(meta, SpoorPromoV2Duration)}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={spoorPromoV2EnDefaults}
      />
      <Composition
        id="SpoorPromoV3"
        component={SpoorPromoV3}
        durationInFrames={SpoorPromoV3Duration}
        calculateMetadata={(meta) => durationFromProps(meta, SpoorPromoV3Duration)}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={spoorPromoV3ZhDefaults}
      />
      <Composition
        id="SpoorPromoV3ZH"
        component={SpoorPromoV3ZH}
        durationInFrames={SpoorPromoV3Duration}
        calculateMetadata={(meta) => durationFromProps(meta, SpoorPromoV3Duration)}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={spoorPromoV3ZhDefaults}
      />
      <Composition
        id="SpoorPromoV3EN"
        component={SpoorPromoV3EN}
        durationInFrames={SpoorPromoV3Duration}
        calculateMetadata={(meta) => durationFromProps(meta, SpoorPromoV3Duration)}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={spoorPromoV3EnDefaults}
      />
    </>
  );
};
