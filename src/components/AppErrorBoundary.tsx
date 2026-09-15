import React from 'react';

type AppErrorBoundaryState = {
  error: Error | null;
  copied: boolean;
};

export class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Spoor] startup render failed', error, info);
  }

  private copyError = async () => {
    const text = this.state.error?.stack || this.state.error?.message || 'Unknown startup error';
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
    } catch {
      this.setState({ copied: false });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="min-h-screen bg-[#FAF9F6] px-7 py-12 text-[#1a1a1a]">
        <div className="mx-auto max-w-md">
          <h1 className="text-2xl font-serif">雪泥没有正常启动</h1>
          <p className="mt-3 text-sm leading-relaxed text-[#5a5a54]">
            本地笔记没有被清除。请先重新加载；如果问题持续，可以复制错误信息反馈给我们。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-10 rounded-full bg-[#C2410C] px-5 text-sm font-medium text-white"
            >
              重新加载
            </button>
            <button
              type="button"
              onClick={() => void this.copyError()}
              className="h-10 rounded-full border border-[#E6E4DF] bg-white px-5 text-sm text-[#5a5a54]"
            >
              {this.state.copied ? '已复制' : '复制错误信息'}
            </button>
          </div>
          <details className="mt-6 text-xs text-[#8c8a84]">
            <summary className="cursor-pointer">错误详情</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">
              {this.state.error.message}
            </pre>
          </details>
        </div>
      </main>
    );
  }
}
