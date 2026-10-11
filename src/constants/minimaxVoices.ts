/**
 * MiniMax 系统音色（只收中英文），取自国内版文档：
 * https://platform.minimax.cn/docs/faq/system-voice-id
 *
 * 只放中英文的原因：那 300+ 个音色里大部分是日韩西葡等语言，跟我们的界面语言无关。
 *
 * 平台必须对齐：我们调用的是 api.minimaxi.com（国内版），两个平台的音色表并不相同 ——
 * 国际版有 English_CalmWoman，国内版没有；拼写也有差异（国际版 English_Trustworth_Man，
 * 国内版 English_Trustworthy_Man）。抄错平台的 id 不会报错，只会念不出声或换个声音，
 * 所以增删音色前请对着上面那个链接核对。
 *
 * 想要账号里的克隆音色，别往这里加：用 MiniMax 的音色管理接口（get_voice，
 * voice_type=voice_cloning）在运行时取。
 */
export type MinimaxVoiceLanguage = 'zh' | 'en';

export type MinimaxSystemVoice = {
  /** 送进 TTS 请求的 voice_id */
  id: string;
  /** 选择器里显示的名字（尽量用官方文档里的叫法） */
  label: string;
  language: MinimaxVoiceLanguage;
};

/** 中文音色，顺序与官方文档一致（先老式短 id，再 Chinese (Mandarin)_ 系列）。 */
export const MINIMAX_ZH_VOICES: MinimaxSystemVoice[] = [
  { id: 'male-qn-qingse', label: '青涩青年', language: 'zh' },
  { id: 'male-qn-jingying', label: '精英青年', language: 'zh' },
  { id: 'male-qn-badao', label: '霸道青年', language: 'zh' },
  { id: 'male-qn-daxuesheng', label: '青年大学生', language: 'zh' },
  { id: 'female-shaonv', label: '少女', language: 'zh' },
  { id: 'female-yujie', label: '御姐', language: 'zh' },
  { id: 'female-chengshu', label: '成熟女性', language: 'zh' },
  { id: 'female-tianmei', label: '甜美女性', language: 'zh' },
  { id: 'male-qn-qingse-jingpin', label: '青涩青年 (beta)', language: 'zh' },
  { id: 'male-qn-jingying-jingpin', label: '精英青年 (beta)', language: 'zh' },
  { id: 'male-qn-badao-jingpin', label: '霸道青年 (beta)', language: 'zh' },
  { id: 'male-qn-daxuesheng-jingpin', label: '青年大学生 (beta)', language: 'zh' },
  { id: 'female-shaonv-jingpin', label: '少女 (beta)', language: 'zh' },
  { id: 'female-yujie-jingpin', label: '御姐 (beta)', language: 'zh' },
  { id: 'female-chengshu-jingpin', label: '成熟女性 (beta)', language: 'zh' },
  { id: 'female-tianmei-jingpin', label: '甜美女性 (beta)', language: 'zh' },
  { id: 'clever_boy', label: '聪明男童', language: 'zh' },
  { id: 'cute_boy', label: '可爱男童', language: 'zh' },
  { id: 'lovely_girl', label: '萌萌女童', language: 'zh' },
  { id: 'cartoon_pig', label: '卡通猪小琪', language: 'zh' },
  { id: 'bingjiao_didi', label: '病娇弟弟', language: 'zh' },
  { id: 'junlang_nanyou', label: '俊朗男友', language: 'zh' },
  { id: 'chunzhen_xuedi', label: '纯真学弟', language: 'zh' },
  { id: 'lengdan_xiongzhang', label: '冷淡学长', language: 'zh' },
  { id: 'badao_shaoye', label: '霸道少爷', language: 'zh' },
  { id: 'tianxin_xiaoling', label: '甜心小玲', language: 'zh' },
  { id: 'qiaopi_mengmei', label: '俏皮萌妹', language: 'zh' },
  { id: 'wumei_yujie', label: '妩媚御姐', language: 'zh' },
  { id: 'diadia_xuemei', label: '嗲嗲学妹', language: 'zh' },
  { id: 'danya_xuejie', label: '淡雅学姐', language: 'zh' },
  { id: 'Chinese (Mandarin)_Reliable_Executive', label: '沉稳高管', language: 'zh' },
  { id: 'Chinese (Mandarin)_News_Anchor', label: '新闻女声', language: 'zh' },
  { id: 'Chinese (Mandarin)_Mature_Woman', label: '傲娇御姐', language: 'zh' },
  { id: 'Chinese (Mandarin)_Unrestrained_Young_Man', label: '不羁青年', language: 'zh' },
  { id: 'Arrogant_Miss', label: '嚣张小姐', language: 'zh' },
  { id: 'Robot_Armor', label: '机械战甲', language: 'zh' },
  { id: 'Chinese (Mandarin)_Kind-hearted_Antie', label: '热心大婶', language: 'zh' },
  { id: 'Chinese (Mandarin)_HK_Flight_Attendant', label: '港普空姐', language: 'zh' },
  { id: 'Chinese (Mandarin)_Humorous_Elder', label: '搞笑大爷', language: 'zh' },
  { id: 'Chinese (Mandarin)_Gentleman', label: '温润男声', language: 'zh' },
  { id: 'Chinese (Mandarin)_Warm_Bestie', label: '温暖闺蜜', language: 'zh' },
  { id: 'Chinese (Mandarin)_Male_Announcer', label: '播报男声', language: 'zh' },
  { id: 'Chinese (Mandarin)_Sweet_Lady', label: '甜美女声', language: 'zh' },
  { id: 'Chinese (Mandarin)_Southern_Young_Man', label: '南方小哥', language: 'zh' },
  { id: 'Chinese (Mandarin)_Wise_Women', label: '阅历姐姐', language: 'zh' },
  { id: 'Chinese (Mandarin)_Gentle_Youth', label: '温润青年', language: 'zh' },
  { id: 'Chinese (Mandarin)_Warm_Girl', label: '温暖少女', language: 'zh' },
  { id: 'Chinese (Mandarin)_Kind-hearted_Elder', label: '花甲奶奶', language: 'zh' },
  { id: 'Chinese (Mandarin)_Cute_Spirit', label: '憨憨萌兽', language: 'zh' },
  { id: 'Chinese (Mandarin)_Radio_Host', label: '电台男主播', language: 'zh' },
  { id: 'Chinese (Mandarin)_Lyrical_Voice', label: '抒情男声', language: 'zh' },
  { id: 'Chinese (Mandarin)_Straightforward_Boy', label: '率真弟弟', language: 'zh' },
  { id: 'Chinese (Mandarin)_Sincere_Adult', label: '真诚青年', language: 'zh' },
  { id: 'Chinese (Mandarin)_Gentle_Senior', label: '温柔学姐', language: 'zh' },
  { id: 'Chinese (Mandarin)_Stubborn_Friend', label: '嘴硬竹马', language: 'zh' },
  { id: 'Chinese (Mandarin)_Crisp_Girl', label: '清脆少女', language: 'zh' },
  { id: 'Chinese (Mandarin)_Pure-hearted_Boy', label: '清澈邻家弟弟', language: 'zh' },
  { id: 'Chinese (Mandarin)_Soft_Girl', label: '柔和少女', language: 'zh' },
];

/**
 * 英文音色。文档顺序把圣诞角色排在最前（英文用户的第一个选项是圣诞老人，太怪），
 * 所以这里重排：常用叙述音色 → 老一代音色 → 节日/彩蛋音色。
 */
export const MINIMAX_EN_VOICES: MinimaxSystemVoice[] = [
  { id: 'English_Trustworthy_Man', label: 'Trustworthy Man', language: 'en' },
  { id: 'English_Graceful_Lady', label: 'Graceful Lady', language: 'en' },
  { id: 'English_Diligent_Man', label: 'Diligent Man', language: 'en' },
  { id: 'English_Gentle-voiced_man', label: 'Gentle-voiced man', language: 'en' },
  { id: 'English_Whispering_girl', label: 'Whispering girl', language: 'en' },
  { id: 'English_Aussie_Bloke', label: 'Aussie Bloke', language: 'en' },
  { id: 'Serene_Woman', label: 'Serene Woman', language: 'en' },
  { id: 'Charming_Lady', label: 'Charming Lady', language: 'en' },
  { id: 'Sweet_Girl', label: 'Sweet Girl', language: 'en' },
  { id: 'Attractive_Girl', label: 'Attractive Girl', language: 'en' },
  { id: 'Cute_Elf', label: 'Cute Elf', language: 'en' },
  { id: 'Charming_Santa', label: 'Charming Santa', language: 'en' },
  { id: 'Santa_Claus', label: 'Santa Claus', language: 'en' },
  { id: 'Grinch', label: 'Grinch', language: 'en' },
  { id: 'Rudolph', label: 'Rudolph', language: 'en' },
  { id: 'Arnold', label: 'Arnold', language: 'en' },
];

export const MINIMAX_SYSTEM_VOICES: MinimaxSystemVoice[] = [
  ...MINIMAX_ZH_VOICES,
  ...MINIMAX_EN_VOICES,
];

/** 音色属于哪种语言；不认识的 id（含用户自填/克隆音色）返回 undefined。 */
export function minimaxVoiceLanguage(id: string): MinimaxVoiceLanguage | undefined {
  const wanted = (id || '').trim();
  if (!wanted) return undefined;
  return MINIMAX_SYSTEM_VOICES.find((v) => v.id === wanted)?.language;
}

/** 选择器用：界面语言那一组排在前面，另一组跟在后面。 */
export function minimaxVoiceGroups(
  uiLanguage: string | null | undefined,
): { language: MinimaxVoiceLanguage; voices: MinimaxSystemVoice[] }[] {
  const zhFirst = (uiLanguage ?? '').trim().toLowerCase().startsWith('zh');
  const zh = { language: 'zh' as const, voices: MINIMAX_ZH_VOICES };
  const en = { language: 'en' as const, voices: MINIMAX_EN_VOICES };
  return zhFirst ? [zh, en] : [en, zh];
}
