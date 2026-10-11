import forms from '@tailwindcss/forms';
import containerQueries from '@tailwindcss/container-queries';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './app.js',
    './workspace.html',
    './workspace.js',
    './xhs-card.mjs',
    './insights.html',
    './insights.js',
    './lib/chat-markdown.mjs'
  ],
  /** 首页固定右侧栏宽度与主区预留边距；避免未跑 build:css 时类被 purge 导致侧栏叠在卡片上 */
  safelist: [
    'w-64',
    'xl:mr-64',
    'max-h-[50vh]',
    'xl:max-h-none',
    'w-[380px]',
    /** workspace 节点一全文 / 侧栏比例；HTML 使用任意宽度时需与 build:css 同步 */
    'lg:w-[70%]',
    'lg:w-[30%]',
    'max-w-[min(100%,1680px)]',
    'min-h-[min(72vh,40rem)]',
    'lg:min-h-[calc(100vh-12rem)]',
    'max-h-[min(520px,58vh)]',
    'md:max-w-[min(92vw,26rem)]',
    'w-[3.75rem]',
    'sm:w-[4.25rem]',
    'focus:ring-primary/25',
    'transition-[filter]',
    /** insights.js 反馈卡片收起高度；条件拼接类名需 safelist 以免 purge 漏扫 */
    'max-h-[4.5rem]',
    'max-h-[min(50vh,320px)]'
  ],
  theme: {
    extend: {
      colors: {
        error: '#ba1a1a',
        secondary: '#705a49',
        tertiary: '#634b2d',
        'secondary-fixed-dim': '#dec1ac',
        'on-error': '#ffffff',
        'tertiary-container': '#7d6343',
        'surface-tint': '#b91d20',
        'surface-bright': '#fcfaef',
        'inverse-primary': '#ffb4ac',
        'outline-variant': '#e4beba',
        'on-primary-container': '#ffe0dd',
        'inverse-surface': '#30312a',
        outline: '#8f706c',
        'primary-fixed': '#ffdad6',
        'on-secondary-container': '#755e4d',
        'surface-container': '#f0eee3',
        'surface-container-high': '#eae8de',
        'secondary-container': '#f8dac5',
        'on-primary-fixed': '#410003',
        'on-secondary': '#ffffff',
        'primary-container': '#c62828',
        'error-container': '#ffdad6',
        'on-secondary-fixed': '#28180b',
        'surface-container-highest': '#e4e3d8',
        surface: '#fcfaef',
        'inverse-on-surface': '#f3f1e6',
        'on-primary': '#ffffff',
        'on-error-container': '#93000a',
        'on-tertiary-fixed': '#291801',
        'on-tertiary-fixed-variant': '#594325',
        'surface-container-lowest': '#ffffff',
        primary: '#a20513',
        'on-tertiary': '#ffffff',
        'on-surface-variant': '#5b403d',
        'tertiary-fixed': '#ffddb6',
        'surface-container-low': '#f6f4e9',
        'on-surface': '#1b1c16',
        background: '#fcfaef',
        'on-primary-fixed-variant': '#93000e',
        'surface-dim': '#dcdad0',
        'secondary-fixed': '#fbddc7',
        'on-secondary-fixed-variant': '#574333',
        'tertiary-fixed-dim': '#e2c19b',
        'primary-fixed-dim': '#ffb4ac',
        'on-tertiary-container': '#ffe3c3',
        'surface-variant': '#e4e3d8',
        'on-background': '#1b1c16'
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px'
      },
      spacing: {
        lg: '48px',
        'margin-mobile': '16px',
        md: '24px',
        gutter: '24px',
        'margin-desktop': '64px',
        xl: '80px',
        sm: '12px',
        xs: '4px',
        base: '8px'
      },
      fontFamily: {
        'body-md': ['Be Vietnam Pro', 'sans-serif'],
        'headline-md': ['Noto Serif', 'serif'],
        'headline-xl': ['Noto Serif', 'serif'],
        'headline-lg': ['Noto Serif', 'serif'],
        'label-md': ['Be Vietnam Pro', 'sans-serif'],
        'body-lg': ['Be Vietnam Pro', 'sans-serif']
      },
      fontSize: {
        'body-md': ['16px', { lineHeight: '1.6', fontWeight: '400' }],
        'headline-md': ['24px', { lineHeight: '1.4', fontWeight: '600' }],
        'headline-xl': [
          '48px',
          { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '700' }
        ],
        'headline-lg': ['32px', { lineHeight: '1.3', fontWeight: '600' }],
        'label-md': ['14px', { lineHeight: '1.0', letterSpacing: '0.05em', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '1.6', fontWeight: '400' }]
      }
    }
  },
  plugins: [forms, containerQueries]
};
